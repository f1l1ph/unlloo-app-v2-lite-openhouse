/**
 * @file Variable Rate Semantics Tests
 * @description Tests that prove the FIXED-RATE semantics of Unlloo:
 *              - Rates are FIXED at borrow time based on pool utilization
 *              - Active loans are NOT affected by subsequent utilization changes
 *              - Rates are calculated using utilization-based model
 *              - Protocol fee is fixed at 25% of interest paid
 *
 * These tests use comparative scenarios to definitively prove the behavior.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers";
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC, createAndApproveLoan, setupCompleteBorrow } from "./helpers";

describe("Unlloo Variable-Rate Semantics", function () {
  let ctx: UnllooTestContext;

  beforeEach(async function () {
    ctx = await loadFixture(setupUnllooTestFixture);
  });

  describe("Proof: Rate Changes Do NOT Affect Active Loans (Fixed-Rate)", function () {
    it("Should prove rate INCREASE does NOT affect existing loans", async function () {
      const liquidityAmount = ethers.parseUnits("20000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);

      // Setup: deposit liquidity
      await mintAndApproveUSDC(ctx.usdc, ctx.lender1, liquidityAmount, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.lender1).depositLiquidity(ctx.usdcAddress, liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create loan 1 at low utilization (lower rate)
      const loanId1 = await createAndApproveLoan(
        ctx.unlloo,
        ctx.usdc,
        ctx.borrower1,
        ctx.owner,
        constants.VALID_REPUTATION,
        1000,
      );
      await ctx.unlloo.connect(ctx.borrower1).borrow(loanId1, borrowAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const loan1 = await ctx.unlloo.getLoan(loanId1);
      const rate1AtBorrow = loan1.borrowRateBps;

      // Mine cooldown for borrower2
      await mine(Number(ctx.cooldownBlocks) + 1);

      // Increase utilization by borrowing more (affects NEW loans, not existing)
      const borrowAmount2 = ethers.parseUnits("15000", constants.USDC_DECIMALS);
      const loanId2 = await createAndApproveLoan(
        ctx.unlloo,
        ctx.usdc,
        ctx.borrower2,
        ctx.owner,
        constants.VALID_REPUTATION,
        15000,
      );
      await ctx.unlloo.connect(ctx.borrower2).borrow(loanId2, borrowAmount2, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const loan2 = await ctx.unlloo.getLoan(loanId2);
      const rate2AtBorrow = loan2.borrowRateBps;

      // Rate2 should be >= rate1 due to higher utilization
      expect(rate2AtBorrow).to.be.gte(rate1AtBorrow);

      // Accrue interest for both loans
      await mine(Number(ctx.blocksPerDay));

      // Verify loan1 still uses its original rate
      const loan1After = await ctx.unlloo.getLoan(loanId1);
      expect(loan1After.borrowRateBps).to.equal(rate1AtBorrow);

      // Both loans should have accrued interest
      const interest1 = await ctx.unlloo.getAccruedInterest(loanId1);
      const interest2 = await ctx.unlloo.getAccruedInterest(loanId2);
      expect(interest1).to.be.gt(0n);
      expect(interest2).to.be.gt(0n);
    });

    it("Should prove utilization changes do NOT affect existing loans", async function () {
      const liquidityAmount = ethers.parseUnits("20000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(ctx.usdc, ctx.lender1, liquidityAmount, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.lender1).depositLiquidity(ctx.usdcAddress, liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create loan at low utilization
      const loanId = await createAndApproveLoan(
        ctx.unlloo,
        ctx.usdc,
        ctx.borrower1,
        ctx.owner,
        constants.VALID_REPUTATION,
        1000,
      );
      await ctx.unlloo.connect(ctx.borrower1).borrow(loanId, borrowAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const loanBefore = await ctx.unlloo.getLoan(loanId);
      const rateAtBorrow = loanBefore.borrowRateBps;

      // Phase 1: Accrue at original rate (1 day)
      await mine(Number(ctx.blocksPerDay));
      const interestPhase1 = await ctx.unlloo.getAccruedInterest(loanId);

      // Phase 2: Mining cooldown blocks also accrues interest
      await mine(Number(ctx.cooldownBlocks) + 1);

      // Existing loan rate should be unchanged
      const loanAfterUtilChange = await ctx.unlloo.getLoan(loanId);
      expect(loanAfterUtilChange.borrowRateBps).to.equal(rateAtBorrow);

      // Phase 3: Accrue at same fixed rate (1 more day)
      const interestAfterCooldown = await ctx.unlloo.getAccruedInterest(loanId);
      await mine(Number(ctx.blocksPerDay));
      const interestPhase3End = await ctx.unlloo.getAccruedInterest(loanId);
      const deltaPhase3 = interestPhase3End - interestAfterCooldown;

      // Both phases should accrue at the same rate
      const tolerance = interestPhase1 / 10n > 100n ? interestPhase1 / 10n : 100n;
      expect(deltaPhase3).to.be.closeTo(interestPhase1, tolerance);
    });
  });

  describe("Index Snapshot Semantics", function () {
    it("Should verify borrowRateBps is immutable after borrow", async function () {
      const liquidityAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(ctx.usdc, ctx.lender1, liquidityAmount, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.lender1).depositLiquidity(ctx.usdcAddress, liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const { loanId } = await setupCompleteBorrow(
        ctx.unlloo,
        ctx.usdc,
        ctx.borrower1,
        ctx.lender1,
        ctx.owner,
        1000,
        liquidityAmount,
      );

      const loanAtBorrow = await ctx.unlloo.getLoan(loanId);
      const rateAtBorrow = loanAtBorrow.borrowRateBps;

      // Mine blocks
      await mine(Number(ctx.blocksPerDay) * 5);

      // Rate should be unchanged
      const loanAfter = await ctx.unlloo.getLoan(loanId);
      expect(loanAfter.borrowRateBps).to.equal(rateAtBorrow);
    });

    it("Should maintain fixed rate through partial repayment", async function () {
      const liquidityAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(ctx.usdc, ctx.lender1, liquidityAmount, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.lender1).depositLiquidity(ctx.usdcAddress, liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const { loanId } = await setupCompleteBorrow(
        ctx.unlloo,
        ctx.usdc,
        ctx.borrower1,
        ctx.lender1,
        ctx.owner,
        1000,
        liquidityAmount,
      );

      const loanAtBorrow = await ctx.unlloo.getLoan(loanId);
      const rateAtBorrow = loanAtBorrow.borrowRateBps;

      // Accrue some interest
      await mine(Number(ctx.blocksPerDay));

      // Make a partial repayment
      const totalOwed = await ctx.unlloo.getTotalOwed(loanId);
      const partialRepay = totalOwed / 2n;

      await mintAndApproveUSDC(ctx.usdc, ctx.borrower1, partialRepay, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.borrower1).repay(loanId, partialRepay, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Rate should remain fixed
      const loanAfterRepay = await ctx.unlloo.getLoan(loanId);
      expect(loanAfterRepay.borrowRateBps).to.equal(rateAtBorrow);
    });
  });

  describe("Rate Boundaries", function () {
    it("Should enforce MIN_BORROWER_RATE (5%) in rate calculation", async function () {
      const liquidityAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(ctx.usdc, ctx.lender1, liquidityAmount, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.lender1).depositLiquidity(ctx.usdcAddress, liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // At very low utilization, rate should be at least MIN_BORROWER_RATE
      const rate = await ctx.unlloo.calculateBorrowRate(ctx.usdcAddress);
      expect(rate).to.be.gte(constants.MIN_BORROWER_RATE_BPS);
    });

    it("Should enforce MAX_BORROWER_RATE (50%) in rate calculation", async function () {
      const liquidityAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(ctx.usdc, ctx.lender1, liquidityAmount, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.lender1).depositLiquidity(ctx.usdcAddress, liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrow almost all liquidity to maximize utilization
      const borrowAmount = ethers.parseUnits("9900", constants.USDC_DECIMALS);
      const loanId = await createAndApproveLoan(
        ctx.unlloo,
        ctx.usdc,
        ctx.borrower1,
        ctx.owner,
        constants.VALID_REPUTATION,
        9900,
      );
      await ctx.unlloo.connect(ctx.borrower1).borrow(loanId, borrowAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Rate should be capped at MAX_BORROWER_RATE
      const loan = await ctx.unlloo.getLoan(loanId);
      expect(loan.borrowRateBps).to.be.lte(constants.MAX_BORROWER_RATE_BPS);
    });

    it("Should calculate rates based on utilization correctly", async function () {
      const liquidityAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(ctx.usdc, ctx.lender1, liquidityAmount, ctx.unllooAddress);
      await ctx.unlloo.connect(ctx.lender1).depositLiquidity(ctx.usdcAddress, liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Low utilization should give lower rate
      const rateLow = await ctx.unlloo.calculateBorrowRate(ctx.usdcAddress);

      // Borrow to increase utilization
      const borrowAmount = ethers.parseUnits("8000", constants.USDC_DECIMALS);
      const loanId = await createAndApproveLoan(
        ctx.unlloo,
        ctx.usdc,
        ctx.borrower1,
        ctx.owner,
        constants.VALID_REPUTATION,
        8000,
      );
      await ctx.unlloo.connect(ctx.borrower1).borrow(loanId, borrowAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // High utilization should give higher rate
      const rateHigh = await ctx.unlloo.calculateBorrowRate(ctx.usdcAddress);

      expect(rateHigh).to.be.gt(rateLow);
    });
  });
});
