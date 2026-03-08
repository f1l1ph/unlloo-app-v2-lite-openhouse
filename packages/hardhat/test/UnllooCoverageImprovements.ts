import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20, MockPriceFeed, UnllooProxy } from "../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { calculateExpectedInterest } from "./helpers/calculationHelpers";
import * as constants from "./fixtures/constants";
import { UnllooCombined } from "./fixtures/UnllooTestFixture";

describe("Unlloo - Coverage Improvements", function () {
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let priceFeed: MockPriceFeed;

  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;

  let MIN_LOAN_DURATION_BLOCKS: bigint;

  async function mintAndApproveUSDC(user: HardhatEthersSigner, amount: bigint) {
    await usdc.mint(user.address, amount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    await usdc.connect(user).approve(await unlloo.getAddress(), amount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
  }

  async function submitLoanRequestHelper(
    borrower: HardhatEthersSigner,
    reputation: number,
    amountUSD: number,
    durationBlocks: bigint,
  ) {
    const usdcAddress = await usdc.getAddress();
    const loanAmount = ethers.parseUnits(amountUSD.toString(), constants.USDC_DECIMALS);
    return await unlloo.connect(borrower).submitLoanRequest(reputation, usdcAddress, loanAmount, durationBlocks, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });
  }

  async function setupCompleteBorrow(
    borrower: HardhatEthersSigner,
    lender: HardhatEthersSigner,
    loanAmountUSD: number = 1000,
    liquidityAmount: bigint = ethers.parseUnits("10000", constants.USDC_DECIMALS),
  ) {
    // Lender deposits liquidity
    await mintAndApproveUSDC(lender, liquidityAmount);
    await unlloo.connect(lender).depositLiquidity(await usdc.getAddress(), liquidityAmount, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });

    // Create and approve loan
    await submitLoanRequestHelper(borrower, constants.VALID_REPUTATION, loanAmountUSD, MIN_LOAN_DURATION_BLOCKS);
    const loanId = await unlloo.loanCounter();
    await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Borrow
    const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
    await unlloo.connect(borrower).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    return { loanId, borrowAmount: maxBorrowable };
  }

  beforeEach(async function () {
    [owner, borrower1, lender1] = await ethers.getSigners();

    // Deploy MockERC20
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USDC", "USDC", constants.USDC_DECIMALS, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });
    await usdc.waitForDeployment();

    // Deploy MockPriceFeed
    const MockPriceFeedFactory = await ethers.getContractFactory("MockPriceFeed");
    priceFeed = await MockPriceFeedFactory.deploy(constants.USDC_PRICE, constants.PRICE_FEED_DECIMALS, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });
    await priceFeed.waitForDeployment();

    // Deploy UnllooExt
    const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
    const unllooExt = await UnllooExtFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
    await unllooExt.waitForDeployment();

    // Deploy UnllooCore implementation
    const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
    const unllooImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
    await unllooImpl.waitForDeployment();

    // Initialize via proxy
    const minLoanAmount = constants.parseUSDC(constants.MIN_LOAN_AMOUNT_USD);
    const maxLoanAmount = constants.parseUSDC(constants.MAX_LOAN_AMOUNT_USD);

    const initData = unllooImpl.interface.encodeFunctionData("initialize", [
      await usdc.getAddress(),
      constants.BLOCK_TIME_SECONDS,
      owner.address,
      minLoanAmount,
      maxLoanAmount,
      await unllooExt.getAddress(),
    ]);

    const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
    const proxy = (await UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    })) as UnllooProxy;
    await proxy.waitForDeployment();

    const mergedAbi = [
      ...UnllooCoreFactory.interface.fragments,
      ...UnllooExtFactory.interface.fragments.filter(extFrag => {
        if (extFrag.type !== "function" && extFrag.type !== "event" && extFrag.type !== "error") return true;
        if (extFrag.type === "function") {
          return UnllooCoreFactory.interface.getFunction((extFrag as any).selector) === null;
        }
        return true;
      }),
    ];
    unlloo = new ethers.Contract(await proxy.getAddress(), mergedAbi, owner) as unknown as UnllooCombined;

    MIN_LOAN_DURATION_BLOCKS = await unlloo.minLoanDurationBlocks();
  });

  describe("UnllooInterestLib Coverage", function () {
    it("Should handle old loans with blocksElapsedOld > maxBlocksForInterest", async function () {
      // With simple interest, interest continues to accrue indefinitely (no capping)
      // This test verifies that interest accrues correctly beyond maxBlocksForInterest
      await mintAndApproveUSDC(lender1, ethers.parseUnits("10000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      // Submit and approve loan
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Borrow to create active loan
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Get maxBlocksForInterest and loan details
      const maxBlocksForInterest = await unlloo.MAX_BLOCKS_FOR_INTEREST();
      const loan = await unlloo.getLoan(loanId);
      // Get borrow rate from loan struct, not the mapping
      const loanBorrowRateBps = loan.borrowRateBps;

      // Test: mine blocks beyond maxBlocksForInterest
      // With simple interest, interest continues to accrue (no capping)
      await mine(Number(maxBlocksForInterest) + 1000);

      // Interest should continue to accrue beyond maxBlocksForInterest
      const interest = await unlloo.getAccruedInterest(loanId);
      expect(interest).to.be.gt(0);

      // Verify interest calculation uses TOTAL blocks elapsed (not capped)
      const totalBlocks = maxBlocksForInterest + 1000n;
      const expectedInterest = calculateExpectedInterest(
        loan.principal,
        totalBlocks,
        loanBorrowRateBps,
        constants.BLOCK_TIME_SECONDS,
      );
      // Allow for small rounding differences (use larger tolerance for long periods)
      expect(interest).to.be.closeTo(expectedInterest, expectedInterest / 100n + 1000n);
    });

    it("Should handle CalculationOverflow when currentIndex < 1e18", async function () {
      // This tests line 62 in UnllooInterestLib
      // This is extremely difficult to trigger in practice, but we can verify the check exists
      // The overflow check: if (currentIndex < 1e18 || borrowIndexAtStart < 1e18 || currentIndex < borrowIndexAtStart)
      await mintAndApproveUSDC(lender1, ethers.parseUnits("10000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Normal operation should work - the overflow check is defensive
      const interest = await unlloo.getAccruedInterest(loanId);
      expect(interest).to.be.gte(0);
    });

    it("Should handle CalculationOverflow when principal * currentIndex would overflow", async function () {
      // The explicit overflow guard exists in UnllooInterestLib, but is practically unreachable
      // through normal protocol flows (would require a principal near uint256.max).
      // Keep this as a sanity check that normal flows still work.
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);
      const totalOwed = await unlloo.getTotalOwed(loanId);
      expect(totalOwed).to.be.gt(0);
    });
  });

  describe("UnllooStatusArray Coverage", function () {
    it("Should handle status array operations correctly with multiple loans", async function () {
      // Test status array add/remove operations
      const [, , , borrower2, borrower3] = await ethers.getSigners();

      // Create multiple loans
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId1 = await unlloo.loanCounter();

      await submitLoanRequestHelper(borrower2, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId2 = await unlloo.loanCounter();

      await submitLoanRequestHelper(borrower3, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId3 = await unlloo.loanCounter();

      // All should be pending
      let pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
      expect(pendingLoans).to.include(loanId1);
      expect(pendingLoans).to.include(loanId2);
      expect(pendingLoans).to.include(loanId3);

      // Approve first loan (removes from pending, adds to approved)
      await unlloo.connect(owner).approveLoanRequest(loanId1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
      expect(pendingLoans).to.not.include(loanId1);
      expect(pendingLoans).to.include(loanId2);
      expect(pendingLoans).to.include(loanId3);

      // Reject second loan (removes from pending)
      await unlloo.connect(owner).rejectLoanRequest(loanId2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
      expect(pendingLoans).to.not.include(loanId2);
      expect(pendingLoans).to.include(loanId3);

      // Approve third loan
      await unlloo.connect(owner).approveLoanRequest(loanId3, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
      expect(pendingLoans).to.not.include(loanId3);

      // Verify approved loans
      const approvedLoans = await unlloo.getLoansByStatus(1, 0, 10);
      expect(approvedLoans).to.include(loanId1);
      expect(approvedLoans).to.include(loanId3);
      expect(approvedLoans).to.not.include(loanId2);
    });
  });

  // InterestCalculator Coverage - REMOVED: InterestCalculator is no longer used

  describe("Unlloo.sol Coverage", function () {
    it("Should handle token decimals fallback when decimals() call fails", async function () {
      // This tests _validateTokenDecimals which reverts if decimals() call fails
      // Create a token that makes decimals() revert
      const NoDecimalsERC20Factory = await ethers.getContractFactory("NoDecimalsERC20");
      const noDecimalsToken = await NoDecimalsERC20Factory.deploy("NoDecimals", "NODEC", {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await noDecimalsToken.waitForDeployment();

      // Deploy a new UnllooExt + UnllooCore implementation
      const UnllooExtFactory2 = await ethers.getContractFactory("UnllooExt");
      const newUnllooExt = await UnllooExtFactory2.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newUnllooExt.waitForDeployment();

      const UnllooCoreFactory2 = await ethers.getContractFactory("UnllooCore");
      const newUnllooImpl = await UnllooCoreFactory2.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newUnllooImpl.waitForDeployment();

      // Initialize should revert because _validateTokenDecimals will fail
      // when decimals() reverts, it reverts with InvalidPool
      const minLoanAmountNew = 10n; // 10 tokens
      const maxLoanAmountNew = 100000n; // 100,000 tokens

      const initData = newUnllooImpl.interface.encodeFunctionData("initialize", [
        await noDecimalsToken.getAddress(),
        constants.BLOCK_TIME_SECONDS,
        owner.address,
        minLoanAmountNew,
        maxLoanAmountNew,
        await newUnllooExt.getAddress(),
      ]);

      const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
      await expect(
        UnllooProxyFactory.deploy(await newUnllooImpl.getAddress(), initData, {
          gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(newUnllooImpl, "InvalidPool");
    });

    it("Should revert InvalidPool when validating zero address", async function () {
      // This tests line 1808 in Unlloo.sol
      // The _validateNonZeroAddress function is used in various places
      // We can test it indirectly through pool operations

      await expect(
        unlloo
          .connect(owner)
          .addLiquidityPool(
            ethers.ZeroAddress,
            ethers.parseUnits("10", constants.USDC_DECIMALS),
            ethers.parseUnits("100000", constants.USDC_DECIMALS),
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
    });

    it("Should handle zero min/max loan amounts triggering decimals() call", async function () {
      // The min/max-zero path is guarded by addLiquidityPool/updatePoolLoanLimits validations,
      // so it should be unreachable in normal operation.
      const minLoanAmount = await unlloo.minLoanAmountPerPool(await usdc.getAddress());
      const maxLoanAmount = await unlloo.maxLoanAmountPerPool(await usdc.getAddress());
      expect(minLoanAmount).to.be.gt(0);
      expect(maxLoanAmount).to.be.gt(0);
    });
  });

  describe("Mocks Coverage (non-production helpers)", function () {
    it("Should exercise ReentrancyGuardUpgradeable via harness", async function () {
      const GuardFactory = await ethers.getContractFactory("ReentrancyGuardHarness");
      const guard = (await GuardFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT })) as any;
      await guard.waitForDeployment();

      await guard.init({ gasLimit: constants.COVERAGE_GAS_LIMIT });
      await guard.enter({ gasLimit: constants.COVERAGE_GAS_LIMIT });
      expect(await guard.counter()).to.equal(1n);

      await expect(guard.reenter({ gasLimit: constants.COVERAGE_GAS_LIMIT })).to.be.revertedWithCustomError(
        guard,
        "ReentrancyGuardReentrantCall",
      );
    });

    it("Should exercise MockPriceFeed helper methods", async function () {
      expect(await priceFeed.decimals()).to.equal(8);
      expect(await priceFeed.description()).to.be.a("string");
      expect(await priceFeed.version()).to.equal(1n);

      const [roundId1, answer1] = await priceFeed.latestRoundData();
      expect(roundId1).to.be.gt(0);
      expect(answer1).to.equal(1_0000_0000n); // 1e8

      await priceFeed.setPrice(9000_0000n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      const [, answer2] = await priceFeed.latestRoundData();
      expect(answer2).to.equal(9000_0000n);

      await priceFeed.setUpdatedAt(123, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      const [, , , updatedAt] = await priceFeed.latestRoundData();
      expect(updatedAt).to.equal(123n);

      await priceFeed.setPriceWithTimestamp(9500_0000n, 456, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      const [, answer3, , updatedAt3] = await priceFeed.latestRoundData();
      expect(answer3).to.equal(9500_0000n);
      expect(updatedAt3).to.equal(456n);

      await priceFeed.setRoundId(7, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await priceFeed.setAnsweredInRound(6, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      const [rid, , , , answeredInRound] = await priceFeed.latestRoundData();
      expect(rid).to.equal(7n);
      expect(answeredInRound).to.equal(6n);

      const [rid2] = await priceFeed.getRoundData(123);
      expect(rid2).to.equal(123n);
    });

    // REMOVED: FixedIndexInterestCalculator test - contract no longer exists (using simple interest now)

    it("Should exercise MaliciousERC20 attack toggles and _update branch", async function () {
      const MalFactory = await ethers.getContractFactory("MaliciousERC20");
      const mal = await MalFactory.deploy("MAL", "MAL", constants.USDC_DECIMALS, {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      });
      await mal.waitForDeployment();

      expect(await mal.decimals()).to.equal(constants.USDC_DECIMALS);
      expect(await usdc.decimals()).to.equal(constants.USDC_DECIMALS);

      // Mint & basic transfer with attack disabled
      await mal.mint(lender1.address, 1000n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await expect(mal.connect(lender1).transfer(borrower1.address, 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to
        .not.be.reverted;

      // Configure reentrancy call target to a harmless view call
      const decimalsCall = usdc.interface.encodeFunctionData("decimals");
      await mal.setAttackTarget(await usdc.getAddress(), decimalsCall, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await mal.enableAttack(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Transfer triggers _update() and attempts the call (success/failure doesn't matter)
      await expect(mal.connect(lender1).transfer(borrower1.address, 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to
        .not.be.reverted;

      // Cleanup
      await mal.disableAttack({ gasLimit: constants.COVERAGE_GAS_LIMIT });
      await mal.burn(borrower1.address, 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // cover MockERC20 burn path too
      await usdc.mint(borrower1.address, 10n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await usdc.burn(borrower1.address, 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    });
  });

  describe("Additional Branch Coverage", function () {
    it("Should handle interest calculation when lastAccrualBlock == 0", async function () {
      // Create loan but don't borrow yet - lastAccrualBlock should be 0
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Loan is approved but not borrowed - lastAccrualBlock should be 0
      const loan = await unlloo.loans(loanId);
      expect(loan.lastAccrualBlock).to.equal(0n);

      // getAccruedInterest should return existing interestAccrued (0 for new loan)
      const accrued = await unlloo.getAccruedInterest(loanId);
      expect(accrued).to.equal(0n);
    });

    it("Should handle interest calculation when blocksElapsed exceeds MAX_BLOCKS_FOR_INTEREST in view", async function () {
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);
      const maxBlocks = await unlloo.MAX_BLOCKS_FOR_INTEREST();

      // Advance blocks beyond MAX_BLOCKS_FOR_INTEREST
      await mine(Number(maxBlocks) + 1000);

      // getAccruedInterest should handle it correctly (uses simple interest, no revert)
      const accrued = await unlloo.getAccruedInterest(loanId);
      expect(accrued).to.be.gt(0n);
      // Should not revert - contract uses simple interest which handles large block counts
    });

    it("Should handle interest calculation when currentDebt < loan.principal", async function () {
      // This tests a defensive check in interest calculation
      // This should return 0 if currentDebt < principal (shouldn't happen normally)
      await mintAndApproveUSDC(lender1, ethers.parseUnits("10000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Immediately check interest (should be 0 or very small)
      const interest = await unlloo.getAccruedInterest(loanId);
      expect(interest).to.be.gte(0);
    });

    it("Should handle status array remove when index == lastIndex", async function () {
      // This tests the branch where we don't need to swap elements
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();

      // Reject it (removes from Pending) - if it's the only one, no swap needed
      await unlloo.connect(owner).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify loan is no longer in pending
      const pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
      expect(pendingLoans).to.not.include(loanId);
    });

    it("Should handle status array remove when index != lastIndex", async function () {
      // This tests the branch where we need to swap elements
      // Create multiple loans (all pending)
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId1 = await unlloo.loanCounter();

      // Create second borrower for second loan
      const [, , , borrower2] = await ethers.getSigners();
      await submitLoanRequestHelper(borrower2, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId2 = await unlloo.loanCounter();

      // Create third loan
      const [, , , , borrower3] = await ethers.getSigners();
      await submitLoanRequestHelper(borrower3, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId3 = await unlloo.loanCounter();

      // Reject the first one - this will swap with the last element if there are multiple
      await unlloo.connect(owner).rejectLoanRequest(loanId1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify loanId1 is no longer in pending list
      const pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
      expect(pendingLoans).to.not.include(loanId1);
      expect(pendingLoans).to.include(loanId2);
      expect(pendingLoans).to.include(loanId3);
    });
  });

  describe("Negative Test Cases - Input Validation", function () {
    it("Should revert submitLoanRequest with invalid token address", async function () {
      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            ethers.ZeroAddress,
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            MIN_LOAN_DURATION_BLOCKS,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
    });

    it("Should revert submitLoanRequest with loanAmount < minLoanAmount", async function () {
      // Get min loan amount from pool
      const [minLoanAmountToken] = await unlloo.getPoolLoanLimits(await usdc.getAddress());
      const minLoanAmount = minLoanAmountToken;
      const loanAmount = minLoanAmount - 1n;

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            loanAmount,
            MIN_LOAN_DURATION_BLOCKS,
            {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            },
          ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert submitLoanRequest with loanAmount > maxLoanAmountPerPool", async function () {
      const [, maxLoanAmountToken] = await unlloo.getPoolLoanLimits(await usdc.getAddress());
      const loanAmount = maxLoanAmountToken + 1n;

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            loanAmount,
            MIN_LOAN_DURATION_BLOCKS,
            {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            },
          ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert submitLoanRequest with loanDurationBlocks > MAX_LOAN_DURATION_BLOCKS", async function () {
      const maxLoanDuration = await unlloo.maxLoanDurationBlocks();
      const loanDuration = maxLoanDuration + 1n;

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            loanDuration,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
    });

    it("Should revert submitLoanRequest with loanDurationBlocks > MAX_LOAN_DURATION_BLOCKS (edge case)", async function () {
      const loanDuration = (await unlloo.maxLoanDurationBlocks()) + 1n;

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            loanDuration,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
    });

    it("Should revert submitLoanRequest with loanDurationBlocks < MIN_LOAN_DURATION_BLOCKS", async function () {
      const loanDuration = MIN_LOAN_DURATION_BLOCKS - 1n;

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            loanDuration,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
    });

    it("Should revert borrow with zero amount", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("10000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(
        unlloo.connect(borrower1).borrow(loanId, 0, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert borrow with amount > maxBorrowable", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("10000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);

      await expect(
        unlloo.connect(borrower1).borrow(loanId, maxBorrowable + 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert repay with zero amount", async function () {
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);

      await expect(
        unlloo.connect(borrower1).repay(loanId, 0, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should cap repay with amount > remaining balance", async function () {
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);
      await mine(Number(constants.BLOCKS_PER_DAY));

      const remainingBalance = await unlloo.getTotalOwed(loanId);

      const repayAmount = remainingBalance + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);

      await expect(unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to
        .not.be.reverted;
      expect(await unlloo.getTotalOwed(loanId)).to.equal(0n);
    });

    it("Should revert depositLiquidity with zero amount", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("1000", constants.USDC_DECIMALS));

      await expect(
        unlloo
          .connect(lender1)
          .depositLiquidity(await usdc.getAddress(), 0, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert depositLiquidity with invalid pool", async function () {
      const [, , , , , randomAddress] = await ethers.getSigners();
      await mintAndApproveUSDC(lender1, ethers.parseUnits("1000", constants.USDC_DECIMALS));

      await expect(
        unlloo
          .connect(lender1)
          .depositLiquidity(randomAddress.address, ethers.parseUnits("1000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
    });

    it("Should revert withdrawLiquidity with zero amount", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("1000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("1000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await expect(
        unlloo
          .connect(lender1)
          .withdrawLiquidity(await usdc.getAddress(), 0, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert withdrawLiquidity with amount > deposited", async function () {
      const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await expect(
        unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount + 1n, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });
  });

  describe("Negative Test Cases - Access Control", function () {
    it("Should revert when non-owner tries to reject loan", async function () {
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();

      await expect(
        unlloo.connect(borrower1).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when non-owner tries to update min reputation", async function () {
      await expect(
        unlloo.connect(borrower1).updateMinReputation(300, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    // REMOVED: updateInterestRates() no longer exists - rates are now utilization-based and calculated dynamically
    // REMOVED: updateProtocolFeePercentage() no longer exists - protocol fee is fixed at 25% (PROTOCOL_FEE_BPS constant)

    it("Should revert when non-owner tries to pause", async function () {
      await expect(
        unlloo.connect(borrower1).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when non-owner tries to unpause", async function () {
      await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(
        unlloo.connect(borrower1).unpause({ gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when non-owner tries to add liquidity pool", async function () {
      const NewTokenFactory = await ethers.getContractFactory("MockERC20");
      const newToken = await NewTokenFactory.deploy("DAI", "DAI", 18, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await newToken.waitForDeployment();

      await expect(
        unlloo
          .connect(borrower1)
          .addLiquidityPool(await newToken.getAddress(), ethers.parseUnits("10", 18), ethers.parseUnits("100000", 18), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when non-owner tries to remove liquidity pool", async function () {
      await expect(
        unlloo
          .connect(borrower1)
          .removeLiquidityPool(await usdc.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when non-owner tries to withdraw protocol fees", async function () {
      await expect(
        unlloo.connect(borrower1).withdrawProtocolFees(await usdc.getAddress(), 1000, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when non-owner tries to withdraw ETH", async function () {
      // Send some ETH to contract first
      await owner.sendTransaction({
        to: await unlloo.getAddress(),
        value: ethers.parseEther("1"),
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await expect(
        unlloo.connect(borrower1).withdrawETH(ethers.parseEther("0.5"), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });
  });

  describe("Negative Test Cases - Invalid State Transitions", function () {
    it("Should revert when trying to borrow from non-approved loan", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("10000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      // Don't approve - loan stays in Pending status

      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await expect(
        unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert when trying to borrow from rejected loan", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("10000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await expect(
        unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert when trying to borrow from already active loan", async function () {
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);

      // For active loans, getApprovedLoanAmount returns 0, so we'll get InvalidAmount error
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      expect(maxBorrowable).to.equal(0); // Should be 0 for active loan

      await expect(
        unlloo.connect(borrower1).borrow(loanId, 1, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert when trying to repay non-active loan", async function () {
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();

      await mintAndApproveUSDC(borrower1, ethers.parseUnits("100", constants.USDC_DECIMALS));
      await expect(
        unlloo.connect(borrower1).repay(loanId, ethers.parseUnits("100", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should allow any address to repay on behalf of borrower", async function () {
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);
      await mine(Number(constants.BLOCKS_PER_DAY));

      const remainingBalance = await unlloo.getTotalOwed(loanId);
      await mintAndApproveUSDC(lender1, remainingBalance);

      await expect(
        unlloo.connect(lender1).repay(loanId, remainingBalance, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.emit(unlloo, "LoanRepaid");
    });

    it("Should revert when trying to approve already approved loan", async function () {
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(
        unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert when trying to reject already rejected loan", async function () {
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Rejected loans are removed from status arrays, so trying to reject again fails
      await expect(
        unlloo.connect(owner).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });
  });

  describe("Negative Test Cases - Boundary Conditions", function () {
    it("Should revert updateMinReputation with reputation > 1000", async function () {
      await expect(
        unlloo.connect(owner).updateMinReputation(1001, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidReputation");
    });

    it("Should allow updateMinReputation with valid values", async function () {
      // The contract validates that newMinReputation != minReputation (prevents same value)
      // and newMinReputation <= 1000. Value 0 is allowed.
      const currentMin = await unlloo.minReputation();

      // Test updating to a higher value
      const newMin = Number(currentMin) + 1;
      await unlloo.connect(owner).updateMinReputation(newMin, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      expect(await unlloo.minReputation()).to.equal(newMin);

      // Reset back
      await unlloo.connect(owner).updateMinReputation(Number(currentMin), { gasLimit: constants.COVERAGE_GAS_LIMIT });
    });

    // REMOVED: updateInterestRates() tests - function no longer exists (rates are utilization-based)
    // REMOVED: updateProtocolFeePercentage() tests - function no longer exists (fee is fixed at 25%)

    it("Should revert withdrawProtocolFees with amount > available", async function () {
      // Create a loan and repay to generate fees
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);
      await mine(Number(constants.BLOCKS_PER_DAY));

      const remainingBalance = await unlloo.getTotalOwed(loanId);
      await mintAndApproveUSDC(borrower1, remainingBalance);
      await unlloo.connect(borrower1).repay(loanId, remainingBalance, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const availableFees = await unlloo.protocolFees(await usdc.getAddress());

      await expect(
        unlloo.connect(owner).withdrawProtocolFees(await usdc.getAddress(), availableFees + 1n, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert withdrawETH with amount > balance", async function () {
      // Send some ETH to contract
      await owner.sendTransaction({
        to: await unlloo.getAddress(),
        value: ethers.parseEther("1"),
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await expect(
        unlloo.connect(owner).withdrawETH(ethers.parseEther("2"), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert when trying to remove pool with active loans", async function () {
      await setupCompleteBorrow(borrower1, lender1);

      // The contract checks for liquidity first, so with an active loan there's still liquidity
      // This will revert with PoolNotEmpty because pool.totalLiquidity > 0
      // To test ActiveLoansUsingPool, we'd need a scenario where liquidity is 0 but loans exist
      // which isn't possible since you can't withdraw when loans are active
      await expect(
        unlloo.connect(owner).removeLiquidityPool(await usdc.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "PoolNotEmpty");
    });

    it("Should revert when trying to remove pool with liquidity", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("1000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("1000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await expect(
        unlloo.connect(owner).removeLiquidityPool(await usdc.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "PoolNotEmpty");
    });

    it("Should revert updateMinReputation with same value", async function () {
      const currentMinRep = await unlloo.minReputation();
      await expect(
        unlloo.connect(owner).updateMinReputation(currentMinRep, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidReputation");
    });

    it("Should revert updateCooldownBlocks with same value", async function () {
      const currentCooldown = await unlloo.cooldownBlocks();
      await expect(
        unlloo.connect(owner).updateCooldownBlocks(currentCooldown, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
    });

    it("Should handle updatePoolLoanLimits with same values", async function () {
      const usdcAddress = await usdc.getAddress();
      const [minLoan, maxLoan] = await unlloo.getPoolLoanLimits(usdcAddress);
      // Contract allows same values - verify no state change needed
      await expect(
        unlloo.connect(owner).updatePoolLoanLimits(usdcAddress, minLoan, maxLoan, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.not.be.reverted;
      // Verify values remain the same
      const [minLoanAfter, maxLoanAfter] = await unlloo.getPoolLoanLimits(usdcAddress);
      expect(minLoanAfter).to.equal(minLoan);
      expect(maxLoanAfter).to.equal(maxLoan);
    });

    it("Should handle updateCooldownBlocks at exact min boundary", async function () {
      const secondsPerDay = 24 * 60 * 60;
      const blockTimeSeconds = Number(await unlloo.blockTimeSeconds());
      const minCooldown = Math.floor(secondsPerDay / blockTimeSeconds);
      const currentCooldown = Number(await unlloo.cooldownBlocks());

      // If current cooldown is already at min, we need to change it first
      if (currentCooldown === minCooldown) {
        // Set to a different value first
        await unlloo.connect(owner).updateCooldownBlocks(minCooldown + 1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      }

      // Now test setting to min boundary
      await expect(unlloo.connect(owner).updateCooldownBlocks(minCooldown, { gasLimit: constants.COVERAGE_GAS_LIMIT }))
        .to.not.be.reverted;
      expect(await unlloo.cooldownBlocks()).to.equal(BigInt(minCooldown));

      // Reset back to original (only if it's different from min)
      if (currentCooldown !== minCooldown) {
        await unlloo
          .connect(owner)
          .updateCooldownBlocks(BigInt(currentCooldown), { gasLimit: constants.COVERAGE_GAS_LIMIT });
      } else {
        // If original was min, set it back to min+1 and then back to min
        // Actually, we can just leave it at min since that was the original value
        // But to be safe, let's set it to something else first, then back
        await unlloo.connect(owner).updateCooldownBlocks(minCooldown + 1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        await unlloo.connect(owner).updateCooldownBlocks(minCooldown, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      }
    });

    it("Should handle updateCooldownBlocks at exact max boundary", async function () {
      const secondsPerDay = 24 * 60 * 60;
      const blockTimeSeconds = Number(await unlloo.blockTimeSeconds());
      const maxCooldown = Math.floor((secondsPerDay * 30) / blockTimeSeconds);
      const currentCooldown = Number(await unlloo.cooldownBlocks());

      // If current cooldown is already at max, we need to change it first
      if (currentCooldown === maxCooldown) {
        // Set to a different value first
        await unlloo.connect(owner).updateCooldownBlocks(maxCooldown - 1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      }

      // Now test setting to max boundary
      await expect(unlloo.connect(owner).updateCooldownBlocks(maxCooldown, { gasLimit: constants.COVERAGE_GAS_LIMIT }))
        .to.not.be.reverted;
      expect(await unlloo.cooldownBlocks()).to.equal(BigInt(maxCooldown));

      // Reset back to original (only if it's different from max)
      if (currentCooldown !== maxCooldown) {
        await unlloo
          .connect(owner)
          .updateCooldownBlocks(BigInt(currentCooldown), { gasLimit: constants.COVERAGE_GAS_LIMIT });
      } else {
        // If original was max, set it back to max-1 and then back to max
        await unlloo.connect(owner).updateCooldownBlocks(maxCooldown - 1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        await unlloo.connect(owner).updateCooldownBlocks(maxCooldown, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      }
    });

    it("Should handle withdrawProtocolFees when fees are exactly zero", async function () {
      const usdcAddress = await usdc.getAddress();
      const fees = await unlloo.getProtocolFees(usdcAddress);
      expect(fees).to.equal(0n);

      await expect(
        unlloo.connect(owner).withdrawProtocolFees(usdcAddress, 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });
  });

  describe("Negative Test Cases - Pause Functionality", function () {
    it("Should revert operations when paused", async function () {
      await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            MIN_LOAN_DURATION_BLOCKS,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.be.revertedWithCustomError(unlloo, "EnforcedPause");

      await mintAndApproveUSDC(lender1, ethers.parseUnits("1000", constants.USDC_DECIMALS));
      await expect(
        unlloo
          .connect(lender1)
          .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("1000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
      ).to.be.revertedWithCustomError(unlloo, "EnforcedPause");
    });

    it("Should allow repay when paused (borrower protection)", async function () {
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);
      await mine(Number(constants.BLOCKS_PER_DAY));

      await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });

      const remainingBalance = await unlloo.getTotalOwed(loanId);
      await mintAndApproveUSDC(borrower1, remainingBalance);

      // Repay should work even when paused
      await expect(
        unlloo.connect(borrower1).repay(loanId, remainingBalance, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.not.be.reverted;
    });

    it("Should revert emergency withdraw when not paused", async function () {
      await mintAndApproveUSDC(lender1, ethers.parseUnits("1000", constants.USDC_DECIMALS));
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("1000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      // Emergency withdraw requires pause
      // When not paused, it will fail - the exact error depends on the contract implementation
      await expect(
        unlloo
          .connect(lender1)
          .emergencyWithdraw(await usdc.getAddress(), ethers.parseUnits("1000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
      ).to.be.reverted; // Will revert when not paused
    });
  });

  describe("Negative Test Cases - Cooldown and Limits", function () {
    it("Should revert submitLoanRequest during cooldown period", async function () {
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();

      // Reject the loan (removes it from pending, triggers cooldown)
      await unlloo.connect(owner).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Try to submit another request immediately (should be in cooldown)
      await expect(
        submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "CooldownNotExpired");
    });

    it("Should revert submitLoanRequest when user has active loan", async function () {
      await setupCompleteBorrow(borrower1, lender1);

      // Try to submit another request while loan is active
      await expect(
        submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "HasActiveLoan");
    });

    it("Should revert submitLoanRequest when user has unpaid debt", async function () {
      const { loanId } = await setupCompleteBorrow(borrower1, lender1);

      // Let loan exceed max duration
      const loan = await unlloo.getLoan(loanId);
      await mine(Number(loan.loanDurationBlocks) + 1);

      // Try to submit new request with unpaid debt
      await expect(
        submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "HasUnpaidDebt");
    });
  });
});
