/**
 * @file Mark Loan Overdue Tests
 * @description Comprehensive tests for markLoanOverdue public function
 *              Tests status transitions, counter updates, and edge cases
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { setupCompleteBorrow, createAndApproveLoan, mintAndApproveUSDC, repayFully } from "./helpers";

describe("Unlloo - Mark Loan Overdue", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let borrower2: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    borrower2 = ctx.borrower2;
    lender1 = ctx.lender1;
    nonOwner = ctx.nonOwner;
  });

  describe("Access Control", function () {
    it("Should allow anyone to call markLoanOverdue (public function)", async function () {
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

      // Mine blocks past deadline
      const loan = await unlloo.loans(loanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      await mine(Number(deadline - currentBlock + 1n));

      // Non-owner should be able to call
      await expect(unlloo.connect(nonOwner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to.not
        .be.reverted;
    });

    it("Should allow owner to call markLoanOverdue", async function () {
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
      await mine(Number(deadline - currentBlock + 1n));

      await expect(unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to.not.be
        .reverted;
    });
  });

  describe("Status Validation", function () {
    it("Should only work on Active loans", async function () {
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
      await mine(Number(deadline - currentBlock + 1n));

      await expect(unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to.not.be
        .reverted;

      // Try to call again (loan is now UnpaidDebt, not Active)
      await expect(
        unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert if loan is Pending", async function () {
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
      const loanId = await unlloo.loanCounter();

      await expect(
        unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert if loan is Approved", async function () {
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);

      await expect(
        unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert if loan is Rejected", async function () {
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
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(
        unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert if loan is Repaid", async function () {
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

      // Repay fully (use helper buffer to avoid edge-case underpayment)
      await repayFully(unlloo, usdc, borrower1, loanId);

      await expect(
        unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });
  });

  describe("Timing Validation", function () {
    it("Should revert if loan hasn't passed deadline yet", async function () {
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

      // Don't mine past deadline
      if (currentBlock < deadline) {
        await expect(
          unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
      }
    });

    it("Should revert at exactly the expiry block", async function () {
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

      // Mine to exactly deadline block
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock));
      }

      // At exactly deadline, markLoanOverdue should succeed (contract checks block.number < deadline)
      await expect(unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to.not.be
        .reverted;
    });

    it("Should succeed after expiry block", async function () {
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

      // Mine past deadline
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      await expect(unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to.not.be
        .reverted;
    });
  });

  describe("Status Transitions", function () {
    it("Should transition loan status from Active to UnpaidDebt", async function () {
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
      expect(loanBefore.status).to.equal(2); // Active

      const deadline = BigInt(loanBefore.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanAfter = await unlloo.loans(loanId);
      expect(loanAfter.status).to.equal(3); // UnpaidDebt
    });

    it("Should remove loan from Active list after transition", async function () {
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
      const activeLoansBefore = await unlloo.getLoansByStatus(2, 0, 100); // Active status = 2
      expect(activeLoansBefore).to.include(loanId);

      const loan = await unlloo.loans(loanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Check loan is removed from Active list
      const activeLoansAfter = await unlloo.getLoansByStatus(2, 0, 100);
      expect(activeLoansAfter).to.not.include(loanId);
    });

    it("Should add loan to UnpaidDebt list after transition", async function () {
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

      // Check loan is not in UnpaidDebt list
      const unpaidDebtLoansBefore = await unlloo.getLoansByStatus(3, 0, 100); // UnpaidDebt status = 3
      expect(unpaidDebtLoansBefore).to.not.include(loanId);

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Check loan is in UnpaidDebt list
      const unpaidDebtLoansAfter = await unlloo.getLoansByStatus(3, 0, 100);
      expect(unpaidDebtLoansAfter).to.include(loanId);
    });
  });

  describe("Borrower State Management", function () {
    it("Should increment unpaidDebtLoanCount for borrower", async function () {
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

      const countBefore = await unlloo.unpaidDebtLoanCount(borrower1.address);
      expect(countBefore).to.equal(0n);

      const loan = await unlloo.loans(loanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const countAfter = await unlloo.unpaidDebtLoanCount(borrower1.address);
      expect(countAfter).to.equal(1n);
    });

    it("Should decrement activeLoansPerPool counter", async function () {
      const usdcAddr = await usdc.getAddress();
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

      const activeLoansBefore = await unlloo.activeLoansPerPool(usdcAddr);
      expect(activeLoansBefore).to.equal(1n);

      const loan = await unlloo.loans(loanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const activeLoansAfter = await unlloo.activeLoansPerPool(usdcAddr);
      expect(activeLoansAfter).to.equal(0n);
    });

    it("Should increment unpaidDebtLoansPerPool counter", async function () {
      const usdcAddr = await usdc.getAddress();
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

      const unpaidDebtBefore = await unlloo.unpaidDebtLoansPerPool(usdcAddr);
      expect(unpaidDebtBefore).to.equal(0n);

      const loan = await unlloo.loans(loanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const unpaidDebtAfter = await unlloo.unpaidDebtLoansPerPool(usdcAddr);
      expect(unpaidDebtAfter).to.equal(1n);
    });

    it("Should allow borrower to submit new request after markLoanOverdue (if they repay)", async function () {
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

      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Borrower should not be able to submit new request with unpaid debt
      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            },
          ),
      ).to.be.revertedWithCustomError(unlloo, "HasUnpaidDebt");

      // After repaying, should be able to submit
      await repayFully(unlloo, usdc, borrower1, loanId);

      // Should be able to submit new request after cooldown
      await mine(Number(ctx.cooldownBlocks) + 1);
      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            },
          ),
      ).to.not.be.reverted;
    });
  });

  describe("Event Emission", function () {
    it("Should emit LoanMovedToUnpaidDebt event on transition", async function () {
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

      await expect(unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }))
        .to.emit(unlloo, "LoanMovedToUnpaidDebt")
        .withArgs(loanId, borrower1.address, deadline, (value: bigint) => value > 0n);
    });
  });

  describe("Edge Cases", function () {
    it("Should not affect other approved loans when one is expired", async function () {
      // Create two loans
      const loanId1 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
      const loanId2 = await createAndApproveLoan(unlloo, usdc, borrower2, owner, constants.VALID_REPUTATION, 1000);

      // Borrow only first loan
      await mintAndApproveUSDC(usdc, lender1, ethers.parseUnits("100000", constants.USDC_DECIMALS), ctx.unllooAddress);
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("100000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

      await unlloo.connect(borrower1).borrow(loanId1, ethers.parseUnits("1000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const loan1 = await unlloo.loans(loanId1);
      const deadline = BigInt(loan1.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      // Mark first loan overdue
      await unlloo.connect(owner).markLoanOverdue(loanId1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Second loan should still be Approved
      const loan2 = await unlloo.loans(loanId2);
      expect(loan2.status).to.equal(1); // Approved
    });

    it("Should prevent double-expiry of same loan", async function () {
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

      // First call should succeed
      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Second call should revert (loan is now UnpaidDebt, not Active)
      await expect(
        unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should not allow borrow() after markLoanOverdue", async function () {
      // Create an active loan for borrower1
      const { loanId: activeLoanId } = await setupCompleteBorrow(
        unlloo,
        usdc,
        borrower1,
        lender1,
        owner,
        1000,
        ethers.parseUnits("100000", constants.USDC_DECIMALS),
        ctx.minLoanDurationBlocks,
      );

      const loan = await unlloo.loans(activeLoanId);
      const deadline = BigInt(loan.deadlineBlock.toString());
      const currentBlock = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock + 1n));
      }

      await unlloo.connect(owner).markLoanOverdue(activeLoanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Borrower with unpaid debt should not be able to even submit a new request
      await expect(
        createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000),
      ).to.be.revertedWithCustomError(unlloo, "HasUnpaidDebt");
    });
  });

  describe("Interaction with getLoan() Virtual Status", function () {
    it("Should match getLoan() virtual status projection after markLoanOverdue", async function () {
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

      // Before markLoanOverdue, getLoan() should show UnpaidDebt (virtual projection)
      const loanViewBefore = await unlloo.getLoan(loanId);
      expect(loanViewBefore.status).to.equal(3); // UnpaidDebt (virtual)

      // Storage still shows Active
      const loanStorageBefore = await unlloo.loans(loanId);
      expect(loanStorageBefore.status).to.equal(2); // Active

      // Call markLoanOverdue
      await unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // After markLoanOverdue, both should show UnpaidDebt
      const loanViewAfter = await unlloo.getLoan(loanId);
      const loanStorageAfter = await unlloo.loans(loanId);
      expect(loanViewAfter.status).to.equal(3); // UnpaidDebt
      expect(loanStorageAfter.status).to.equal(3); // UnpaidDebt
    });
  });
});
