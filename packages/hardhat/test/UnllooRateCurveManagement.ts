/**
 * @file Rate Curve Management Tests
 * @description Comprehensive tests for updatePoolRateCurve admin function
 *              Tests parameter validation, isolation, and rate calculation effects
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC, setupCompleteBorrow, createAndApproveLoan } from "./helpers";

describe("Unlloo - Rate Curve Management", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let tokenB: MockERC20;
  let owner: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let borrower2: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    nonOwner = ctx.nonOwner;
    borrower1 = ctx.borrower1;
    borrower2 = ctx.borrower2;
    lender1 = ctx.lender1;

    // Deploy second pool token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    tokenB = (await MockERC20Factory.deploy("TokenB", "TB", constants.USDC_DECIMALS, {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    })) as MockERC20;
    await tokenB.waitForDeployment();

    const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
    const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
    await unlloo.connect(owner).addLiquidityPool(await tokenB.getAddress(), minLoanAmount, maxLoanAmount, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });
  });

  describe("updatePoolRateCurve - Access Control", function () {
    it("Should allow owner to update rate curve", async function () {
      const usdcAddr = await usdc.getAddress();
      const newBaseRate = 300; // 3%
      const newOptimalUtil = 7500; // 75%
      const newSlope1 = 500; // 5%
      const newSlope2 = 3000; // 30%
      const newProtocolFee = 2000; // 20%

      await expect(
        unlloo
          .connect(owner)
          .updatePoolRateCurve(usdcAddr, newBaseRate, newOptimalUtil, newSlope1, newSlope2, newProtocolFee, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
      ).to.not.be.reverted;

      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      expect(rateCurve.baseRateBps).to.equal(newBaseRate);
      expect(rateCurve.optimalUtilizationBps).to.equal(newOptimalUtil);
      expect(rateCurve.slope1Bps).to.equal(newSlope1);
      expect(rateCurve.slope2Bps).to.equal(newSlope2);
      expect(rateCurve.protocolFeeBps).to.equal(newProtocolFee);
    });

    it("Should revert when non-owner tries to update", async function () {
      const usdcAddr = await usdc.getAddress();
      await expect(
        unlloo.connect(nonOwner).updatePoolRateCurve(usdcAddr, 300, 7500, 500, 3000, 2000, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when pool doesn't exist", async function () {
      const invalidToken = ethers.Wallet.createRandom().address;
      await expect(
        unlloo.connect(owner).updatePoolRateCurve(invalidToken, 300, 7500, 500, 3000, 2000, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
    });
  });

  describe("updatePoolRateCurve - Parameter Validation", function () {
    let usdcAddr: string;

    beforeEach(async function () {
      usdcAddr = await usdc.getAddress();
    });

    describe("baseRateBps validation", function () {
      it("Should accept baseRateBps at maximum (1000 bps = 10%)", async function () {
        // Total: 1000 + 600 + 4000 = 5600 > 5000, need to reduce
        // Use: 1000 + 600 + 3400 = 5000 (exactly at limit)
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 1000, 8000, 600, 3400, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });

      it("Should revert when baseRateBps exceeds 1000", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 1001, 8000, 600, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidRateCurveParam");
      });

      it("Should accept baseRateBps at 0", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 0, 8000, 600, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });
    });

    describe("optimalUtilizationBps validation", function () {
      it("Should accept optimalUtilizationBps at minimum (5000 bps = 50%)", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 5000, 600, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });

      it("Should accept optimalUtilizationBps at maximum (9500 bps = 95%)", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 9500, 600, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });

      it("Should revert when optimalUtilizationBps below 5000", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 4999, 600, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidRateCurveParam");
      });

      it("Should revert when optimalUtilizationBps above 9500", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 9501, 600, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidRateCurveParam");
      });
    });

    describe("slope1Bps validation", function () {
      it("Should accept slope1Bps at maximum (2000 bps = 20%)", async function () {
        // Total: 200 + 2000 + 4000 = 6200 > 5000, need to reduce
        // Use: 200 + 2000 + 2800 = 5000 (exactly at limit)
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 2000, 2800, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });

      it("Should revert when slope1Bps exceeds 2000", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 2001, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidRateCurveParam");
      });
    });

    describe("slope2Bps validation", function () {
      it("Should accept slope2Bps at maximum (10000 bps = 100%)", async function () {
        // Total: 200 + 600 + 10000 = 10800 > 5000, need to reduce
        // Use: 200 + 600 + 4200 = 5000 (exactly at limit)
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 600, 4200, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });

      it("Should revert when slope2Bps exceeds 10000", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 600, 10001, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidRateCurveParam");
      });
    });

    describe("protocolFeeBps validation", function () {
      it("Should accept protocolFeeBps at maximum (5000 bps = 50%)", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 600, 4000, 5000, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });

      it("Should revert when protocolFeeBps exceeds 5000", async function () {
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 600, 4000, 5001, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidRateCurveParam");
      });
    });

    describe("Total max rate validation", function () {
      it("Should accept when baseRate + slope1 + slope2 equals MAX_BORROWER_RATE (5000)", async function () {
        // 500 + 2000 + 2500 = 5000
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 500, 8000, 2000, 2500, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });

      it("Should revert when baseRate + slope1 + slope2 exceeds MAX_BORROWER_RATE", async function () {
        // 500 + 2000 + 2501 = 5001 > 5000
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 500, 8000, 2000, 2501, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidRateCurveParam");
      });

      it("Should accept when total is below MAX_BORROWER_RATE", async function () {
        // 200 + 600 + 4000 = 4800 < 5000
        await expect(
          unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 600, 4000, 2500, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.not.be.reverted;
      });
    });
  });

  describe("updatePoolRateCurve - Event Emission", function () {
    it("Should emit InterestRatesUpdated event with correct parameters", async function () {
      const usdcAddr = await usdc.getAddress();
      const newBaseRate = 300;
      const newOptimalUtil = 7500;
      const newSlope1 = 500;
      const newSlope2 = 3000;
      const newProtocolFee = 2000;

      await expect(
        unlloo
          .connect(owner)
          .updatePoolRateCurve(usdcAddr, newBaseRate, newOptimalUtil, newSlope1, newSlope2, newProtocolFee, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
      )
        .to.emit(unlloo, "InterestRatesUpdated")
        .withArgs(
          usdcAddr,
          newBaseRate,
          newOptimalUtil,
          newSlope1,
          newSlope2,
          newProtocolFee,
          (value: bigint) => value > 0n,
        );
    });
  });

  describe("updatePoolRateCurve - Rate Curve Isolation", function () {
    it("Should keep rate curves isolated per pool", async function () {
      const usdcAddr = await usdc.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      // Get default rate curves
      const defaultUsdc = await unlloo.getPoolRateCurve(usdcAddr);
      const defaultTokenB = await unlloo.getPoolRateCurve(tokenBAddr);

      // Update USDC rate curve
      await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 300, 7500, 500, 3000, 2000, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Verify USDC changed
      const updatedUsdc = await unlloo.getPoolRateCurve(usdcAddr);
      expect(updatedUsdc.baseRateBps).to.equal(300);
      expect(updatedUsdc.baseRateBps).to.not.equal(defaultUsdc.baseRateBps);

      // Verify TokenB unchanged
      const unchangedTokenB = await unlloo.getPoolRateCurve(tokenBAddr);
      expect(unchangedTokenB.baseRateBps).to.equal(defaultTokenB.baseRateBps);
      expect(unchangedTokenB.optimalUtilizationBps).to.equal(defaultTokenB.optimalUtilizationBps);
    });

    it("Should allow different rate curves for different pools", async function () {
      const usdcAddr = await usdc.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      // Set different curves
      await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 600, 4000, 2500, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await unlloo.connect(owner).updatePoolRateCurve(tokenBAddr, 500, 7000, 1000, 3500, 3000, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const usdcCurve = await unlloo.getPoolRateCurve(usdcAddr);
      const tokenBCurve = await unlloo.getPoolRateCurve(tokenBAddr);

      expect(usdcCurve.baseRateBps).to.equal(200);
      expect(tokenBCurve.baseRateBps).to.equal(500);
      expect(usdcCurve.baseRateBps).to.not.equal(tokenBCurve.baseRateBps);
    });
  });

  describe("updatePoolRateCurve - Effect on Loans", function () {
    it("Should not affect existing loans (fixed-rate semantics)", async function () {
      const usdcAddr = await usdc.getAddress();

      // Create and borrow a loan with default rate curve
      const { loanId } = await setupCompleteBorrow(
        unlloo,
        usdc,
        borrower1,
        lender1,
        owner,
        1000,
        ethers.parseUnits("100000", constants.USDC_DECIMALS),
        ctx.minLoanDurationBlocks,
      );
      const loanBefore = await unlloo.loans(loanId);
      const borrowRateBefore = loanBefore.borrowRateBps;

      // Update rate curve (ensure total doesn't exceed MAX: 1000 + 2000 + 4000 = 7000 > 5000)
      // Use: 500 + 2000 + 2500 = 5000 (exactly at limit)
      await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 500, 8000, 2000, 2500, 4000, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Verify loan rate unchanged
      const loanAfter = await unlloo.loans(loanId);
      expect(loanAfter.borrowRateBps).to.equal(borrowRateBefore);
    });

    it("Should affect new loans after update", async function () {
      const usdcAddr = await usdc.getAddress();

      // Update rate curve first (ensure total doesn't exceed MAX: 500 + 600 + 4000 = 5100 > 5000)
      // Use: 500 + 600 + 3900 = 5000 (exactly at limit)
      const newBaseRate = 500;
      await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, newBaseRate, 8000, 600, 3900, 2500, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create new loan
      await mintAndApproveUSDC(usdc, lender1, ethers.parseUnits("100000", constants.USDC_DECIMALS), ctx.unllooAddress);
      await unlloo.connect(lender1).depositLiquidity(usdcAddr, ethers.parseUnits("100000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
      await unlloo.connect(borrower1).borrow(loanId, ethers.parseUnits("1000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // New loan should use updated rate curve
      const loan = await unlloo.loans(loanId);
      // The actual borrow rate depends on utilization, but it should be calculated with new curve
      expect(loan.borrowRateBps).to.be.gte(newBaseRate);
    });
  });

  describe("updatePoolRateCurve - Rate Calculation at Different Utilization", function () {
    it("Should calculate rates correctly at different utilization levels after update", async function () {
      const usdcAddr = await usdc.getAddress();

      // Set custom rate curve
      const baseRate = 200n; // 2%
      const optimalUtil = 8000n; // 80%
      const slope1 = 600n; // 6%
      const slope2 = 4000n; // 40%
      await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, baseRate, optimalUtil, slope1, slope2, 2500, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Test at 0% utilization (should be baseRate)
      await mintAndApproveUSDC(usdc, lender1, ethers.parseUnits("100000", constants.USDC_DECIMALS), ctx.unllooAddress);
      await unlloo.connect(lender1).depositLiquidity(usdcAddr, ethers.parseUnits("100000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const rateAtZero = await unlloo.calculateBorrowRate(usdcAddr);
      const minRate = await unlloo.MIN_BORROWER_RATE();
      // Rate is clamped to MIN_BORROWER_RATE if baseRate < MIN
      const expectedRate = baseRate < minRate ? minRate : baseRate;
      expect(rateAtZero).to.equal(expectedRate);

      // Test at 50% utilization (should be baseRate + slope1 * (50/80))
      const borrowAmount = ethers.parseUnits("50000", constants.USDC_DECIMALS);
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 50000);
      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rateAt50 = await unlloo.calculateBorrowRate(usdcAddr);
      // Expected: baseRate + slope1 * (utilization / optimalUtil), clamped to MIN_BORROWER_RATE
      // 200 + 600 * (5000 / 8000) = 200 + 375 = 575
      const uncappedRateAt50 = baseRate + (slope1 * 5000n) / optimalUtil;
      const expectedRateAt50 = uncappedRateAt50 < minRate ? minRate : uncappedRateAt50;
      expect(rateAt50).to.be.closeTo(expectedRateAt50, 1n);

      // Test at 100% utilization (should be baseRate + slope1 + slope2)
      const borrowAmount2 = ethers.parseUnits("50000", constants.USDC_DECIMALS);
      // Use a different borrower (one-active-loan-per-borrower rule)
      const loanId2 = await createAndApproveLoan(unlloo, usdc, borrower2, owner, constants.VALID_REPUTATION, 50000);
      await unlloo.connect(borrower2).borrow(loanId2, borrowAmount2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rateAt100 = await unlloo.calculateBorrowRate(usdcAddr);
      const expectedMaxRate = baseRate + slope1 + slope2;
      expect(rateAt100).to.be.closeTo(expectedMaxRate, 1n);
    });
  });
});
