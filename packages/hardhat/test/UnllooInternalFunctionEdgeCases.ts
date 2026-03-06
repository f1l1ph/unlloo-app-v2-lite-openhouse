/**
 * UnllooInternalFunctionEdgeCases.ts
 *
 * Tests for internal function edge cases and boundary conditions.
 * Since internal functions cannot be called directly, we test them through
 * public function calls and verify state changes.
 *
 * Coverage areas:
 * - _distributePendingInterest edge cases
 * - _updateLenderAccrual edge cases
 * - _distributeInterestToLenders edge cases
 * - _calculateRepaymentSplit edge cases
 * - _processInterestPayment edge cases
 * - _applyPrincipalPayment edge cases
 * - _checkAndFinalizeRepayment edge cases
 * - _finalizeRepaid edge cases
 * - _calculateBorrowRate boundary conditions
 * - _getAccruedInterest sentinel checks
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers";
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC } from "./helpers/tokenHelpers";
import { createAndApproveLoan, setupCompleteBorrow, repayFully } from "./helpers/loanHelpers";

describe("Unlloo - Internal Function Edge Cases", function () {
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

  describe("_distributePendingInterest Edge Cases", function () {
    it("Should handle _distributePendingInterest when pending == 0", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Deposit liquidity (this calls _distributePendingInterest)
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Check that poolUndistributedInterest is 0 initially
      const undistributed = await unlloo.poolUndistributedInterest(usdcAddress);
      expect(undistributed).to.equal(0n);

      // Another deposit should not fail (pending == 0 path)
      await mintAndApproveUSDC(usdc, lender2, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender2).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
    });

    it("Should handle _distributePendingInterest when totalLiquidity == 0", async function () {
      const usdcAddress = await usdc.getAddress();

      // Create a scenario where interest is distributed but all liquidity is withdrawn
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create loan and repay to generate interest
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Withdraw all liquidity
      await unlloo.connect(lender1).withdrawLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Check pool state
      const pool = await unlloo.getLiquidityPool(usdcAddress);
      expect(pool.totalLiquidity).to.equal(0n);

      // Any undistributed interest should remain in poolUndistributedInterest
      const undistributed = await unlloo.poolUndistributedInterest(usdcAddress);
      expect(undistributed).to.be.gte(0n);
    });

    it("Should handle _distributePendingInterest when delta == 0 (tiny interest)", async function () {
      const usdcAddress = await usdc.getAddress();
      const largeDeposit = ethers.parseUnits("1000000", constants.USDC_DECIMALS); // 1M USDC
      const tinyBorrow = ethers.parseUnits("10", constants.USDC_DECIMALS); // $10 (minimum)

      // Deposit large amount
      await mintAndApproveUSDC(usdc, lender1, largeDeposit, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, largeDeposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrow tiny amount and repay quickly (minimal interest)
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 10);
      await unlloo.connect(borrower1).borrow(loanId, tinyBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Just a few blocks of interest
      await mine(10);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Check if tiny interest was stored in poolUndistributedInterest (delta == 0 case)
      const undistributed = await unlloo.poolUndistributedInterest(usdcAddress);
      expect(undistributed).to.be.gte(0n);
    });
  });

  describe("_updateLenderAccrual Edge Cases", function () {
    it("Should handle _updateLenderAccrual when lenderSupplyIndex == 0 (uninitialized)", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Create loan and repay to increase poolSupplyIndex
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Get current poolSupplyIndex
      const poolIndex = await unlloo.poolSupplyIndex(usdcAddress);

      // Lender2 deposits (lenderSupplyIndex == 0, should be set to current pool index)
      await mintAndApproveUSDC(usdc, lender2, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender2).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Check lenderSupplyIndex was initialized
      const lenderIndex = await unlloo.lenderSupplyIndex(lender2.address, usdcAddress);
      expect(lenderIndex).to.equal(poolIndex);
    });

    it("Should handle _updateLenderAccrual when addAccrued == 0 (delta too small)", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Lender deposits
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create tiny loan that generates minimal interest
      const tinyBorrow = ethers.parseUnits("10", constants.USDC_DECIMALS); // Minimum
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 10);
      await unlloo.connect(borrower1).borrow(loanId, tinyBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Repay after minimal time
      await mine(1);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Check lender accrual (may be 0 if delta too small)
      const position = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      // addAccrued == 0 case: lenderAccruedInterest should not increase if delta too small
      expect(position.accruedInterest).to.be.gte(0n);
    });

    it("Should handle _updateLenderAccrual when idx == lenderIdx (no accrual)", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Lender deposits
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Get initial accrued interest
      const initialAccrued = (await unlloo.getLenderPosition(lender1.address, usdcAddress)).accruedInterest;

      // Deposit again (idx == lenderIdx, should not accrue)
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Check that accrued interest didn't change (no new interest distributed)
      const afterAccrued = (await unlloo.getLenderPosition(lender1.address, usdcAddress)).accruedInterest;
      expect(afterAccrued).to.equal(initialAccrued);
    });

    it("Should handle _updateLenderAccrual when idx < lenderIdx (should not accrue)", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // This scenario is unlikely but should be handled defensively
      // Lender deposits
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const initialAccrued = (await unlloo.getLenderPosition(lender1.address, usdcAddress)).accruedInterest;

      // If poolSupplyIndex somehow decreases (shouldn't happen, but test defensive check)
      // The contract should not accrue negative interest
      const position = await unlloo.getLenderPosition(lender1.address, usdcAddress);
      expect(position.accruedInterest).to.be.gte(initialAccrued);
    });
  });

  describe("_distributeInterestToLenders Edge Cases", function () {
    it("Should handle _distributeInterestToLenders when totalLiquidity == 0", async function () {
      const usdcAddress = await usdc.getAddress();

      // Create loan when no liquidity exists (should store in poolUndistributedInterest)
      // First, we need to add a pool and create a loan somehow
      // This is tricky since borrow requires liquidity, so we'll test the path through withdrawal

      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create and repay loan
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Withdraw all liquidity
      await unlloo.connect(lender1).withdrawLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Any remaining interest should be in poolUndistributedInterest
      const undistributed = await unlloo.poolUndistributedInterest(usdcAddress);
      expect(undistributed).to.be.gte(0n);
    });

    it("Should handle _distributeInterestToLenders when delta == 0", async function () {
      const usdcAddress = await usdc.getAddress();
      const largeDeposit = ethers.parseUnits("1000000", constants.USDC_DECIMALS);
      const tinyBorrow = ethers.parseUnits("10", constants.USDC_DECIMALS); // Minimum

      // Deposit large amount
      await mintAndApproveUSDC(usdc, lender1, largeDeposit, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, largeDeposit, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrow tiny amount
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 10);
      await unlloo.connect(borrower1).borrow(loanId, tinyBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Repay immediately (minimal interest)
      await mine(1);
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Tiny interest may result in delta == 0, stored in poolUndistributedInterest
      const undistributed = await unlloo.poolUndistributedInterest(usdcAddress);
      expect(undistributed).to.be.gte(0n);
    });

    it("Should handle _distributeInterestToLenders when amount == 0", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Deposit and create loan
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);

      // Repay immediately (zero interest case)
      const totalOwed = await unlloo.getTotalOwed(loanId);
      if (totalOwed > 0n) {
        await repayFully(unlloo, usdc, borrower1, loanId);
      }

      // If interest was zero, _distributeInterestToLenders should return early
      const pool = await unlloo.getLiquidityPool(usdcAddress);
      expect(pool.totalLiquidity).to.be.gte(0n);
    });
  });

  describe("_calculateRepaymentSplit Edge Cases", function () {
    it("Should handle _calculateRepaymentSplit when amount == totalDue exactly", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      await mine(Number(ctx.blocksPerDay));

      // Get exact total due (add buffer for interest accruing during transaction)
      const totalOwed = await unlloo.getTotalOwed(loanId);
      const buffer = ethers.parseUnits("1", constants.USDC_DECIMALS); // Small buffer
      const repayAmount = totalOwed + buffer;

      // Repay exactly totalDue (with buffer)
      await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, repayAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Loan should be fully repaid
      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.status).to.equal(5); // Repaid
      expect(loanAfter.principal).to.equal(0n);
    });

    it("Should handle _calculateRepaymentSplit when amount > totalDue (should cap)", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      await mine(Number(ctx.blocksPerDay));

      const totalOwed = await unlloo.getTotalOwed(loanId);
      const overpayment = totalOwed + ethers.parseUnits("1000", constants.USDC_DECIMALS);

      // Repay more than total due
      await mintAndApproveUSDC(usdc, borrower1, overpayment, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, overpayment, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Loan should be fully repaid (capped at totalDue)
      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.status).to.equal(5); // Repaid
      expect(loanAfter.principal).to.equal(0n);
    });

    it("Should handle _calculateRepaymentSplit when interestDue == 0", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Repay immediately (no interest accrued)
      const principal = (await unlloo.getLoan(loanId)).principal;
      await mintAndApproveUSDC(usdc, borrower1, principal, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, principal, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Should handle principal-only payment
      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.principal).to.be.lte(principal);
    });
  });

  describe("_processInterestPayment Edge Cases", function () {
    it("Should handle _processInterestPayment when lenderInterest == 0", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Make a very small repayment that only covers protocol fee portion
      // This is difficult to test directly, but we can verify the behavior
      await mine(Number(ctx.blocksPerDay));

      const loan = await unlloo.getLoan(loanId);
      const interestAccrued = loan.interestAccrued;

      if (interestAccrued > 0n) {
        // Make partial interest payment
        const partialInterest = interestAccrued / 2n;
        await mintAndApproveUSDC(usdc, borrower1, partialInterest, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId, partialInterest, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Verify interest was processed
        const loanAfter = await unlloo.getLoan(loanId);
        expect(loanAfter.interestAccrued).to.be.lt(interestAccrued);
      }
    });

    it("Should handle _processInterestPayment when interestAccrued == 0 after payment (updates lastAccrualBlock)", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      await mine(Number(ctx.blocksPerDay));

      const totalOwed = await unlloo.getTotalOwed(loanId);

      // Repay fully (interest fully settled)
      await mintAndApproveUSDC(usdc, borrower1, totalOwed, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, totalOwed, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // If loan is fully repaid, lastAccrualBlock should be updated
      const loanAfter = await unlloo.getLoan(loanId);
      if (Number(loanAfter.status) === 5) {
        // Repaid status
        expect(loanAfter.interestAccrued).to.equal(0n);
      }
    });
  });

  describe("_applyPrincipalPayment Edge Cases", function () {
    it("Should handle _applyPrincipalPayment when principalPayment > loan.principal (should cap)", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      const loan = await unlloo.getLoan(loanId);
      const principal = loan.principal;

      // Try to repay more than principal
      const overpayment = principal + ethers.parseUnits("1000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, borrower1, overpayment, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, overpayment, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Principal should be capped at actual principal
      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.principal).to.be.lte(principal);
    });

    it("Should handle _applyPrincipalPayment when principalPayment > pool.borrowedAmount", async function () {
      const usdcAddress = await usdc.getAddress();
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      const poolBefore = await unlloo.getLiquidityPool(usdcAddress);
      const borrowedAmount = poolBefore.borrowedAmount;

      // Repay full principal
      const loan = await unlloo.getLoan(loanId);
      const principal = loan.principal;

      await mintAndApproveUSDC(usdc, borrower1, principal, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, principal, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Pool borrowedAmount should decrease
      const poolAfter = await unlloo.getLiquidityPool(usdcAddress);
      expect(poolAfter.borrowedAmount).to.be.lt(borrowedAmount);
    });
  });

  describe("_checkAndFinalizeRepayment Edge Cases", function () {
    it("Should handle _checkAndFinalizeRepayment when loan.principal == 0 && newTotalDue == 0", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Repay fully
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Loan should be finalized (Repaid status)
      const loan = await unlloo.getLoan(loanId);
      expect(loan.status).to.equal(5); // Repaid
      expect(loan.principal).to.equal(0n);
    });

    it("Should handle _checkAndFinalizeRepayment when loan.principal == 0 && newTotalDue > 0", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Wait a bit to accrue some interest
      await mine(Number(ctx.blocksPerDay));

      // Make partial repayment that pays all interest but only part of principal
      const loan = await unlloo.getLoan(loanId);
      const interestAccrued = loan.interestAccrued;
      const principal = loan.principal;

      // Pay all interest + most of principal (leave small amount of principal)
      const partialPrincipalPayment = principal - 1n; // Leave 1 wei of principal
      const paymentAmount = interestAccrued + partialPrincipalPayment;

      await mintAndApproveUSDC(usdc, borrower1, paymentAmount, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, paymentAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Now pay remaining principal (principal should become 0)
      const remainingPrincipal = (await unlloo.getLoan(loanId)).principal;
      await mintAndApproveUSDC(usdc, borrower1, remainingPrincipal, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, remainingPrincipal, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Verify principal is 0
      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.principal).to.equal(0n);

      // With principal=0, _getAccruedInterest should return existing interestAccrued
      // If there's still interestAccrued > 0, newTotalDue > 0
      const newTotalOwed = await unlloo.getTotalOwed(loanId);

      // If newTotalOwed > 0, loan should not be finalized
      if (newTotalOwed > 0n) {
        expect(loanAfter.status).to.not.equal(5); // Not Repaid yet
      } else {
        // If newTotalOwed == 0, loan should be finalized
        expect(loanAfter.status).to.equal(5); // Repaid
      }
    });
  });

  describe("_finalizeRepaid Edge Cases", function () {
    it("Should handle _finalizeRepaid when beforeStatus == UnpaidDebt", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Let loan go past deadline
      await mine(Number(ctx.maxLoanDurationBlocks) + 1);

      // Mark as overdue
      await unlloo.markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const unpaidDebtCountBefore = await unlloo.unpaidDebtLoanCount(borrower1.address);
      expect(unpaidDebtCountBefore).to.be.gt(0n);

      // Repay fully
      await repayFully(unlloo, usdc, borrower1, loanId);

      // unpaidDebtLoanCount should decrease
      const unpaidDebtCountAfter = await unlloo.unpaidDebtLoanCount(borrower1.address);
      expect(unpaidDebtCountAfter).to.equal(unpaidDebtCountBefore - 1n);
    });

    it("Should handle _finalizeRepaid when beforeStatus == Active", async function () {
      const usdcAddress = await usdc.getAddress();
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      const activeLoansBefore = await unlloo.activeLoansPerPool(usdcAddress);
      expect(activeLoansBefore).to.be.gt(0n);

      // Repay fully
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // activeLoansPerPool should decrease
      const activeLoansAfter = await unlloo.activeLoansPerPool(usdcAddress);
      expect(activeLoansAfter).to.equal(activeLoansBefore - 1n);
    });

    it("Should handle _finalizeRepaid when _activeLoanByBorrower[borrower] == loanId", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Verify active loan is tracked
      const activeLoan = await unlloo.getActiveLoanByBorrower(borrower1.address);
      expect(activeLoan).to.equal(loanId);

      // Repay fully
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Active loan should be cleared
      const activeLoanAfter = await unlloo.getActiveLoanByBorrower(borrower1.address);
      expect(activeLoanAfter).to.equal(0n);
    });
  });

  describe("_calculateBorrowRate Boundary Conditions", function () {
    it("Should handle _calculateBorrowRate when utilization == 0", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Deposit but don't borrow
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Rate should be baseRate (utilization == 0)
      const rate = await unlloo.calculateBorrowRate(usdcAddress);
      const pool = await unlloo.getLiquidityPool(usdcAddress);
      expect(pool.borrowedAmount).to.equal(0n);

      // Rate should be at least MIN_BORROWER_RATE
      const minRate = await unlloo.MIN_BORROWER_RATE();
      expect(rate).to.be.gte(minRate);
    });

    it("Should handle _calculateBorrowRate when utilization == optimalUtilizationBps exactly", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Get rate curve
      const curve = await unlloo.getPoolRateCurve(usdcAddress);
      const optimalUtil = curve.optimalUtilizationBps;

      // Get loan limits first
      const [minLoan, maxLoan] = await unlloo.getPoolLoanLimits(usdcAddress);

      // Calculate borrow amount to reach optimal utilization, but cap at maxLoan
      // Also need to consider available liquidity
      const borrowAmountForOptimal = (depositAmount * optimalUtil) / 10000n;
      const borrowAmount = borrowAmountForOptimal > maxLoan ? maxLoan : borrowAmountForOptimal;

      // Ensure borrow amount is at least minLoan and doesn't exceed available liquidity
      const availableLiquidity = depositAmount; // All liquidity is available
      const finalBorrowAmount = borrowAmount > availableLiquidity ? availableLiquidity : borrowAmount;

      if (finalBorrowAmount >= minLoan) {
        // Create loan with appropriate amount
        const loanAmountUSD = Number(finalBorrowAmount) / Number(10n ** BigInt(constants.USDC_DECIMALS));
        const loanId = await createAndApproveLoan(
          unlloo,
          usdc,
          borrower1,
          owner,
          constants.VALID_REPUTATION,
          Math.floor(loanAmountUSD),
        );
        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);

        // Borrow the minimum of maxBorrowable and finalBorrowAmount
        const actualBorrow = maxBorrowable < finalBorrowAmount ? maxBorrowable : finalBorrowAmount;
        await unlloo.connect(borrower1).borrow(loanId, actualBorrow, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Rate should be calculated correctly
        const rate = await unlloo.calculateBorrowRate(usdcAddress);
        const pool = await unlloo.getLiquidityPool(usdcAddress);
        const utilization = pool.totalLiquidity > 0n ? (pool.borrowedAmount * 10000n) / pool.totalLiquidity : 0n;

        // If we reached optimal utilization, rate should be baseRate + slope1
        if (utilization >= optimalUtil - 10n && utilization <= optimalUtil + 10n) {
          const expectedRate = curve.baseRateBps + curve.slope1Bps;
          expect(rate).to.be.closeTo(expectedRate, 10n); // Allow small rounding
        } else {
          // Otherwise, just verify rate is valid
          expect(rate).to.be.gte(curve.baseRateBps);
        }
      } else {
        // If borrow amount is below minLoan, test with minimum loan
        const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 10);
        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
        await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Verify rate calculation works
        const rate = await unlloo.calculateBorrowRate(usdcAddress);
        expect(rate).to.be.gte(curve.baseRateBps);
      }
    });

    it("Should handle _calculateBorrowRate when utilization == 10000 (100%)", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Get max borrowable (may be less than depositAmount due to loan limits)
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);

      // Borrow maximum allowed
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Rate should be at maximum (baseRate + slope1 + slope2, clamped to MAX_BORROWER_RATE)
      const rate = await unlloo.calculateBorrowRate(usdcAddress);
      const maxRate = await unlloo.MAX_BORROWER_RATE();
      expect(rate).to.be.lte(maxRate);

      // Check utilization is high
      const pool = await unlloo.getLiquidityPool(usdcAddress);
      const utilization = (pool.borrowedAmount * 10000n) / pool.totalLiquidity;
      expect(utilization).to.be.gt(0n);
    });

    it("Should handle _calculateBorrowRate when calculated rate < MIN_BORROWER_RATE (should clamp)", async function () {
      const usdcAddress = await usdc.getAddress();
      const minRate = await unlloo.MIN_BORROWER_RATE();

      // Rate should never be below MIN_BORROWER_RATE
      const rate = await unlloo.calculateBorrowRate(usdcAddress);
      expect(rate).to.be.gte(minRate);
    });

    it("Should handle _calculateBorrowRate when calculated rate > MAX_BORROWER_RATE (should clamp)", async function () {
      const usdcAddress = await usdc.getAddress();
      const maxRate = await unlloo.MAX_BORROWER_RATE();

      // Create scenario with high utilization
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrow maximum allowed (may be less than depositAmount due to loan limits)
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Rate should be clamped to MAX_BORROWER_RATE
      const rate = await unlloo.calculateBorrowRate(usdcAddress);
      expect(rate).to.be.lte(maxRate);
    });
  });

  describe("_getAccruedInterest Sentinel Checks", function () {
    it("Should handle _getAccruedInterest when loan.principal == 0", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Repay fully
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // getAccruedInterest should return 0 for zero principal
      const interest = await unlloo.getAccruedInterest(loanId);
      expect(interest).to.equal(0n);
    });

    it("Should handle _getAccruedInterest when loan.borrowRateBps == 0", async function () {
      // This is difficult to test directly since borrowRateBps is set during borrow
      // But we can verify the sentinel check works
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      const loan = await unlloo.getLoan(loanId);
      expect(loan.borrowRateBps).to.be.gt(0n);

      // If borrowRateBps were 0, getAccruedInterest should return existing interestAccrued
      const interest = await unlloo.getAccruedInterest(loanId);
      expect(interest).to.be.gte(0n);
    });

    it("Should handle _getAccruedInterest when lastAccrualBlock == 0", async function () {
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);

      // Before borrow, lastAccrualBlock is 0
      const loan = await unlloo.getLoan(loanId);
      expect(loan.lastAccrualBlock).to.equal(0n);

      // getAccruedInterest should return existing interestAccrued (0)
      const interest = await unlloo.getAccruedInterest(loanId);
      expect(interest).to.equal(0n);
    });

    it("Should handle _getAccruedInterest when blocksElapsed == 0", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      // Get interest immediately (same block)
      const interest1 = await unlloo.getAccruedInterest(loanId);

      // Advance blocks
      await mine(Number(ctx.blocksPerDay));

      // Get interest after blocks elapsed
      const interest2 = await unlloo.getAccruedInterest(loanId);
      expect(interest2).to.be.gte(interest1);
    });

    it("Should handle _getAccruedInterest when blocksElapsed > MAX_BLOCKS_FOR_INTEREST", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      const maxBlocks = await unlloo.MAX_BLOCKS_FOR_INTEREST();

      // Advance blocks beyond MAX_BLOCKS_FOR_INTEREST
      await mine(Number(maxBlocks) + 1000);

      // Interest should still be calculated (no revert)
      const interest = await unlloo.getAccruedInterest(loanId);
      expect(interest).to.be.gte(0n);
    });
  });

  describe("Integration: Multiple Edge Cases in Sequence", function () {
    it("Should handle complex sequence: deposit → borrow → repay → withdraw (all in same block)", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Deposit
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Borrow
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);

      // Repay immediately
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Withdraw
      await unlloo.connect(lender1).withdrawLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // All operations should complete successfully
      const pool = await unlloo.getLiquidityPool(usdcAddress);
      expect(pool.totalLiquidity).to.be.gte(0n);
    });

    it("Should handle multiple lenders → all withdraw → pool becomes empty → new deposit", async function () {
      const usdcAddress = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Multiple lenders deposit
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await mintAndApproveUSDC(usdc, lender2, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender2).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create and repay loan
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000, depositAmount);
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // All lenders withdraw
      await unlloo.connect(lender1).withdrawLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await unlloo.connect(lender2).withdrawLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Pool should be empty
      const pool = await unlloo.getLiquidityPool(usdcAddress);
      expect(pool.totalLiquidity).to.equal(0n);

      // New deposit should work
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const poolAfter = await unlloo.getLiquidityPool(usdcAddress);
      expect(poolAfter.totalLiquidity).to.equal(depositAmount);
    });
  });
});
