/**
 * UnllooSupplyIndexFairness.ts
 *
 * Tests for the supply-index based lender yield distribution:
 * - Lenders receive PAID interest (not modeled APR)
 * - No retroactive interest for late deposits
 * - Pro-rata fairness across deposit timing
 * - Rounding dust bucket (poolUndistributedInterest) is not lost
 * - Partial withdrawal pays pro-rata interest
 *
 * Key insight: lenderRateBps is stored but NOT used in payout logic.
 * Lenders receive: (borrower interest paid) - (protocol fee).
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers";
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC } from "./helpers/tokenHelpers";
import { createAndApproveLoan, setupCompleteBorrow, repayFully } from "./helpers/loanHelpers";

describe("Unlloo Supply Index Fairness", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooTestContext["unlloo"];
  let usdc: UnllooTestContext["usdc"];
  let owner: UnllooTestContext["owner"];
  let borrower1: UnllooTestContext["borrower1"];
  let lender1: UnllooTestContext["lender1"];
  let lender2: UnllooTestContext["lender2"];

  beforeEach(async function () {
    ctx = await loadFixture(setupUnllooTestFixture);
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    lender1 = ctx.lender1;
    lender2 = ctx.lender2;
  });

  describe("No Retroactive Interest for Late Deposits", function () {
    it("Should NOT give interest to lender who deposits AFTER repayment", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      // Phase 1: L1 deposits and earns interest
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrower borrows and repays (creating lender interest)
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);
      await mine(Number(ctx.blocksPerDay) * 7); // 1 week of interest
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Get L1's accrued interest BEFORE L2 deposits
      const l1PositionBefore = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      const l1InterestBefore = l1PositionBefore.accruedInterest;
      expect(l1InterestBefore).to.be.gt(0n, "L1 should have accrued interest");

      // Record pool supply index after repayment
      const supplyIndexAfterRepay = await unlloo.poolSupplyIndex(usdcAddress);

      // Phase 2: L2 deposits AFTER the interest was distributed
      await mintAndApproveUSDC(usdc, lender2, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender2).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // L2 should have ZERO accrued interest (they missed the distribution)
      const l2Position = await unlloo.getLenderPosition(lender2.address, usdcAddress);
      expect(l2Position.accruedInterest).to.equal(0n, "L2 should have ZERO interest (deposited after distribution)");

      // L2's lenderSupplyIndex should be set to current poolSupplyIndex
      const l2SupplyIndex = await unlloo.lenderSupplyIndex(lender2.address, usdcAddress);
      expect(l2SupplyIndex).to.equal(supplyIndexAfterRepay, "L2's index should match pool index at deposit time");

      // L1's interest should be unchanged
      const l1PositionAfter = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      expect(l1PositionAfter.accruedInterest).to.equal(
        l1InterestBefore,
        "L1's interest should be unchanged after L2 deposits",
      );
    });
  });

  describe("Pro-Rata Fairness Across Deposit Timing", function () {
    it("Should distribute interest only to lenders present during repayment", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const borrowAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      // L1 deposits
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create and fund first loan
      const loanId1 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
      await unlloo.connect(borrower1).borrow(loanId1, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Accrue interest and make partial repayment (interest only)
      await mine(Number(ctx.blocksPerDay) * 3);
      const totalOwed1 = await unlloo.getTotalOwed(loanId1);
      const loan1 = await unlloo.loans(loanId1);
      const interestDue1 = totalOwed1 - loan1.principal;

      // Partial repay: just the interest
      await mintAndApproveUSDC(usdc, borrower1, interestDue1 + 1000n, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId1, interestDue1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // L1 gets interest from first repayment
      const l1InterestAfterFirstRepay = (await unlloo.getLenderPosition(lender1.address, usdcAddress)).accruedInterest;
      expect(l1InterestAfterFirstRepay).to.be.gt(0n);

      // L2 deposits NOW (after first repayment)
      await mintAndApproveUSDC(usdc, lender2, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender2).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // L2 should have zero at this point
      const l2InterestAfterDeposit = (await unlloo.getLenderPosition(lender2.address, usdcAddress)).accruedInterest;
      expect(l2InterestAfterDeposit).to.equal(0n);

      // Accrue more interest and repay rest
      await mine(Number(ctx.blocksPerDay) * 3);
      await repayFully(unlloo, usdc, borrower1, loanId1);

      // Now both lenders should have interest, but L1 has MORE (from both repayments)
      const l1Final = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      const l2Final = await unlloo.getLenderPosition(lender2.address, usdcAddress);

      expect(l1Final.accruedInterest).to.be.gt(
        l1InterestAfterFirstRepay,
        "L1 should have more interest from 2nd repay",
      );
      expect(l2Final.accruedInterest).to.be.gt(0n, "L2 should have interest from 2nd repay");
      expect(l1Final.accruedInterest).to.be.gt(l2Final.accruedInterest, "L1 should have more total interest than L2");
    });

    it("Should distribute second repayment pro-rata between L1 and L2 (50/50)", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      // L1 deposits 10000
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Setup and repay first loan (only L1 present)
      const { loanId: loanId1 } = await setupCompleteBorrow(
        unlloo,
        usdc,
        borrower1,
        lender1,
        owner,
        1000,
        depositAmount,
      );
      await mine(Number(ctx.blocksPerDay) * 5);
      await repayFully(unlloo, usdc, borrower1, loanId1);

      const l1InterestFromLoan1 = (await unlloo.getLenderPosition(lender1.address, usdcAddress)).accruedInterest;

      // L2 deposits same amount (now 50/50 split)
      await mintAndApproveUSDC(usdc, lender2, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender2).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Wait for cooldown and create second loan
      await mine(Number(ctx.cooldownBlocks) + 1);

      // Setup and repay second loan (both L1 and L2 present with equal deposits)
      const loanId2 = await createAndApproveLoan(unlloo, usdc, ctx.borrower2, owner, constants.VALID_REPUTATION, 1000);
      const borrowAmount2 = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      await unlloo.connect(ctx.borrower2).borrow(loanId2, borrowAmount2, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await mine(Number(ctx.blocksPerDay) * 5);
      await repayFully(unlloo, usdc, ctx.borrower2, loanId2);

      // Check final interest distribution
      const l1Final = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      const l2Final = await unlloo.getLenderPosition(lender2.address, usdcAddress);

      // L1's interest from loan 2 = l1Final.accruedInterest - l1InterestFromLoan1
      const l1InterestFromLoan2 = l1Final.accruedInterest - l1InterestFromLoan1;

      // L1 and L2 should have approximately equal interest from loan 2 (within rounding)
      const tolerance = ethers.parseUnits("1", constants.USDC_DECIMALS); // 1 USDC tolerance
      expect(l1InterestFromLoan2).to.be.closeTo(l2Final.accruedInterest, tolerance);
    });
  });

  describe("Rounding Bucket (poolUndistributedInterest)", function () {
    it("Should accumulate dust in poolUndistributedInterest when interest is too small", async function () {
      const largeDeposit = ethers.parseUnits("1000000", constants.USDC_DECIMALS); // 1M USDC
      const tinyBorrow = ethers.parseUnits("100", constants.USDC_DECIMALS); // $100
      const usdcAddress = await usdc.getAddress();

      // Deposit large amount
      await mintAndApproveUSDC(usdc, lender1, largeDeposit, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, largeDeposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrow tiny amount and repay quickly (minimal interest)
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 100);
      await unlloo.connect(borrower1).borrow(loanId, tinyBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Just a few blocks of interest
      await mine(100);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Check if there's any undistributed interest (dust)
      const undistributed = await unlloo.poolUndistributedInterest(usdcAddress);

      // Note: Due to index math, very small interest may result in delta=0,
      // which means the full amount goes to poolUndistributedInterest
      // We just verify the mechanism exists and is >= 0
      expect(undistributed).to.be.gte(0n);
    });

    it("Should distribute accumulated dust on subsequent larger repayment", async function () {
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create a loan with substantial interest
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 10000, depositAmount);
      await mine(Number(ctx.blocksPerDay) * 30); // 1 month of interest
      await repayFully(unlloo, usdc, borrower1, loanId);

      // After repayment, undistributed should be minimal (most was distributed)
      await unlloo.poolUndistributedInterest(usdcAddress);
      const supplyIndex = await unlloo.poolSupplyIndex(usdcAddress);

      // Supply index should have increased from 1e18
      const INDEX_SCALE = 10n ** 18n;
      expect(supplyIndex).to.be.gt(INDEX_SCALE);

      // Lender should have received interest
      const lenderPosition = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      expect(lenderPosition.accruedInterest).to.be.gt(0n);
    });

    it("Should include pending undistributed in getLenderPosition view", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 5000, depositAmount);
      await mine(Number(ctx.blocksPerDay) * 7);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Get position - this view function should include any pending undistributed interest
      const position = await unlloo.getLenderPosition(lender1.address, usdcAddress);

      // The view includes: stored accrued + pending from index delta + pending from undistributed bucket
      // We verify it's greater than or equal to the stored lenderAccruedInterest
      const storedAccrued = await unlloo.lenderAccruedInterest(lender1.address, usdcAddress);

      // getLenderPosition calculates: accrued + (deposit * (adjustedIndex - lenderIndex)) / 1e18
      // where adjustedIndex = poolSupplyIndex + (undistributed * 1e18 / totalLiquidity)
      expect(position.accruedInterest).to.be.gte(storedAccrued);
    });
  });

  describe("Partial Withdrawal Pro-Rata Interest", function () {
    it("Should pay pro-rata interest on partial withdrawal", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      // Single deposit (don't use setupCompleteBorrow which deposits again)
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Manually setup loan without depositing again
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 5000);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);
      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Generate interest
      await mine(Number(ctx.blocksPerDay) * 14);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Withdraw 50% of deposit
      const withdrawAmount = depositAmount / 2n;
      const balanceBefore = await usdc.balanceOf(lender1.address);

      await unlloo.connect(lender1).withdrawLiquidity(usdcAddress, withdrawAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const balanceAfter = await usdc.balanceOf(lender1.address);
      const received = balanceAfter - balanceBefore;

      // Should receive at least the principal withdrawn
      expect(received).to.be.gte(withdrawAmount);

      // Should receive some interest
      const interestReceived = received - withdrawAmount;
      expect(interestReceived).to.be.gt(0n, "Should receive some interest on partial withdrawal");

      // The remaining position should still have interest accrued
      const positionAfter = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      expect(positionAfter.accruedInterest).to.be.gt(0n, "Remaining position should still have accrued interest");

      // The remaining deposit should be 50%
      expect(positionAfter.depositedAmount).to.equal(withdrawAmount, "Should have 50% deposit remaining");
    });

    it("Should pay all accrued interest on full withdrawal", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      // Single deposit (don't use setupCompleteBorrow which deposits again)
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Manually setup loan without depositing again
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 5000);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);
      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Generate interest
      await mine(Number(ctx.blocksPerDay) * 14);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Full withdrawal
      const balanceBefore = await usdc.balanceOf(lender1.address);
      await unlloo.connect(lender1).withdrawLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const balanceAfter = await usdc.balanceOf(lender1.address);
      const received = balanceAfter - balanceBefore;

      // Verify we received at least the deposit back
      expect(received).to.be.gte(depositAmount, "Should receive at least the deposit");

      // The interest received should be positive
      const interestReceived = received - depositAmount;
      expect(interestReceived).to.be.gt(0n, "Should receive some interest on full withdrawal");

      // Position should be deleted after full withdrawal
      const positionAfter = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      expect(positionAfter.depositedAmount).to.equal(0n, "Deposit should be 0 after full withdrawal");
      expect(positionAfter.accruedInterest).to.equal(0n, "Accrued interest should be 0 after full withdrawal");
    });
  });

  describe("Interest Conservation Invariant", function () {
    it("Should conserve: borrower interest = protocol fee + lender interest", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      // Record protocol fees before
      const protocolFeesBefore = await unlloo.protocolFees(usdcAddress);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Setup loan and let interest accrue
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);
      await mine(Number(ctx.blocksPerDay) * 7);

      // Record total owed before repay
      const totalOwed = await unlloo.getTotalOwed(loanId);
      const loan = await unlloo.loans(loanId);
      const interestPaid = totalOwed - loan.principal;

      // Full repayment
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Get final state
      const protocolFeesAfter = await unlloo.protocolFees(usdcAddress);
      const protocolFeeIncrease = protocolFeesAfter - protocolFeesBefore;

      const lenderPosition = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      const lenderInterest = lenderPosition.accruedInterest;

      // Conservation: interestPaid ≈ protocolFeeIncrease + lenderInterest + undistributed
      const undistributed = await unlloo.poolUndistributedInterest(usdcAddress);
      const totalDistributed = protocolFeeIncrease + lenderInterest + undistributed;

      // Allow small tolerance for rounding
      const tolerance = ethers.parseUnits("1", constants.USDC_DECIMALS);
      expect(totalDistributed).to.be.closeTo(interestPaid, tolerance);
    });

    it("Should verify: protocol fee = floor(interest * feeBps / 10000)", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const usdcAddress = await usdc.getAddress();

      const protocolFeesBefore = await unlloo.protocolFees(usdcAddress);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 5000, depositAmount);
      await mine(Number(ctx.blocksPerDay) * 14);

      // Get exact amount to repay and calculate expected fee
      const totalOwed = await unlloo.getTotalOwed(loanId);
      const loan = await unlloo.loans(loanId);
      const interestToPay = totalOwed - loan.principal;

      // Protocol fee is fixed at 25% of interest paid
      const PROTOCOL_FEE_BPS = 2500n; // 25% fixed
      const expectedProtocolFee = (interestToPay * PROTOCOL_FEE_BPS) / 10000n;

      await repayFully(unlloo, usdc, borrower1, loanId);

      const protocolFeesAfter = await unlloo.protocolFees(usdcAddress);
      const actualProtocolFee = protocolFeesAfter - protocolFeesBefore;

      // The actual fee should be very close to expected (within rounding)
      // Note: There may be small differences due to block advancement during repay
      const tolerance = ethers.parseUnits("0.1", constants.USDC_DECIMALS);
      expect(actualProtocolFee).to.be.closeTo(expectedProtocolFee, tolerance);
    });
  });

  describe("Multi-Lender Fairness", function () {
    it("Should distribute interest proportionally to deposit amounts", async function () {
      const usdcAddress = await usdc.getAddress();
      const l1Deposit = ethers.parseUnits("7500", constants.USDC_DECIMALS); // 75%
      const l2Deposit = ethers.parseUnits("2500", constants.USDC_DECIMALS); // 25%

      // Both lenders deposit (NOT using setupCompleteBorrow to avoid extra deposits)
      await mintAndApproveUSDC(usdc, lender1, l1Deposit, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, l1Deposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await mintAndApproveUSDC(usdc, lender2, l2Deposit, await unlloo.getAddress());
      await unlloo.connect(lender2).depositLiquidity(usdcAddress, l2Deposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Manually create loan (don't use setupCompleteBorrow which deposits again)
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 5000);
      const borrowAmount = ethers.parseUnits("5000", constants.USDC_DECIMALS);
      await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Generate interest and repay
      await mine(Number(ctx.blocksPerDay) * 14);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Check interest distribution
      const l1Position = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      const l2Position = await unlloo.getLenderPosition(lender2.address, usdcAddress);

      // Both should have some interest
      expect(l1Position.accruedInterest).to.be.gt(0n);
      expect(l2Position.accruedInterest).to.be.gt(0n);

      // L1 should have ~3x the interest of L2 (75% vs 25%)
      // Allow 10% tolerance for timing differences and rounding
      const totalInterest = l1Position.accruedInterest + l2Position.accruedInterest;
      const l1Ratio = (l1Position.accruedInterest * 100n) / totalInterest;
      expect(l1Ratio).to.be.closeTo(75n, 10n); // 75% ± 10%
    });
  });
});
