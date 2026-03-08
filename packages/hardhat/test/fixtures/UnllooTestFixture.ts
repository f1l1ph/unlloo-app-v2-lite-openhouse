import { ethers } from "hardhat";
import type { ContractRunner } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { UnllooCore, UnllooExt, MockERC20, MockPriceFeed, UnllooProxy } from "../../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import * as constants from "./constants";

/**
 * UnllooCore combined with UnllooExt methods.
 * At runtime, calls to Ext-only functions are routed via Core's fallback delegatecall.
 *
 * We Omit the conflicting `connect()` signatures from each contract (Core returns
 * UnllooCore, Ext returns UnllooExt) and replace them with a single signature that
 * returns UnllooCombined. Without this override, TypeScript picks the first overload
 * and `unlloo.connect(signer)` returns UnllooCore, hiding all Ext methods.
 */
export type UnllooCombined = Omit<UnllooCore & UnllooExt, "connect"> & {
  connect(runner?: ContractRunner | null): UnllooCombined;
};

export interface UnllooTestContext {
  // Core contracts
  unlloo: UnllooCombined;
  usdc: MockERC20;
  priceFeed: MockPriceFeed;

  // Signers
  owner: HardhatEthersSigner;
  borrower1: HardhatEthersSigner;
  borrower2: HardhatEthersSigner;
  lender1: HardhatEthersSigner;
  lender2: HardhatEthersSigner;
  nonOwner: HardhatEthersSigner;
  attacker: HardhatEthersSigner;

  // Block-based constants (read from contract)
  blocksPerDay: bigint;
  minLoanDurationBlocks: bigint;
  maxLoanDurationBlocks: bigint;
  cooldownBlocks: bigint;
  approvedLoanExpiryBlocks: bigint;
  maxBlocksForInterest: bigint;

  // Addresses for convenience
  usdcAddress: string;
  unllooAddress: string;
}

export interface FixtureOptions {
  /** Custom signers to use (if not provided, uses ethers.getSigners()) */
  signers?: HardhatEthersSigner[];
  /** Skip initial block mining for cooldown (default: false) */
  skipCooldownMining?: boolean;
  /** Custom min loan amount (in USDC smallest units) */
  minLoanAmount?: bigint;
  /** Custom max loan amount (in USDC smallest units) */
  maxLoanAmount?: bigint;
}

export async function setupUnllooTestFixture(options?: FixtureOptions): Promise<UnllooTestContext> {
  const opts = options ?? {};

  // Get signers
  const allSigners = opts.signers ?? (await ethers.getSigners());
  const [owner, borrower1, borrower2, lender1, lender2, nonOwner, attacker] = allSigners;

  // Deploy MockERC20 (USDC)
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("USD Coin", "USDC", constants.USDC_DECIMALS, {
    gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
  })) as MockERC20;
  await usdc.waitForDeployment();

  // Deploy MockPriceFeed (still needed for tests, even though oracle is removed from core logic)
  const MockPriceFeedFactory = await ethers.getContractFactory("MockPriceFeed");
  const priceFeed = (await MockPriceFeedFactory.deploy(constants.USDC_PRICE, constants.PRICE_FEED_DECIMALS, {
    gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
  })) as MockPriceFeed;
  await priceFeed.waitForDeployment();

  // Deploy UnllooExt (no constructor arguments)
  const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
  const unllooExt = (await UnllooExtFactory.deploy({
    gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
  })) as UnllooExt;
  await unllooExt.waitForDeployment();

  // Deploy UnllooCore implementation
  const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
  const unllooImpl = (await UnllooCoreFactory.deploy({
    gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
  })) as UnllooCore;
  await unllooImpl.waitForDeployment();

  // Calculate loan limits
  const minLoanAmount =
    opts.minLoanAmount ?? BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
  const maxLoanAmount =
    opts.maxLoanAmount ?? BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);

  // Encode initialization data (6th param: extensionDelegate = UnllooExt address)
  const initData = unllooImpl.interface.encodeFunctionData("initialize", [
    await usdc.getAddress(),
    constants.BLOCK_TIME_SECONDS,
    owner.address,
    minLoanAmount,
    maxLoanAmount,
    await unllooExt.getAddress(),
  ]);

  // Deploy proxy with UnllooCore implementation
  const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
  const proxy = (await UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
    gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
  })) as UnllooProxy;
  await proxy.waitForDeployment();

  // Build a merged ABI from Core and Ext so all functions are callable via the proxy.
  // At runtime, Core handles hot-path calls directly; Ext-only calls route via Core's fallback.
  const proxyAddress = await proxy.getAddress();
  const mergedAbi = [
    ...UnllooCoreFactory.interface.fragments,
    // Add Ext fragments that are not already in Core (avoid duplicate selectors)
    ...UnllooExtFactory.interface.fragments.filter(extFrag => {
      if (extFrag.type !== "function" && extFrag.type !== "event" && extFrag.type !== "error") return true;
      if (extFrag.type === "function") {
        return UnllooCoreFactory.interface.getFunction((extFrag as any).selector) === null;
      }
      return true;
    }),
  ];

  const unlloo = new ethers.Contract(proxyAddress, mergedAbi, owner) as unknown as UnllooCombined;

  // Read block-based constants from contract
  const blocksPerDay = constants.BLOCKS_PER_DAY;
  const minLoanDurationBlocks = await unlloo.minLoanDurationBlocks();
  const maxLoanDurationBlocks = await unlloo.maxLoanDurationBlocks();
  const cooldownBlocks = await unlloo.cooldownBlocks();
  const approvedLoanExpiryBlocks = await unlloo.approvedLoanExpiryBlocks();
  const maxBlocksForInterest = await unlloo.MAX_BLOCKS_FOR_INTEREST();

  // Mine blocks to pass initial cooldown (allows new users to submit requests)
  if (!opts.skipCooldownMining) {
    await mine(cooldownBlocks);
  }

  // Cache addresses
  const usdcAddress = await usdc.getAddress();
  const unllooAddress = proxyAddress;

  return {
    unlloo,
    usdc,
    priceFeed,
    owner,
    borrower1,
    borrower2,
    lender1,
    lender2,
    nonOwner,
    attacker,
    blocksPerDay,
    minLoanDurationBlocks,
    maxLoanDurationBlocks,
    cooldownBlocks,
    approvedLoanExpiryBlocks,
    maxBlocksForInterest,
    usdcAddress,
    unllooAddress,
  };
}
