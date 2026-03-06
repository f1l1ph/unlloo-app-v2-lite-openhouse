import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Unlloo, MockERC20, MockPriceFeed, UnllooProxy } from "../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import * as constants from "./fixtures/constants";

/**
 * @title Surplus Calculation Test Suite
 * @notice Comprehensive tests for the fixed surplus calculation in withdrawLiquidity()
 * @dev Tests verify that surplus calculation correctly excludes principal deposits
 *      and only includes interest portion available to lenders
 */
describe("Unlloo - Surplus Calculation", function () {
  // Contract instances
  let unlloo: Unlloo;
  let usdc: MockERC20;
  let priceFeed: MockPriceFeed;

  // Signers
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let borrower2: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;
  let lender2: HardhatEthersSigner;

  // Helper to mint and approve USDC
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

  // Helper to calculate expected interest using simple interest formula
  // Simple interest: I = P * r * t
  // r = rateBps / 10000 (annual rate in basis points)
  // t = blocksElapsed / blocksPerYear
  async function calculateExpectedInterest(principal: bigint, blocksElapsed: bigint, rateBps: bigint): Promise<bigint> {
    const blocksPerYear = constants.BLOCKS_PER_YEAR;
    if (blocksPerYear === 0n) return 0n;
    return (principal * rateBps * blocksElapsed) / (10000n * blocksPerYear);
  }

  beforeEach(async function () {
    // Get signers
    [owner, borrower1, borrower2, lender1, lender2] = await ethers.getSigners();

    // Deploy MockERC20 (USDC)
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = (await MockERC20Factory.deploy("USD Coin", "USDC", constants.USDC_DECIMALS, {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    })) as MockERC20;
    await usdc.waitForDeployment();

    // Deploy MockPriceFeed
    const MockPriceFeedFactory = await ethers.getContractFactory("MockPriceFeed");
    priceFeed = (await MockPriceFeedFactory.deploy(constants.USDC_PRICE, constants.PRICE_FEED_DECIMALS, {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    })) as MockPriceFeed;
    await priceFeed.waitForDeployment();

    // Deploy Unlloo implementation
    // REMOVED: InterestCalculator no longer exists - contract uses simple interest internally
    const UnllooFactory = await ethers.getContractFactory("Unlloo");
    const unllooImpl = (await UnllooFactory.deploy({
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    })) as Unlloo;
    await unllooImpl.waitForDeployment();

    // Initialize via proxy
    const usdcAddress = await usdc.getAddress();
    const minLoanAmount = constants.parseUSDC(constants.MIN_LOAN_AMOUNT_USD);
    const maxLoanAmount = constants.parseUSDC(constants.MAX_LOAN_AMOUNT_USD);

    const initData = unllooImpl.interface.encodeFunctionData("initialize", [
      usdcAddress,
      constants.BLOCK_TIME_SECONDS,
      owner.address,
      minLoanAmount,
      maxLoanAmount,
    ]);

    const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
    const proxy = (await UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    })) as UnllooProxy;
    await proxy.waitForDeployment();

    unlloo = UnllooFactory.attach(await proxy.getAddress()) as Unlloo;

    // Note: Interest rates are already set in constructor (1200 bps borrower, 900 bps lender)
    // Protocol fee is also set in constructor (2500 bps = 25%)
    // No need to update them unless we want different values
    // If different rates are needed, update them here:
    // await unlloo.updateInterestRates(BORROWER_RATE_BPS, LENDER_RATE_BPS, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    // Mine blocks to allow new users to submit requests
    await mine(await unlloo.cooldownBlocks());

    // Refresh price feed timestamp after mining
  });

  describe("Test Case 1: Single Lender, Single Borrower, Full Withdrawal", function () {
    it("Should calculate surplus correctly when lender withdraws full position", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS); // 10,000 USDC
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS); // 5,000 USDC

      // Step 1: Lender deposits
      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Step 2: Borrower requests and gets approved
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Step 3: Borrower borrows
      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Step 4: Advance time (30 days)
      await mine(constants.BLOCKS_30_DAYS);

      // Step 5: Derive interest from on-chain state (index rounding makes exact off-chain calculation brittle)
      const totalOwed = await unlloo.getTotalOwed(loanId);
      const actualBorrowerInterest = totalOwed - borrowAmount;
      const expectedProtocolFee = (actualBorrowerInterest * BigInt(constants.PROTOCOL_FEE_BPS)) / 10000n;
      const expectedLenderSurplus = actualBorrowerInterest - expectedProtocolFee;

      // Step 6: Borrower repays (with buffer; contract caps)
      const repayAmount = totalOwed + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Step 7: Verify state before withdrawal
      const contractBalanceBefore = await usdc.balanceOf(await unlloo.getAddress());
      const totalLiquidityBefore = (await unlloo.getLiquidityPool(await usdc.getAddress())).totalLiquidity;
      const protocolFeesBefore = await unlloo.protocolFees(await usdc.getAddress());

      // Verify surplus calculation
      const expectedSurplus = contractBalanceBefore - totalLiquidityBefore - protocolFeesBefore;
      expect(expectedSurplus).to.be.closeTo(
        expectedLenderSurplus,
        200n,
        "Surplus should equal lender's share of interest",
      );

      // Step 8: Lender withdraws full position
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      // Step 9: Verify correct surplus calculation
      const actualWithdrawal = lenderBalanceAfter - lenderBalanceBefore;
      const actualInterest = actualWithdrawal - depositAmount;

      expect(actualInterest).to.be.closeTo(expectedLenderSurplus, 500n, "Lender should receive correct interest");
      expect(actualWithdrawal).to.equal(
        depositAmount + actualInterest,
        "Total withdrawal should be principal + interest",
      );

      // Verify contract state after withdrawal
      const contractBalanceAfter = await usdc.balanceOf(await unlloo.getAddress());
      expect(contractBalanceAfter).to.equal(protocolFeesBefore, "Only protocol fees should remain");
    });
  });

  describe("Test Case 2: Partial Withdrawal", function () {
    it("Should calculate surplus correctly for partial withdrawals", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);
      const withdrawAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS); // 50% withdrawal

      // Setup same as Test Case 1
      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await mine(constants.BLOCKS_30_DAYS);

      const totalOwed = await unlloo.getTotalOwed(loanId);
      const actualBorrowerInterest = totalOwed - borrowAmount;
      const expectedProtocolFee = (actualBorrowerInterest * BigInt(constants.PROTOCOL_FEE_BPS)) / 10000n;
      const expectedTotalSurplus = actualBorrowerInterest - expectedProtocolFee;

      const repayAmount = totalOwed + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Partial withdrawal
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      const actualWithdrawal = lenderBalanceAfter - lenderBalanceBefore;
      const actualInterest = actualWithdrawal - withdrawAmount;

      // Expected interest is pro-rated
      const expectedInterest = (expectedTotalSurplus * withdrawAmount) / depositAmount;

      // Allow small rounding differences
      expect(actualInterest).to.be.closeTo(
        expectedInterest,
        500n,
        "Partial withdrawal should receive pro-rated interest",
      );

      // Verify remaining liquidity
      const poolAfter = await unlloo.getLiquidityPool(await usdc.getAddress());
      expect(poolAfter.totalLiquidity).to.equal(
        depositAmount - withdrawAmount,
        "Remaining liquidity should be correct",
      );
    });
  });

  describe("Test Case 3: Multiple Lenders, Fair Distribution", function () {
    it("Should fairly distribute surplus among multiple lenders", async function () {
      const lender1Deposit = ethers.parseUnits("6000", constants.USDC_DECIMALS); // 60%
      const lender2Deposit = ethers.parseUnits("4000", constants.USDC_DECIMALS); // 40%
      const totalDeposit = lender1Deposit + lender2Deposit;
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);

      // Both lenders deposit
      await mintAndApproveUSDC(lender1, lender1Deposit);
      await mintAndApproveUSDC(lender2, lender2Deposit);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), lender1Deposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await unlloo.connect(lender2).depositLiquidity(await usdc.getAddress(), lender2Deposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrower borrows and repays
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await mine(constants.BLOCKS_30_DAYS);

      const totalOwed = await unlloo.getTotalOwed(loanId);
      const actualBorrowerInterest = totalOwed - borrowAmount;
      const expectedProtocolFee = (actualBorrowerInterest * BigInt(constants.PROTOCOL_FEE_BPS)) / 10000n;
      const expectedTotalSurplus = actualBorrowerInterest - expectedProtocolFee;

      const repayAmount = totalOwed + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Lender 1 withdraws
      const lender1BalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), lender1Deposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lender1BalanceAfter = await usdc.balanceOf(lender1.address);
      const lender1Interest = lender1BalanceAfter - lender1BalanceBefore - lender1Deposit;

      // Lender 2 withdraws
      const lender2BalanceBefore = await usdc.balanceOf(lender2.address);
      await unlloo.connect(lender2).withdrawLiquidity(await usdc.getAddress(), lender2Deposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lender2BalanceAfter = await usdc.balanceOf(lender2.address);
      const lender2Interest = lender2BalanceAfter - lender2BalanceBefore - lender2Deposit;

      // Verify fair distribution
      const expectedLender1Interest = (expectedTotalSurplus * lender1Deposit) / totalDeposit;
      const expectedLender2Interest = (expectedTotalSurplus * lender2Deposit) / totalDeposit;

      expect(lender1Interest).to.be.closeTo(
        expectedLender1Interest,
        500n,
        "Lender 1 should receive proportional interest",
      );
      expect(lender2Interest).to.be.closeTo(
        expectedLender2Interest,
        500n,
        "Lender 2 should receive proportional interest",
      );

      // Verify total interest distributed equals surplus
      const totalInterestDistributed = lender1Interest + lender2Interest;
      expect(totalInterestDistributed).to.be.closeTo(
        expectedTotalSurplus,
        1000n,
        "Total interest should equal surplus",
      );
    });
  });

  describe("Test Case 4: No Borrowers (Zero Surplus)", function () {
    it("Should return zero interest when no borrowers exist", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Lender deposits
      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Advance 30 days (no borrowers)
      await mine(constants.BLOCKS_30_DAYS);

      // Verify state before withdrawal
      const contractBalanceBefore = await usdc.balanceOf(await unlloo.getAddress());
      const totalLiquidityBefore = (await unlloo.getLiquidityPool(await usdc.getAddress())).totalLiquidity;
      const protocolFeesBefore = await unlloo.protocolFees(await usdc.getAddress());

      // Surplus should be zero
      const expectedSurplus = contractBalanceBefore - totalLiquidityBefore - protocolFeesBefore;
      expect(expectedSurplus).to.equal(0n, "Surplus should be zero when no borrowers");

      // Withdraw full amount
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      const actualWithdrawal = lenderBalanceAfter - lenderBalanceBefore;
      const actualInterest = actualWithdrawal - depositAmount;

      // Assertions
      expect(actualInterest).to.equal(0n, "Lender should receive zero interest when no borrowers");
      expect(actualWithdrawal).to.equal(depositAmount, "Withdrawal should equal deposit only");
    });
  });

  describe("Test Case 5: Multiple Borrowers, Multiple Repayments", function () {
    it("Should calculate surplus correctly with multiple borrowers", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount1 = ethers.parseUnits("3000", constants.USDC_DECIMALS);
      const borrowAmount2 = ethers.parseUnits("2000", constants.USDC_DECIMALS);

      // Lender deposits
      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrower 1 borrows
      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId1 = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(borrower1).borrow(loanId1, borrowAmount1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Borrower 2 borrows
      await mine(await unlloo.cooldownBlocks());
      // Refresh price feed after mining blocks to prevent stale price error
      await submitLoanRequestHelper(borrower2, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId2 = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId2, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(borrower2).borrow(loanId2, borrowAmount2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Advance time
      await mine(constants.BLOCKS_30_DAYS);

      // Derive interest from on-chain totals (per-loan fee rounding matters).
      const totalOwed1 = await unlloo.getTotalOwed(loanId1);
      const totalOwed2 = await unlloo.getTotalOwed(loanId2);
      const interest1 = totalOwed1 - borrowAmount1;
      const interest2 = totalOwed2 - borrowAmount2;
      const totalInterest = interest1 + interest2;
      const expectedProtocolFee =
        (interest1 * BigInt(constants.PROTOCOL_FEE_BPS)) / 10000n +
        (interest2 * BigInt(constants.PROTOCOL_FEE_BPS)) / 10000n;
      const expectedSurplus = totalInterest - expectedProtocolFee;

      // Borrower 1 repays
      const repayAmount1 = totalOwed1 + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount1);
      await unlloo.connect(borrower1).repay(loanId1, repayAmount1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Borrower 2 repays
      const repayAmount2 = totalOwed2 + 1_000_000n;
      await mintAndApproveUSDC(borrower2, repayAmount2);
      await unlloo.connect(borrower2).repay(loanId2, repayAmount2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify surplus
      const contractBalance = await usdc.balanceOf(await unlloo.getAddress());
      const totalLiquidity = (await unlloo.getLiquidityPool(await usdc.getAddress())).totalLiquidity;
      const protocolFees = await unlloo.protocolFees(await usdc.getAddress());
      const actualSurplus = contractBalance - totalLiquidity - protocolFees;

      expect(actualSurplus).to.be.closeTo(expectedSurplus, 2000n, "Surplus should equal total lender interest");

      // Lender withdraws
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);
      const actualInterest = lenderBalanceAfter - lenderBalanceBefore - depositAmount;

      expect(actualInterest).to.be.closeTo(expectedSurplus, 2000n, "Lender should receive all surplus");
    });
  });

  describe("Test Case 6: Edge Case - 100% Utilization", function () {
    it("Should calculate surplus correctly when all liquidity is borrowed", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS); // 100% utilization

      // Setup
      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify 100% utilization
      const pool = await unlloo.getLiquidityPool(await usdc.getAddress());
      expect(pool.borrowedAmount).to.equal(pool.totalLiquidity, "Pool should be 100% utilized");

      await mine(constants.BLOCKS_30_DAYS);

      // Get actual accrued interest from contract (index-based calculation)
      const actualAccruedInterest = await unlloo.getAccruedInterest(loanId);

      // Borrower repays using actual accrued interest (not theoretical)
      const totalRepayment = borrowAmount + actualAccruedInterest;
      const repayAmount = totalRepayment + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Calculate expected surplus from actual contract state BEFORE withdrawal
      // After repayment: contractBalance = depositAmount - borrowAmount + totalRepayment
      //                 = depositAmount + actualInterest
      // surplus = contractBalance - totalLiquidity - protocolFees
      const contractBalanceBefore = await usdc.balanceOf(await unlloo.getAddress());
      const totalLiquidityBefore = (await unlloo.getLiquidityPool(await usdc.getAddress())).totalLiquidity;
      const protocolFeesBefore = await unlloo.protocolFees(await usdc.getAddress());
      const expectedSurplus = contractBalanceBefore - totalLiquidityBefore - protocolFeesBefore;

      // Get lender position to understand modeled interest
      const lenderPosition = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());

      // Withdraw
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      const actualInterest = lenderBalanceAfter - lenderBalanceBefore - depositAmount;

      // IMPORTANT: Lender interest is NOT calculated using lenderRateBps.
      // The actual flow is:
      // 1. Borrower pays interest (accrued via borrowIndex at borrowerRateBps)
      // 2. Protocol fee is deducted: protocolFee = floor(interestPaid * protocolFeePercentageAtBorrow / 10000)
      // 3. Net interest goes to lenders via supply-index: lendersInterest = interestPaid - protocolFee
      //
      // So lender receives their share of: borrowerInterest - protocolFee
      // NOT: interest calculated at lenderRateBps
      //
      // lenderRateBps is a configuration parameter stored in the contract but NOT used
      // in the actual payout calculation. It could be used for rate limiting or display purposes.
      //
      // The "surplus" concept here is: contractBalance - totalLiquidity - protocolFees
      // which represents the net interest available to lenders.

      // The contract calculates interest during withdrawal, which may have slight rounding differences
      // from getLenderPosition (which is a view function). The actual interest received is the
      // source of truth.

      // Get the lender's accrued interest (from view function, may differ slightly from actual)
      const lenderAccruedInterest = lenderPosition.accruedInterest;

      // Expected interest is the min of accrued and available surplus
      // But allow small tolerance for rounding differences in:
      // 1. Pro-rating calculation: (fullInterest * amount) / position.depositedAmount
      // 2. Contract balance cap that might reduce interest slightly
      // 3. Block differences between view and actual withdrawal
      const expectedInterest = lenderAccruedInterest < expectedSurplus ? lenderAccruedInterest : expectedSurplus;

      // Allow small tolerance for rounding (57 units is ~0.00008% - negligible)
      // This accounts for integer division rounding and contract balance cap
      const tolerance = 100n; // Allow up to 100 units difference for rounding

      // Verify lender gets approximately min(accruedInterest, surplus)
      expect(actualInterest).to.be.closeTo(
        expectedInterest,
        tolerance,
        "Lender should receive approximately min(accruedInterest, surplus) with small rounding tolerance",
      );

      // Verify it doesn't exceed surplus
      expect(actualInterest).to.be.lte(expectedSurplus, "Lender interest should not exceed surplus");

      // Verify it's close to the accrued interest (should be within rounding)
      expect(actualInterest).to.be.closeTo(
        lenderAccruedInterest,
        tolerance,
        "Actual interest should be close to accrued interest (within rounding tolerance)",
      );
    });
  });

  describe("Test Case 7: Partial Repayment Scenario", function () {
    it("Should handle partial repayments correctly", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);

      // Setup
      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Get actual rate from loan
      const loan = await unlloo.getLoan(loanId);
      const actualBorrowerRateBps = loan.borrowRateBps;

      await mine(constants.BLOCKS_30_DAYS);

      const expectedInterest = await calculateExpectedInterest(
        borrowAmount,
        constants.BLOCKS_30_DAYS,
        actualBorrowerRateBps,
      );

      // Partial repayment (principal + interest for half the principal)
      const partialPrincipal = borrowAmount / 2n;
      const partialInterest = expectedInterest / 2n;
      const partialRepayment = partialPrincipal + partialInterest;

      await mintAndApproveUSDC(borrower1, partialRepayment);
      await unlloo.connect(borrower1).repay(loanId, partialRepayment, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify surplus is limited by actual interest collected
      // Use actual contract state for expected surplus calculation (not theoretical)
      const contractBalance = await usdc.balanceOf(await unlloo.getAddress());
      const pool = await unlloo.getLiquidityPool(await usdc.getAddress());
      const totalLiquidity = pool.totalLiquidity;
      const freeLiquidity = totalLiquidity - pool.borrowedAmount;
      const protocolFees = await unlloo.protocolFees(await usdc.getAddress());
      // Surplus is cash above freeLiquidity + protocolFees (borrowed principal is not in the contract).
      const actualSurplus =
        contractBalance > freeLiquidity + protocolFees ? contractBalance - freeLiquidity - protocolFees : 0n;

      // Surplus calculation after partial repayment:
      // contractBalance = depositAmount - borrowAmount + partialRepayment
      //                 = 10,000 - 5,000 + (2,500 + partialInterest) = 7,500 + partialInterest
      // totalLiquidity = 10,000 (unchanged)
      // surplus = (7,500 + partialInterest) - 10,000 - protocolFees
      //         = partialInterest - 2,500 - protocolFees
      // This can be negative if partialInterest < 2,500 + protocolFees, which is expected
      // The contract correctly handles this by returning 0 interest when surplus <= 0

      // Withdraw
      const withdrawAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      const actualInterest = lenderBalanceAfter - lenderBalanceBefore - withdrawAmount;

      // Calculate expected interest based on actual surplus (not theoretical)
      // If surplus is negative or zero, lender gets no interest (correct behavior)
      const expectedLenderInterest = actualSurplus > 0n ? (actualSurplus * withdrawAmount) / depositAmount : 0n;

      // Use tolerance for rounding
      const tolerance =
        expectedLenderInterest > 0n
          ? expectedLenderInterest / 1000n > 100n
            ? expectedLenderInterest / 1000n
            : 100n
          : 0n;
      expect(actualInterest).to.be.closeTo(expectedLenderInterest, tolerance, "Interest should be pro-rated correctly");
    });
  });

  describe("Edge Cases and Boundary Conditions", function () {
    it("Should handle withdrawal when contractBalance equals totalLiquidity", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // No borrowers, so contractBalance = totalLiquidity
      const contractBalance = await usdc.balanceOf(await unlloo.getAddress());
      const totalLiquidity = (await unlloo.getLiquidityPool(await usdc.getAddress())).totalLiquidity;
      expect(contractBalance).to.equal(totalLiquidity, "Contract balance should equal total liquidity");

      // Surplus should be zero
      const protocolFees = await unlloo.protocolFees(await usdc.getAddress());
      const surplus = contractBalance - totalLiquidity - protocolFees;
      expect(surplus).to.equal(0n, "Surplus should be zero");

      // Withdraw should work and return only principal
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      expect(lenderBalanceAfter - lenderBalanceBefore).to.equal(depositAmount, "Should receive only principal");
    });

    it("Should handle withdrawal when contractBalance < totalLiquidity + protocolFees", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Withdraw immediately (no time for interest, no surplus)
      const withdrawAmount = depositAmount / 2n;
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);

      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);
      const actualInterest = lenderBalanceAfter - lenderBalanceBefore - withdrawAmount;

      // Should receive at least principal, interest might be 0
      expect(actualInterest).to.equal(0n, "Interest should be zero when no surplus exists");
      expect(lenderBalanceAfter - lenderBalanceBefore).to.equal(withdrawAmount, "Should receive principal");
    });

    it("Should prevent principal from being included in surplus calculation", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Get actual rate from loan
      const loan = await unlloo.getLoan(loanId);
      const actualBorrowerRateBps = loan.borrowRateBps;

      await mine(constants.BLOCKS_30_DAYS);

      const expectedInterest = await calculateExpectedInterest(
        borrowAmount,
        constants.BLOCKS_30_DAYS,
        actualBorrowerRateBps,
      );
      const totalRepayment = borrowAmount + expectedInterest;

      const repayAmount = totalRepayment + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify surplus calculation
      const contractBalance = await usdc.balanceOf(await unlloo.getAddress());
      const totalLiquidity = (await unlloo.getLiquidityPool(await usdc.getAddress())).totalLiquidity;
      const protocolFees = await unlloo.protocolFees(await usdc.getAddress());

      // Correct surplus calculation
      const correctSurplus = contractBalance - totalLiquidity - protocolFees;

      // Buggy calculation (what it would be with old code)
      const effectiveLiquidity = totalLiquidity - depositAmount; // Would be 0 for full withdrawal
      const buggySurplus = contractBalance - effectiveLiquidity - protocolFees;

      // Verify correct surplus does NOT include principal
      expect(correctSurplus).to.be.lt(buggySurplus, "Correct surplus should be less than buggy calculation");
      expect(correctSurplus).to.be.lt(depositAmount, "Surplus should never include principal");

      // Withdraw and verify
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      const actualInterest = lenderBalanceAfter - lenderBalanceBefore - depositAmount;
      expect(actualInterest).to.equal(correctSurplus, "Interest should equal correct surplus");
      expect(actualInterest).to.be.lt(buggySurplus, "Interest should be less than buggy calculation");
    });
  });

  describe("Mathematical Invariants", function () {
    it("Should maintain invariant: surplus <= (contractBalance - totalLiquidity) - protocolFees", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Get actual rate from loan
      const loan = await unlloo.getLoan(loanId);
      const actualBorrowerRateBps = loan.borrowRateBps;

      await mine(constants.BLOCKS_30_DAYS);

      const expectedInterest = await calculateExpectedInterest(
        borrowAmount,
        constants.BLOCKS_30_DAYS,
        actualBorrowerRateBps,
      );
      const totalRepayment = borrowAmount + expectedInterest;

      const repayAmount = totalRepayment + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify invariant
      const contractBalance = await usdc.balanceOf(await unlloo.getAddress());
      const totalLiquidity = (await unlloo.getLiquidityPool(await usdc.getAddress())).totalLiquidity;
      const protocolFees = await unlloo.protocolFees(await usdc.getAddress());

      const maxSurplus = contractBalance - totalLiquidity - protocolFees;
      expect(maxSurplus).to.be.gte(0n, "Surplus should be non-negative");

      // Withdraw and verify actual interest doesn't exceed max
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      const actualInterest = lenderBalanceAfter - lenderBalanceBefore - depositAmount;
      expect(actualInterest).to.be.lte(maxSurplus, "Actual interest should not exceed maximum surplus");
    });

    it("Should maintain invariant: total interest distributed + protocol fees = total borrower interest", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(lender1, depositAmount);
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(borrower1, constants.VALID_REPUTATION, 10000, constants.BLOCKS_30_DAYS);
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Get actual rate from loan
      const loan = await unlloo.getLoan(loanId);
      const actualBorrowerRateBps = loan.borrowRateBps;

      await mine(constants.BLOCKS_30_DAYS);

      const expectedBorrowerInterest = await calculateExpectedInterest(
        borrowAmount,
        constants.BLOCKS_30_DAYS,
        actualBorrowerRateBps,
      );
      const totalRepayment = borrowAmount + expectedBorrowerInterest;

      const repayAmount = totalRepayment + 1_000_000n;
      await mintAndApproveUSDC(borrower1, repayAmount);
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Withdraw
      const lenderBalanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const lenderBalanceAfter = await usdc.balanceOf(lender1.address);

      const lenderInterest = lenderBalanceAfter - lenderBalanceBefore - depositAmount;
      const protocolFeesAfter = await unlloo.protocolFees(await usdc.getAddress());

      // Verify invariant
      const totalDistributed = lenderInterest + protocolFeesAfter;
      expect(totalDistributed).to.be.closeTo(
        expectedBorrowerInterest,
        2000n,
        "Total distribution should equal borrower interest",
      );
    });
  });
});
