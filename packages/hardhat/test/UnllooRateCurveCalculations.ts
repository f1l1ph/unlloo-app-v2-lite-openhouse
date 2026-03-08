/**
 * @file Rate Curve Calculation Tests
 * @description Tests for rate calculation edge cases at different utilization levels
 *              Verifies rate calculation with custom curves and boundary conditions
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC, depositLiquidity, createAndApproveLoan } from "./helpers";

describe("Unlloo - Rate Curve Calculations", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let borrower2: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    borrower2 = ctx.borrower2;
    lender1 = ctx.lender1;
  });

  describe("Rate Calculation at Utilization Boundaries", function () {
    it("Should calculate rate at exactly optimal utilization (80%)", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      const optimalBorrow = (totalLiquidity * 8000n) / 10000n; // 80%

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      // Rate at 0% utilization
      const rateAtZero = await unlloo.calculateBorrowRate(usdcAddr);
      expect(rateAtZero).to.be.gt(0n);

      // Borrow to exactly 80% utilization
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 80000);
      await unlloo.connect(borrower1).borrow(loanId, optimalBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rateAtOptimal = await unlloo.calculateBorrowRate(usdcAddr);
      // Rate should be: baseRate + slope1 (at optimal, we're at the kink)
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      const expectedRate = rateCurve.baseRateBps + rateCurve.slope1Bps;
      expect(rateAtOptimal).to.be.closeTo(expectedRate, 1n);
    });

    it("Should calculate rate just below optimal utilization", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      const borrowAmount = (totalLiquidity * 7999n) / 10000n; // Just below 80%

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 79990);
      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      // Rate should be: baseRate + slope1 * (utilization / optimalUtil)
      const utilization = (borrowAmount * 10000n) / totalLiquidity;
      const expectedRate =
        rateCurve.baseRateBps + (rateCurve.slope1Bps * utilization) / rateCurve.optimalUtilizationBps;
      expect(rate).to.be.closeTo(expectedRate, 1n);
    });

    it("Should calculate rate just above optimal utilization", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      const borrowAmount = (totalLiquidity * 8001n) / 10000n; // Just above 80%

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 80010);
      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      // Rate should be: baseRate + slope1 + slope2 * ((utilization - optimal) / (100% - optimal))
      const utilization = (borrowAmount * 10000n) / totalLiquidity;
      const excessUtilization = utilization - rateCurve.optimalUtilizationBps;
      const maxExcess = 10000n - rateCurve.optimalUtilizationBps;
      const expectedRate =
        rateCurve.baseRateBps + rateCurve.slope1Bps + (rateCurve.slope2Bps * excessUtilization) / maxExcess;
      expect(rate).to.be.closeTo(expectedRate, 1n);
    });

    it("Should calculate rate at 0% utilization", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      const minRate = await unlloo.MIN_BORROWER_RATE();
      // At 0% utilization, rate should be baseRate, but clamped to MIN_BORROWER_RATE if baseRate < MIN
      const expectedRate = rateCurve.baseRateBps < minRate ? minRate : rateCurve.baseRateBps;
      expect(rate).to.equal(expectedRate);
    });

    it("Should calculate rate at 100% utilization", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      // Borrow all liquidity
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 100000);
      await unlloo.connect(borrower1).borrow(loanId, totalLiquidity, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      // At 100% utilization, rate should be: baseRate + slope1 + slope2, capped at MAX_BORROWER_RATE
      const uncappedRate = rateCurve.baseRateBps + rateCurve.slope1Bps + rateCurve.slope2Bps;
      const MAX_BORROWER_RATE = await unlloo.MAX_BORROWER_RATE();
      const expectedMaxRate = uncappedRate > MAX_BORROWER_RATE ? MAX_BORROWER_RATE : uncappedRate;
      expect(rate).to.be.closeTo(expectedMaxRate, 1n);
    });
  });

  describe("Custom Rate Curves", function () {
    it("Should calculate rates correctly with custom rate curve", async function () {
      const usdcAddr = await usdc.getAddress();
      const customBaseRate = 500n; // 5% (also MIN_BORROWER_RATE)
      const customOptimalUtil = 7000n; // 70%
      const customSlope1 = 800n; // 8%
      const customSlope2 = 3500n; // 35%

      await unlloo
        .connect(owner)
        .updatePoolRateCurve(usdcAddr, customBaseRate, customOptimalUtil, customSlope1, customSlope2, 2500, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      // Test at 0% - rate is clamped to MIN_BORROWER_RATE
      const rateAtZero = await unlloo.calculateBorrowRate(usdcAddr);
      const MIN_BORROWER_RATE = await unlloo.MIN_BORROWER_RATE();
      const expectedRateAtZero = customBaseRate < MIN_BORROWER_RATE ? MIN_BORROWER_RATE : customBaseRate;
      expect(rateAtZero).to.equal(expectedRateAtZero);

      // Test at 50% utilization
      const borrow50 = totalLiquidity / 2n;
      const loanId50 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 50000);
      await unlloo.connect(borrower1).borrow(loanId50, borrow50, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rateAt50 = await unlloo.calculateBorrowRate(usdcAddr);
      const expectedRate50 = customBaseRate + (customSlope1 * 5000n) / customOptimalUtil;
      expect(rateAt50).to.be.closeTo(expectedRate50, 1n);
    });

    it("Should calculate rates with extreme but valid parameters", async function () {
      const usdcAddr = await usdc.getAddress();
      // Use maximum allowed values
      const extremeBaseRate = 1000; // 10% (max)
      const extremeOptimalUtil = 9500; // 95% (max)
      const extremeSlope1 = 2000; // 20% (max)
      const extremeSlope2 = 2000; // 20% (to keep total under 5000)

      await unlloo
        .connect(owner)
        .updatePoolRateCurve(usdcAddr, extremeBaseRate, extremeOptimalUtil, extremeSlope1, extremeSlope2, 5000, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      expect(rate).to.equal(extremeBaseRate);
    });
  });

  describe("Rate Calculation Consistency", function () {
    it("Should return consistent rates across multiple calls", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const rate1 = await unlloo.calculateBorrowRate(usdcAddr);
      const rate2 = await unlloo.calculateBorrowRate(usdcAddr);
      const rate3 = await unlloo.calculateBorrowRate(usdcAddr);

      expect(rate1).to.equal(rate2);
      expect(rate2).to.equal(rate3);
    });

    it("Should calculate rates correctly after utilization changes", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      // Rate at 0%
      const rate0 = await unlloo.calculateBorrowRate(usdcAddr);

      // Borrow 50%
      const borrow50 = totalLiquidity / 2n;
      const loanId50 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 50000);
      await unlloo.connect(borrower1).borrow(loanId50, borrow50, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rate50 = await unlloo.calculateBorrowRate(usdcAddr);
      expect(rate50).to.be.gt(rate0);

      // Borrow more to 100%
      const borrowMore = totalLiquidity / 2n;
      // Use a different borrower (one-active-loan-per-borrower rule)
      const loanIdMore = await createAndApproveLoan(unlloo, usdc, borrower2, owner, constants.VALID_REPUTATION, 50000);
      await unlloo.connect(borrower2).borrow(loanIdMore, borrowMore, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rate100 = await unlloo.calculateBorrowRate(usdcAddr);
      expect(rate100).to.be.gt(rate50);
    });
  });

  describe("Fixed-Rate Semantics", function () {
    it("Should not change rate for existing loans when rate curve is updated", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      // Create loan with default rate curve
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 10000);
      await unlloo.connect(borrower1).borrow(loanId, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const loanBefore = await unlloo.loans(loanId);
      const borrowRateBefore = loanBefore.borrowRateBps;

      // Update rate curve
      await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 1000, 8000, 2000, 2000, 4000, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Loan rate should be unchanged
      const loanAfter = await unlloo.loans(loanId);
      expect(loanAfter.borrowRateBps).to.equal(borrowRateBefore);
    });

    it("Should use new rate curve for new loans after update", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      // Update rate curve first (ensure total doesn't exceed MAX_BORROWER_RATE: 500 + 600 + 4000 = 5100 > 5000)
      // Use: 500 + 600 + 3900 = 5000 (exactly at limit)
      const newBaseRate = 500;
      await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, newBaseRate, 8000, 600, 3900, 2500, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create new loan
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 10000);
      await unlloo.connect(borrower1).borrow(loanId, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // New loan should use updated rate curve
      const loan = await unlloo.loans(loanId);
      // Rate depends on utilization, but should be >= newBaseRate
      expect(loan.borrowRateBps).to.be.gte(newBaseRate);
    });
  });
});
