import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction, DeployOptions, DeployResult } from "hardhat-deploy/types";
import { mockConfig } from "../config/mockConfig";
import { networkAddresses, getBlockTimeSeconds } from "../config/networkConfig";

// ============ Constants ============

/** Seconds per day for block time validation */
const SECONDS_PER_DAY = 86400;

/** Gas warning threshold (3M gas) */
const GAS_WARNING_THRESHOLD = 3_000_000;

/** Gas error threshold (6M gas) */
const GAS_ERROR_THRESHOLD = 6_000_000;

/** Safety margin multiplier for balance checking (1.2 = 20% buffer) */
const BALANCE_SAFETY_MARGIN = 1.2;

/** Default loan limits (human units) if not provided via env */
const DEFAULT_MIN_LOAN_AMOUNT_HUMAN = process.env.DEFAULT_MIN_LOAN_AMOUNT ?? "100"; // e.g. "10" USDC
const DEFAULT_MAX_LOAN_AMOUNT_HUMAN = process.env.DEFAULT_MAX_LOAN_AMOUNT ?? "1000"; // e.g. "1000" USDC

/** Expected Chain IDs for supported networks */
const EXPECTED_CHAIN_IDS: Record<string, number> = {
  mainnet: 1,
  sepolia: 11155111,
  hardhat: 31337,
  localhost: 31337,
};

// ============ Type Definitions ============

interface NetworkConfig {
  blockTimeSeconds: number;
  usdc: string;
  needsMocks: boolean;
  isLocalNetwork: boolean;
}

interface DeploymentState {
  deployedContracts: Array<{
    name: string;
    address: string;
    deployment: DeployResult;
    deployedAt: string;
    txHash?: string;
  }>;
  networkName: string;
  deploymentId: string;
  startedAt: string;
}

// ============ Network Configuration ============

function getNetworkConfig(networkName: string): NetworkConfig {
  const addresses = networkAddresses[networkName] || {
    usdc: "0x0000000000000000000000000000000000000000",
  };

  const blockTimeSeconds = getBlockTimeSeconds(networkName);
  const usdc = addresses.usdc;

  const isLocalNetwork = networkName === "hardhat" || networkName === "localhost";
  const needsMocks = isLocalNetwork || usdc === "0x0000000000000000000000000000000000000000";

  return {
    blockTimeSeconds,
    usdc,
    needsMocks,
    isLocalNetwork,
  };
}

// ============ Validation Functions ============

function isValidAddress(hre: HardhatRuntimeEnvironment, address: string): boolean {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return false;
  try {
    const checksummed = hre.ethers.getAddress(address);
    return checksummed === address;
  } catch {
    return false;
  }
}

function validateNetworkConfig(hre: HardhatRuntimeEnvironment, networkName: string, config: NetworkConfig): void {
  if (config.isLocalNetwork) return;

  if (config.usdc === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      `❌ Deployment blocked: Network "${networkName}" has placeholder USDC address.\n` +
        `   USDC Token: ${config.usdc}\n` +
        `   Please configure a valid address in networkConfig.ts or use a local network with mocks.`,
    );
  }

  if (!isValidAddress(hre, config.usdc)) {
    throw new Error(`Invalid USDC address format or checksum: ${config.usdc}`);
  }
}

async function validateContractAddress(
  hre: HardhatRuntimeEnvironment,
  address: string,
  contractName: string,
): Promise<void> {
  if (!isValidAddress(hre, address)) {
    throw new Error(`Invalid ${contractName} address format or checksum: ${address}`);
  }

  const code = await hre.ethers.provider.getCode(address);
  if (code === "0x" || code.length <= 2) {
    throw new Error(`${contractName} address has no code: ${address}`);
  }

  // Not a precompile
  const addressNum = BigInt(address);
  if (addressNum < 10n) {
    throw new Error(`${contractName} address is a precompile: ${address}`);
  }
}

async function validateUSDCToken(hre: HardhatRuntimeEnvironment, address: string): Promise<void> {
  await validateContractAddress(hre, address, "USDC Token");

  const token = await hre.ethers.getContractAt(
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function name() view returns (string)",
    ],
    address,
  );

  const decimals = (await token.decimals()) as bigint;
  if (decimals !== 6n) {
    throw new Error(`USDC decimals mismatch: expected 6, got ${decimals.toString()}`);
  }

  const symbol = (await token.symbol()) as string;
  if (symbol.toUpperCase() !== "USDC") {
    throw new Error(`Token symbol mismatch: expected USDC, got ${symbol}`);
  }

  const name = (await token.name()) as string;
  if (!name.toUpperCase().includes("USD COIN") && !name.toUpperCase().includes("USDC")) {
    console.warn(`   ⚠️  Token name doesn't match USDC: ${name}`);
  }
}

function validateBlockTimeCompatibility(blockTimeSeconds: number): void {
  if (blockTimeSeconds <= 0 || blockTimeSeconds > SECONDS_PER_DAY) {
    throw new Error(`Invalid blockTimeSeconds: ${blockTimeSeconds} (must be 1-${SECONDS_PER_DAY})`);
  }
  const secondsPerYear = 365 * 24 * 60 * 60;
  if (blockTimeSeconds >= secondsPerYear) {
    throw new Error(`Block time ${blockTimeSeconds}s is too large; must be < 1 year (${secondsPerYear}s)`);
  }
}

function validateUnllooInitializeArgs(args: unknown[]): void {
  if (args.length !== 5) {
    throw new Error(`Unlloo.initialize requires 5 arguments, got ${args.length}`);
  }
  const [_defaultToken, _blockTimeSeconds, initialOwner, _minLoan, _maxLoan] = args;

  if (typeof _defaultToken !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(_defaultToken)) {
    throw new Error("Invalid _defaultToken in initialize args");
  }
  if (typeof initialOwner !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(initialOwner)) {
    throw new Error("Invalid initialOwner in initialize args");
  }
  if (typeof _blockTimeSeconds !== "number" || _blockTimeSeconds <= 0 || _blockTimeSeconds > SECONDS_PER_DAY) {
    throw new Error(`Invalid _blockTimeSeconds: ${_blockTimeSeconds}`);
  }

  if (typeof _minLoan !== "bigint" || _minLoan <= 0n) {
    throw new Error("Invalid _defaultMinLoanAmount in initialize args");
  }
  if (typeof _maxLoan !== "bigint" || _maxLoan <= 0n) {
    throw new Error("Invalid _defaultMaxLoanAmount in initialize args");
  }
  if (_minLoan >= _maxLoan) {
    throw new Error("Invalid pool loan limits: min must be < max");
  }
}

async function estimateDeploymentGas(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  constructorArgs: unknown[],
  from: string,
): Promise<bigint | null> {
  try {
    const factory = await hre.ethers.getContractFactory(contractName);
    const deployTx = await factory.getDeployTransaction(...(constructorArgs as any[]));
    deployTx.from = from;

    if (!deployTx.data) return null;

    const signer = await hre.ethers.getSigner(from);
    return await signer.estimateGas(deployTx);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("insufficient funds") || error.message.includes("invalid argument")) {
        throw new Error(`Gas estimation failed for ${contractName}: ${error.message}`);
      }
      console.warn(`   ⚠️  Could not estimate gas for ${contractName}: ${error.message}`);
    } else {
      console.warn(`   ⚠️  Could not estimate gas for ${contractName}`);
    }
    return null;
  }
}

async function checkExistingDeployments(hre: HardhatRuntimeEnvironment, contractNames: string[]): Promise<void> {
  const { get } = hre.deployments;

  for (const name of contractNames) {
    try {
      const existing = await get(name);
      if (existing?.address) {
        const code = await hre.ethers.provider.getCode(existing.address);
        if (code !== "0x") {
          console.warn(`   ⚠️  ${name} already deployed at ${existing.address}`);
          console.warn(`   ⚠️  Consider using --reset flag to redeploy`);
        }
      }
    } catch {
      // ok
    }
  }
}

async function checkDeployerBalance(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  estimatedGasCosts: bigint[],
): Promise<void> {
  const provider = hre.ethers.provider;
  const balance = await provider.getBalance(deployer);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;

  const totalEstimatedGas = estimatedGasCosts.reduce((sum, gas) => sum + gas, 0n);
  const safetyMarginMultiplier = BigInt(Math.floor(BALANCE_SAFETY_MARGIN * 100));
  const estimatedCost = (totalEstimatedGas * gasPrice * safetyMarginMultiplier) / 100n;

  if (estimatedCost > 0n && balance < estimatedCost) {
    throw new Error(
      `Insufficient balance: ${hre.ethers.formatEther(balance)} ETH available, ` +
        `estimated cost: ${hre.ethers.formatEther(estimatedCost)} ETH (with ${Math.floor((BALANCE_SAFETY_MARGIN - 1) * 100)}% safety margin)`,
    );
  }

  console.log(`   💰 Deployer balance: ${hre.ethers.formatEther(balance)} ETH`);
  if (estimatedCost > 0n) {
    console.log(`   💰 Estimated cost: ${hre.ethers.formatEther(estimatedCost)} ETH (with safety margin)\n`);
  } else {
    console.log(`   💰 Estimated cost: (skipped / unavailable)\n`);
  }
}

async function validateChainId(hre: HardhatRuntimeEnvironment, networkName: string): Promise<void> {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const expected = EXPECTED_CHAIN_IDS[networkName];

  if (expected && chainId !== expected) {
    throw new Error(`Chain ID mismatch: expected ${expected} for ${networkName}, got ${chainId}`);
  }
  if (!expected) {
    console.warn(`⚠️  Unknown network "${networkName}" with chain ID ${chainId}`);
  }
}

async function deployWithValidation(
  hre: HardhatRuntimeEnvironment,
  deploy: (name: string, options: DeployOptions) => Promise<DeployResult>,
  deploymentName: string,
  deployOptions: DeployOptions,
  state: DeploymentState,
  config: NetworkConfig,
): Promise<DeployResult> {
  // Optional pre-gas estimate
  try {
    const estimatedGas = await estimateDeploymentGas(
      hre,
      (deployOptions.contract as string) ?? deploymentName,
      deployOptions.args || [],
      deployOptions.from as string,
    );
    if (estimatedGas) {
      const isLocal = config.isLocalNetwork;
      const effectiveErrorThreshold = isLocal ? GAS_ERROR_THRESHOLD * 2 : GAS_ERROR_THRESHOLD;

      if (estimatedGas > BigInt(effectiveErrorThreshold)) {
        if (isLocal) {
          console.warn(
            `   ⚠️  Very high gas estimate: ${estimatedGas.toString()} gas (threshold: ${effectiveErrorThreshold}). Proceeding on local network.`,
          );
        } else {
          throw new Error(
            `Gas estimate too high: ${estimatedGas.toString()} gas (threshold: ${effectiveErrorThreshold}).`,
          );
        }
      } else if (estimatedGas > BigInt(GAS_WARNING_THRESHOLD)) {
        console.warn(`   ⚠️  High gas estimate: ${estimatedGas.toString()} gas`);
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Gas estimation failed") || error.message.includes("Gas estimate too high"))
    ) {
      throw error;
    }
    console.warn(`   ⚠️  Gas estimation skipped for ${deploymentName}`);
  }

  const deployment = await deploy(deploymentName, deployOptions);
  if (!deployment?.address) throw new Error(`Failed to deploy ${deploymentName}: No address returned`);

  const code = await hre.ethers.provider.getCode(deployment.address);
  if (code === "0x" || code.length <= 2) {
    throw new Error(`Failed to deploy ${deploymentName}: No code at address ${deployment.address}`);
  }

  state.deployedContracts.push({
    name: deploymentName,
    address: deployment.address,
    deployment,
    deployedAt: new Date().toISOString(),
    txHash: deployment.receipt?.transactionHash,
  });

  return deployment;
}

async function verifyDeployedContracts(
  hre: HardhatRuntimeEnvironment,
  state: DeploymentState,
  config: NetworkConfig,
): Promise<void> {
  const shouldVerify = process.env.VERIFY_CONTRACTS === "true";
  if (!shouldVerify) {
    console.log("ℹ️  Contract verification skipped (set VERIFY_CONTRACTS=true to enable)\n");
    return;
  }

  const networkName = hre.network.name;
  const supportedNetworks = ["mainnet", "sepolia", "arbitrum", "arbitrumSepolia"];
  if (!supportedNetworks.includes(networkName)) {
    console.warn(`   ⚠️  Verification not configured for network: ${networkName}\n`);
    return;
  }

  console.log("🔍 Verifying contracts on block explorer...\n");

  for (const contract of state.deployedContracts) {
    try {
      if (!config.needsMocks && contract.name === "MockERC20") continue;

      console.log(`   Verifying ${contract.name}...`);
      await hre.run("verify:verify", {
        address: contract.address,
        constructorArguments: contract.deployment.args || [],
      });
      console.log(`   ✅ ${contract.name} verified\n`);
    } catch (error) {
      console.warn(
        `   ⚠️  Failed to verify ${contract.name}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

async function verifyContractInteractions(
  hre: HardhatRuntimeEnvironment,
  unllooProxyAddress: string,
  expected: {
    owner: string;
    defaultToken: string;
    blockTimeSeconds: number;
    minLoanAmount: bigint;
    maxLoanAmount: bigint;
  },
): Promise<void> {
  console.log("🔍 Verifying contract interactions...\n");

  const unlloo = await hre.ethers.getContractAt("Unlloo", unllooProxyAddress);

  // Owner
  const owner = (await unlloo.owner()) as string;
  if (owner.toLowerCase() !== expected.owner.toLowerCase()) {
    throw new Error(`Owner mismatch: expected ${expected.owner}, got ${owner}`);
  }

  // Token wiring
  const defaultToken = (await unlloo.defaultToken()) as string;
  if (defaultToken.toLowerCase() !== expected.defaultToken.toLowerCase()) {
    throw new Error(`Default token mismatch: expected ${expected.defaultToken}, got ${defaultToken}`);
  }

  // Block time
  const storedBlockTime = Number((await unlloo.blockTimeSeconds()) as bigint);
  if (storedBlockTime !== expected.blockTimeSeconds) {
    throw new Error(`Block time mismatch: expected ${expected.blockTimeSeconds}, got ${storedBlockTime}`);
  }

  // Pool loan limits
  const minLoan = (await unlloo.minLoanAmountPerPool(expected.defaultToken)) as bigint;
  const maxLoan = (await unlloo.maxLoanAmountPerPool(expected.defaultToken)) as bigint;

  if (minLoan !== expected.minLoanAmount) {
    throw new Error(
      `minLoanAmountPerPool mismatch: expected ${expected.minLoanAmount.toString()}, got ${minLoan.toString()}`,
    );
  }
  if (maxLoan !== expected.maxLoanAmount) {
    throw new Error(
      `maxLoanAmountPerPool mismatch: expected ${expected.maxLoanAmount.toString()}, got ${maxLoan.toString()}`,
    );
  }

  console.log("   ✅ Wiring + basic invariants verified\n");
}

async function displayDeploymentSummary(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  config: NetworkConfig,
  state: DeploymentState,
  tokenDecimals: number,
): Promise<void> {
  const unllooProxyAddress = state.deployedContracts.find(c => c.name === "Unlloo")!.address;
  const unlloo = await hre.ethers.getContractAt("Unlloo", unllooProxyAddress);

  const owner = (await unlloo.owner()) as string;
  const defaultToken = (await unlloo.defaultToken()) as string;
  const blockTime = Number((await unlloo.blockTimeSeconds()) as bigint);

  const minLoan = (await unlloo.minLoanAmountPerPool(defaultToken)) as bigint;
  const maxLoan = (await unlloo.maxLoanAmountPerPool(defaultToken)) as bigint;

  console.log("\n✅ All contracts deployed successfully!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Contract Addresses:");
  for (const c of state.deployedContracts) {
    console.log(`   ${c.name.padEnd(22)} ${c.address}`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⚙️  Unlloo Configuration (via proxy):");
  console.log(`   Owner:                 ${owner}`);
  console.log(`   Default Token:         ${defaultToken}`);
  console.log(`   Block Time:            ${blockTime}s`);
  console.log(`   Protocol Fee:          25% (fixed)`);
  console.log(`   Min Loan (default):    ${hre.ethers.formatUnits(minLoan, tokenDecimals)}`);
  console.log(`   Max Loan (default):    ${hre.ethers.formatUnits(maxLoan, tokenDecimals)}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📝 Deployment Info:");
  console.log(`   Network:               ${state.networkName}`);
  console.log(`   Deployer:              ${deployer}`);
  console.log(`   Needs Mocks:           ${config.needsMocks}`);
  console.log(`   Timestamp:             ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("ℹ️  Contract addresses saved to deployments/ folder\n");
}

// ============ Main Deployment Function ============

const deployUnlloo: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const networkName = hre.network.name;

  const DRY_RUN = process.env.DRY_RUN === "true";

  const config = getNetworkConfig(networkName);
  const deploymentState: DeploymentState = {
    deployedContracts: [],
    networkName,
    startedAt: new Date().toISOString(),
    deploymentId: `${networkName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };

  validateNetworkConfig(hre, networkName, config);
  await validateChainId(hre, networkName);
  validateBlockTimeCompatibility(config.blockTimeSeconds);

  await checkExistingDeployments(hre, ["MockERC20", "UnllooImplementation", "Unlloo"]);

  // Owner: mock admin for local, deployer otherwise
  const ownerAddress = config.isLocalNetwork ? mockConfig.mint.admin : deployer;

  if (config.isLocalNetwork && !isValidAddress(hre, mockConfig.mint.admin)) {
    throw new Error(`Invalid admin address in mockConfig.ts: ${mockConfig.mint.admin}`);
  }

  console.log(`\n📋 Deploying Unlloo (OZ 5.5 proxy) to ${networkName}...`);
  console.log(`   Block Time: ${config.blockTimeSeconds}s`);
  console.log(`   Owner: ${ownerAddress}`);
  console.log(`   Needs Mocks: ${config.needsMocks}`);
  console.log(`   Default Min Loan (human): ${DEFAULT_MIN_LOAN_AMOUNT_HUMAN}`);
  console.log(`   Default Max Loan (human): ${DEFAULT_MAX_LOAN_AMOUNT_HUMAN}\n`);

  // DRY RUN
  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE: Validating deployment inputs without executing...\n");

    if (!config.needsMocks) {
      await validateUSDCToken(hre, config.usdc);
    }

    validateBlockTimeCompatibility(config.blockTimeSeconds);

    // Validate initializer args shape using best-effort decimals
    const tokenDecimals = config.needsMocks ? BigInt(mockConfig.erc20.decimals) : 6n;
    const minLoan = hre.ethers.parseUnits(DEFAULT_MIN_LOAN_AMOUNT_HUMAN, Number(tokenDecimals));
    const maxLoan = hre.ethers.parseUnits(DEFAULT_MAX_LOAN_AMOUNT_HUMAN, Number(tokenDecimals));

    const placeholderToken = config.needsMocks ? "0x0000000000000000000000000000000000000001" : config.usdc;

    validateUnllooInitializeArgs([placeholderToken, config.blockTimeSeconds, ownerAddress, minLoan, maxLoan]);

    console.log("✅ Dry run validation passed. Set DRY_RUN=false to deploy.\n");
    return;
  }

  // Pre-estimate gas where possible
  const estimatedGasCosts: bigint[] = [];
  const toEstimate = config.needsMocks ? ["MockERC20", "Unlloo", "UnllooProxy"] : ["Unlloo", "UnllooProxy"];

  for (const name of toEstimate) {
    // UnllooProxy needs init data; estimate later after init args are computed
    if (name === "UnllooProxy") continue;

    let args: unknown[] = [];
    if (name === "MockERC20") {
      args = [mockConfig.erc20.name, mockConfig.erc20.symbol, mockConfig.erc20.decimals];
    }

    // Unlloo implementation has 0 constructor args
    const estimatedGas = await estimateDeploymentGas(hre, name === "Unlloo" ? "Unlloo" : name, args, deployer);
    if (estimatedGas) estimatedGasCosts.push(estimatedGas);
  }

  await checkDeployerBalance(hre, deployer, estimatedGasCosts);

  // Step 1: default token
  let defaultTokenAddress: string;

  if (config.needsMocks) {
    console.log("🔧 Step 1: Deploying MockERC20...");

    const mockERC20 = await deployWithValidation(
      hre,
      deploy,
      "MockERC20",
      {
        from: deployer,
        args: [mockConfig.erc20.name, mockConfig.erc20.symbol, mockConfig.erc20.decimals],
        log: true,
        autoMine: true,
      },
      deploymentState,
      config,
    );

    defaultTokenAddress = mockERC20.address;
    console.log(`   ✅ MockERC20 deployed at: ${defaultTokenAddress}\n`);

    // Mint to configured addresses (optional)
    if (mockConfig.mint.addresses.length > 0) {
      console.log("💰 Minting tokens to configured addresses...");
      const mockERC20Contract = await hre.ethers.getContractAt("MockERC20", defaultTokenAddress);
      const mintAmount = BigInt(mockConfig.mint.amountPerAddress);

      for (const addr of mockConfig.mint.addresses) {
        if (!isValidAddress(hre, addr)) {
          console.warn(`   ⚠️  Skipping invalid address: ${addr}`);
          continue;
        }
        try {
          const tx = await mockERC20Contract.mint(addr, mintAmount);
          await tx.wait();
          console.log(`   ✅ Minted ${hre.ethers.formatUnits(mintAmount, mockConfig.erc20.decimals)} to ${addr}`);
        } catch (error) {
          console.warn(`   ⚠️  Mint failed for ${addr}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      console.log("");
    }
  } else {
    await validateUSDCToken(hre, config.usdc);
    defaultTokenAddress = config.usdc;
    console.log(`   ✅ Using real USDC token: ${defaultTokenAddress}\n`);
  }

  // Determine token decimals for parseUnits + summary
  const tokenMeta = await hre.ethers.getContractAt(["function decimals() view returns (uint8)"], defaultTokenAddress);
  const tokenDecimalsBig = (await tokenMeta.decimals()) as bigint;
  const tokenDecimals = Number(tokenDecimalsBig);

  const defaultMinLoanAmount = hre.ethers.parseUnits(DEFAULT_MIN_LOAN_AMOUNT_HUMAN, tokenDecimals);
  const defaultMaxLoanAmount = hre.ethers.parseUnits(DEFAULT_MAX_LOAN_AMOUNT_HUMAN, tokenDecimals);

  // Step 2: Unlloo implementation (no constructor args)
  console.log("🔧 Step 2: Deploying Unlloo implementation...");
  const unllooImpl = await deployWithValidation(
    hre,
    deploy,
    "UnllooImplementation",
    {
      from: deployer,
      contract: "Unlloo",
      args: [],
      log: true,
      autoMine: true,
    },
    deploymentState,
    config,
  );
  console.log(`   ✅ Unlloo implementation deployed at: ${unllooImpl.address}\n`);

  // Step 3: Deploy proxy + initialize
  console.log("🔧 Step 3: Deploying Unlloo proxy + initializing...");

  await validateContractAddress(hre, unllooImpl.address, "UnllooImplementation");
  await validateContractAddress(hre, defaultTokenAddress, "DefaultToken");

  const unllooFactory = await hre.ethers.getContractFactory("Unlloo");
  const initArgs: unknown[] = [
    defaultTokenAddress,
    config.blockTimeSeconds,
    ownerAddress,
    defaultMinLoanAmount,
    defaultMaxLoanAmount,
  ];
  validateUnllooInitializeArgs(initArgs);

  const initData = unllooFactory.interface.encodeFunctionData("initialize", initArgs as any[]);

  // (Optional) estimate proxy deploy gas now that we have init data
  try {
    const proxyGas = await estimateDeploymentGas(hre, "UnllooProxy", [unllooImpl.address, initData], deployer);
    if (proxyGas && proxyGas > BigInt(GAS_WARNING_THRESHOLD)) {
      console.warn(`   ⚠️  Proxy deploy gas estimate: ${proxyGas.toString()}`);
    }
  } catch {
    // ignore
  }

  const unllooProxy = await deployWithValidation(
    hre,
    deploy,
    "Unlloo",
    {
      from: deployer,
      contract: "UnllooProxy",
      args: [unllooImpl.address, initData],
      log: true,
      autoMine: true,
    },
    deploymentState,
    config,
  );
  console.log(`   ✅ Unlloo proxy deployed at: ${unllooProxy.address}\n`);

  // CRITICAL: Save the deployment with the implementation ABI, not the proxy ABI
  // The proxy forwards calls to the implementation, so the frontend needs the implementation ABI
  const implementationArtifact = await hre.artifacts.readArtifact("Unlloo");
  await hre.deployments.save("Unlloo", {
    address: unllooProxy.address,
    abi: implementationArtifact.abi,
    transactionHash: unllooProxy.receipt?.transactionHash,
    args: [unllooImpl.address, initData],
    libraries: {},
    metadata: unllooProxy.metadata,
    receipt: unllooProxy.receipt,
  });
  console.log(`   ✅ Updated Unlloo deployment with implementation ABI\n`);

  // Post-deploy checks against proxy address
  await verifyContractInteractions(hre, unllooProxy.address, {
    owner: ownerAddress,
    defaultToken: defaultTokenAddress,
    blockTimeSeconds: config.blockTimeSeconds,
    minLoanAmount: defaultMinLoanAmount,
    maxLoanAmount: defaultMaxLoanAmount,
  });

  await verifyDeployedContracts(hre, deploymentState, config);
  await displayDeploymentSummary(hre, deployer, config, deploymentState, tokenDecimals);
};

export default deployUnlloo;

deployUnlloo.tags = ["Unlloo", "Proxy", "Mocks", "All"];
deployUnlloo.dependencies = [];
