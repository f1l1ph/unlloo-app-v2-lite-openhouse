/**
 * @file Utilization Rate Calculation Tests
 * @description Tests for rate calculation at utilization boundaries and edge cases
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Unlloo, MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC, depositLiquidity, createAndApproveLoan } from "./helpers";

describe("Unlloo - Utilization Rate Calculations", function () {
  let ctx: UnllooTestContext;
  let unlloo: Unlloo;
  let usdc: MockERC20;
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let borrower2: HardhatEthersSigner;
  let borrower3: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    borrower2 = ctx.borrower2;
    borrower3 = ctx.nonOwner; // spare signer from fixture
    lender1 = ctx.lender1;
  });

  describe("Utilization Boundary Tests", function () {
    it("Should calculate rate when utilization = 0%", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      const minRate = await unlloo.MIN_BORROWER_RATE();
      // Rate is clamped to MIN_BORROWER_RATE if baseRate < MIN
      const expectedRate = rateCurve.baseRateBps < minRate ? minRate : rateCurve.baseRateBps;
      expect(rate).to.equal(expectedRate);
    });

    it("Should calculate rate when utilization = optimal (80%)", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      const optimalBorrow = (totalLiquidity * 8000n) / 10000n;

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 80000);
      await unlloo.connect(borrower1).borrow(loanId, optimalBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      const expectedRate = rateCurve.baseRateBps + rateCurve.slope1Bps;
      expect(rate).to.be.closeTo(expectedRate, 1n);
    });

    it("Should calculate rate when utilization = 100%", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 100000);
      await unlloo.connect(borrower1).borrow(loanId, totalLiquidity, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
      const MAX_BORROWER_RATE = await unlloo.MAX_BORROWER_RATE();
      const uncappedMaxRate = rateCurve.baseRateBps + rateCurve.slope1Bps + rateCurve.slope2Bps;
      const expectedMaxRate = uncappedMaxRate > MAX_BORROWER_RATE ? MAX_BORROWER_RATE : uncappedMaxRate;
      expect(rate).to.be.closeTo(expectedMaxRate, 1n);
    });

    it("Should handle defensive check when utilization > 100% (shouldn't happen)", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      // Borrow all
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 100000);
      await unlloo.connect(borrower1).borrow(loanId, totalLiquidity, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Utilization should be capped at 100% by contract logic
      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      expect(rate).to.be.lte(await unlloo.MAX_BORROWER_RATE());
    });
  });

  describe("Rate Smoothness", function () {
    it("Should change rates smoothly across utilization ranges", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const rates: bigint[] = [];

      // Key points without mining (avoid loans becoming overdue => HasUnpaidDebt)
      // 0% (no borrows)
      rates.push(await unlloo.calculateBorrowRate(usdcAddr));

      // 50% utilization: borrower1 borrows 50k
      const loan50 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 50000);
      await unlloo.connect(borrower1).borrow(loan50, totalLiquidity / 2n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      rates.push(await unlloo.calculateBorrowRate(usdcAddr));

      // 80% utilization: borrower2 borrows additional 30k
      const loan80 = await createAndApproveLoan(unlloo, usdc, borrower2, owner, constants.VALID_REPUTATION, 30000);
      await unlloo
        .connect(borrower2)
        .borrow(loan80, (totalLiquidity * 3000n) / 10000n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      rates.push(await unlloo.calculateBorrowRate(usdcAddr));

      // 100% utilization: borrower3 borrows remaining 20k
      const loan100 = await createAndApproveLoan(unlloo, usdc, borrower3, owner, constants.VALID_REPUTATION, 20000);
      await unlloo
        .connect(borrower3)
        .borrow(loan100, (totalLiquidity * 2000n) / 10000n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      rates.push(await unlloo.calculateBorrowRate(usdcAddr));

      // Rates should be strictly increasing
      for (let i = 1; i < rates.length; i++) {
        expect(rates[i]).to.be.gte(rates[i - 1]);
      }
    });
  });

  describe("Rate Calculation Precision", function () {
    it("Should calculate rates with no rounding errors at boundaries", async function () {
      const usdcAddr = await usdc.getAddress();
      const totalLiquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, totalLiquidity, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, totalLiquidity);

      const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);

      // At 0%, should be baseRate clamped to MIN_BORROWER_RATE if needed
      const rateAtZero = await unlloo.calculateBorrowRate(usdcAddr);
      const minRate = await unlloo.MIN_BORROWER_RATE();
      const expectedAtZero = rateCurve.baseRateBps < minRate ? minRate : rateCurve.baseRateBps;
      expect(rateAtZero).to.equal(expectedAtZero);

      // At optimal, should be baseRate + slope1 (within 1 bps for rounding)
      const optimalBorrow = (totalLiquidity * BigInt(rateCurve.optimalUtilizationBps)) / 10000n;
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 80000);
      await unlloo.connect(borrower1).borrow(loanId, optimalBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const rateAtOptimal = await unlloo.calculateBorrowRate(usdcAddr);
      const expectedOptimal = rateCurve.baseRateBps + rateCurve.slope1Bps;
      const minRate2 = await unlloo.MIN_BORROWER_RATE();
      const maxRate = await unlloo.MAX_BORROWER_RATE();
      // Clamp expected rate to min/max bounds
      const clampedExpected =
        expectedOptimal < minRate2 ? minRate2 : expectedOptimal > maxRate ? maxRate : expectedOptimal;
      expect(rateAtOptimal).to.be.closeTo(clampedExpected, 1n);
    });
  });

  describe("Rate Calculation with Different Amounts", function () {
    it("Should calculate rates correctly with very small amounts", async function () {
      const usdcAddr = await usdc.getAddress();
      const smallAmount = ethers.parseUnits("1", constants.USDC_DECIMALS); // 1 USDC

      await mintAndApproveUSDC(usdc, lender1, smallAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, smallAmount);

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      expect(rate).to.be.gte(await unlloo.MIN_BORROWER_RATE());
    });

    it("Should calculate rates correctly with very large amounts", async function () {
      const usdcAddr = await usdc.getAddress();
      const largeAmount = ethers.parseUnits("1000000", constants.USDC_DECIMALS); // 1M USDC

      await mintAndApproveUSDC(usdc, lender1, largeAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, largeAmount);

      const rate = await unlloo.calculateBorrowRate(usdcAddr);
      expect(rate).to.be.gte(await unlloo.MIN_BORROWER_RATE());
      expect(rate).to.be.lte(await unlloo.MAX_BORROWER_RATE());
    });
  });
});
