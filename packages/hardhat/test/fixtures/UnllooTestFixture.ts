import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Unlloo, MockERC20, MockPriceFeed, UnllooProxy } from "../../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import * as constants from "./constants";

export interface UnllooTestContext {
  // Core contracts
  unlloo: Unlloo;
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

  // Deploy Unlloo implementation
  const UnllooFactory = await ethers.getContractFactory("Unlloo");
  const unllooImpl = (await UnllooFactory.deploy({
    gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
  })) as Unlloo;
  await unllooImpl.waitForDeployment();

  // Calculate loan limits
  const minLoanAmount =
    opts.minLoanAmount ?? BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
  const maxLoanAmount =
    opts.maxLoanAmount ?? BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);

  // Encode initialization data
  const initData = unllooImpl.interface.encodeFunctionData("initialize", [
    await usdc.getAddress(),
    constants.BLOCK_TIME_SECONDS,
    owner.address,
    minLoanAmount,
    maxLoanAmount,
  ]);

  // Deploy proxy with implementation
  const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
  const proxy = (await UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
    gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
  })) as UnllooProxy;
  await proxy.waitForDeployment();

  // Attach Unlloo interface to proxy
  const unlloo = UnllooFactory.attach(await proxy.getAddress()) as Unlloo;

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
  const unllooAddress = await unlloo.getAddress();

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
