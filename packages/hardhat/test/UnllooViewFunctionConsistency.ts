/**
 * @file View Function Consistency Tests
 * @description Tests for view function accuracy and consistency across state changes
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { setupCompleteBorrow, repayFully, mintAndApproveUSDC, depositLiquidity } from "./helpers";

describe("Unlloo - View Function Consistency", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    lender1 = ctx.lender1;
  });

  describe("getLoan() Virtual Status Projection", function () {
    it("Should match storage after markLoanOverdue()", async function () {
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

      const loan = await unlloo.loans(loanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      // Before markLoanOverdue: view shows UnpaidDebt (virtual), storage shows Active
      const loanViewBefore = await unlloo.getLoan(loanId);
      const loanStorageBefore = await unlloo.loans(loanId);
      expect(loanViewBefore.status).to.equal(3); // UnpaidDebt (virtual)
      expect(loanStorageBefore.status).to.equal(2); // Active

      // Call markLoanOverdue
      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // After: both should show UnpaidDebt
      const loanViewAfter = await unlloo.getLoan(loanId);
      const loanStorageAfter = await unlloo.loans(loanId);
      expect(loanViewAfter.status).to.equal(3); // UnpaidDebt
      expect(loanStorageAfter.status).to.equal(3); // UnpaidDebt
    });

    it("Should match storage after repayment", async function () {
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

      // Keep the loan Active for the “before repayment” assertions
      await mine(Number(ctx.blocksPerDay - 1n));

      // Before repayment: both should show Active
      const loanViewBefore = await unlloo.getLoan(loanId);
      const loanStorageBefore = await unlloo.loans(loanId);
      expect(loanViewBefore.status).to.equal(2); // Active
      expect(loanStorageBefore.status).to.equal(2); // Active

      // Repay fully
      await repayFully(unlloo, usdc, borrower1, loanId);

      // After: both should show Repaid
      const loanViewAfter = await unlloo.getLoan(loanId);
      const loanStorageAfter = await unlloo.loans(loanId);
      expect(loanViewAfter.status).to.equal(5); // Repaid
      expect(loanStorageAfter.status).to.equal(5); // Repaid
    });
  });

  describe("getLoansByStatus() Consistency", function () {
    it("Should return consistent results across state changes", async function () {
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

      // Check loan is in Active list
      const activeLoansBefore = await unlloo.getLoansByStatus(2, 0, 100); // Active = 2
      expect(activeLoansBefore).to.include(loanId);

      // Repay
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Should be in Repaid list, not Active
      const activeLoansAfter = await unlloo.getLoansByStatus(2, 0, 100);
      const repaidLoans = await unlloo.getLoansByStatus(5, 0, 100); // Repaid = 5
      expect(activeLoansAfter).to.not.include(loanId);
      expect(repaidLoans).to.include(loanId);
    });
  });

  describe("getActiveLoanByBorrower() Updates", function () {
    it("Should update correctly on borrow", async function () {
      expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(0n);

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

      expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(loanId);
    });

    it("Should update correctly on repay", async function () {
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

      expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(loanId);

      await repayFully(unlloo, usdc, borrower1, loanId);

      expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(0n);
    });
  });

  describe("canSubmitRequest() Consistency", function () {
    it("Should return correct value across all state transitions", async function () {
      // Initially should be true
      expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(true);

      // After submitting request (pending)
      await unlloo
        .connect(borrower1)
        .submitLoanRequest(
          constants.VALID_REPUTATION,
          await usdc.getAddress(),
          ethers.parseUnits("1000", constants.USDC_DECIMALS),
          ctx.minLoanDurationBlocks,
          {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          },
        );
      expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(false); // Has pending request

      // After approval
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(false); // Still has open request

      // After borrow
      await mintAndApproveUSDC(usdc, lender1, ethers.parseUnits("100000", constants.USDC_DECIMALS), ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, ethers.parseUnits("100000", constants.USDC_DECIMALS));
      await unlloo.connect(borrower1).borrow(loanId, ethers.parseUnits("1000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(false); // Has active loan

      // After repay
      await repayFully(unlloo, usdc, borrower1, loanId);
      await mine(Number(ctx.cooldownBlocks) + 1); // Wait for cooldown
      expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(true); // Can submit again
    });
  });

  describe("hasUnpaidDebt() Consistency", function () {
    it("Should return correct value across all state transitions", async function () {
      expect(await unlloo.hasUnpaidDebt(borrower1.address)).to.equal(false);

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

      expect(await unlloo.hasUnpaidDebt(borrower1.address)).to.equal(false); // Still active

      // Make overdue
      const loan = await unlloo.loans(loanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock) + 1);
      }

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      expect(await unlloo.hasUnpaidDebt(borrower1.address)).to.equal(true); // Now has unpaid debt

      // After repay
      await repayFully(unlloo, usdc, borrower1, loanId);
      expect(await unlloo.hasUnpaidDebt(borrower1.address)).to.equal(false); // Debt cleared
    });
  });

  describe("getLenderPosition() Consistency", function () {
    it("Should return consistent values during loan lifecycle", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

      const positionBefore = await unlloo.getLenderPosition(lender1.address, usdcAddr);
      expect(positionBefore.depositedAmount).to.equal(depositAmount);

      // Create and repay loan (generates interest)
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
      await mine(Number(ctx.blocksPerDay));
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Position should have accrued interest
      const positionAfter = await unlloo.getLenderPosition(lender1.address, usdcAddr);
      expect(positionAfter.depositedAmount).to.equal(depositAmount); // Principal unchanged
      expect(positionAfter.accruedInterest).to.be.gt(0n); // Interest accrued
    });
  });

  describe("View Functions - Gas Efficiency", function () {
    it("Should not modify state (view functions)", async function () {
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

      // Call view functions multiple times
      const loan1 = await unlloo.getLoan(loanId);
      const loan2 = await unlloo.getLoan(loanId);
      const loan3 = await unlloo.getLoan(loanId);

      // Results should be identical (no state changes)
      expect(loan1.loanId).to.equal(loan2.loanId);
      expect(loan2.loanId).to.equal(loan3.loanId);
    });
  });

  describe("View Functions - Non-existent Data", function () {
    it("Should handle non-existent loan correctly", async function () {
      const nonExistentLoanId = 99999n;
      const loan = await unlloo.loans(nonExistentLoanId);
      expect(loan.borrower).to.equal(ethers.ZeroAddress);
    });

    it("Should return zero for non-existent lender position", async function () {
      const usdcAddr = await usdc.getAddress();
      const position = await unlloo.getLenderPosition(ethers.Wallet.createRandom().address, usdcAddr);
      expect(position.depositedAmount).to.equal(0n);
      expect(position.accruedInterest).to.equal(0n);
    });
  });
});
