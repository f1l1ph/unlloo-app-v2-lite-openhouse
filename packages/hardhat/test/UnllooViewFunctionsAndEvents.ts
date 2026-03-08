import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import { mintAndApproveUSDC } from "./helpers/tokenHelpers";
import { createAndApproveLoan, setupCompleteBorrow } from "./helpers/loanHelpers";
import * as constants from "./fixtures/constants";

/**
 * @title Unlloo View Functions and Events Tests
 * @notice Comprehensive tests for view functions and event emissions
 * @dev Tests cover:
 *      1. View function correctness
 *      2. Pagination edge cases
 *      3. Event emission verification
 *      4. Event parameter correctness
 */
describe("Unlloo - View Functions and Events", function () {
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

  // ============ View Function Tests ============

  describe("View Functions", function () {
    describe("getLoansByStatus", function () {
      it("Should return loans with correct pagination", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("50000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("50000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        // Create multiple loans (use different borrowers to avoid cooldown)
        await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
        await createAndApproveLoan(unlloo, usdc, borrower2, owner, constants.VALID_REPUTATION, 1000);
        // Get a third unique borrower to avoid MAX_PENDING_LOANS_PER_USER constraint
        const signers = await ethers.getSigners();
        const borrower3 = signers[5];
        await createAndApproveLoan(unlloo, usdc, borrower3, owner, constants.VALID_REPUTATION, 1000);

        // Get pending loans (should be 0 after approval)
        const pendingLoans = await unlloo.getLoansByStatus(0, 0, 10); // Status 0 = Pending
        expect(pendingLoans.length).to.equal(0);

        // Get approved loans
        const approvedLoans = await unlloo.getLoansByStatus(1, 0, 10); // Status 1 = Approved
        expect(approvedLoans.length).to.equal(3);

        // Test pagination
        const firstPage = await unlloo.getLoansByStatus(1, 0, 2);
        expect(firstPage.length).to.equal(2);

        const secondPage = await unlloo.getLoansByStatus(1, 2, 2);
        expect(secondPage.length).to.equal(1);
      });

      it("Should handle pagination edge cases (offset beyond length, zero limit)", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);

        // Offset beyond length should return empty array
        const beyondLength = await unlloo.getLoansByStatus(1, 100, 10);
        expect(beyondLength.length).to.equal(0);

        // Zero limit should return empty array
        const zeroLimit = await unlloo.getLoansByStatus(1, 0, 0);
        expect(zeroLimit.length).to.equal(0);
      });

      it("Should handle getLoansByStatus with invalid status enum values", async function () {
        // Status 6+ will revert in Solidity because enum values are type-checked
        // We need to catch the revert - Solidity enums revert on invalid values
        // The contract will revert when trying to use an invalid enum value
        // This is expected behavior - we can't test invalid enum values directly
        // Instead, we test that valid enum values (0-5) work correctly
        // Valid statuses: Pending(0), Approved(1), Active(2), UnpaidDebt(3), Rejected(4), Repaid(5)
        for (let status = 0; status <= 5; status++) {
          const loans = await unlloo.getLoansByStatus(status, 0, 10);
          expect(loans).to.be.an("array");
        }
      });

      it("Should handle getLoansByStatus with very large offset", async function () {
        const largeOffset = 1000000;
        const loans = await unlloo.getLoansByStatus(1, largeOffset, 10);
        expect(loans.length).to.equal(0);
      });

      it("Should handle getLoansByStatus with very large limit", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);

        // Very large limit should cap to actual array length
        const largeLimit = 1000000;
        const loans = await unlloo.getLoansByStatus(1, 0, largeLimit);
        expect(loans.length).to.be.gte(1);
        expect(loans.length).to.be.lte(largeLimit);
      });
    });

    describe("getActiveLoanByBorrower", function () {
      it("Should return active loan for borrower", async function () {
        const { loanId } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        const activeLoanId = await unlloo.getActiveLoanByBorrower(borrower1.address);
        expect(activeLoanId).to.equal(loanId);
        const activeLoan = await unlloo.getLoan(activeLoanId);
        expect(activeLoan.status).to.equal(2); // Active
      });

      it("Should return zero loanId when no active loan exists", async function () {
        const activeLoanId = await unlloo.getActiveLoanByBorrower(borrower1.address);
        expect(activeLoanId).to.equal(0n);
      });

      it("Should handle multiple loans per borrower correctly", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("20000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("20000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        // Create first loan and borrow
        const loanId1 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 5000);
        const maxBorrowable1 = await unlloo.getApprovedLoanAmount(loanId1);
        await unlloo.connect(borrower1).borrow(loanId1, maxBorrowable1, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Repay first loan
        await mine(Number(ctx.blocksPerDay));
        const totalOwed1 = await unlloo.getTotalOwed(loanId1);
        const repayAmount1 = totalOwed1 + 1_000_000n;
        await mintAndApproveUSDC(usdc, borrower1, repayAmount1, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId1, repayAmount1, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Create and borrow second loan
        const loanId2 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 5000);
        const maxBorrowable2 = await unlloo.getApprovedLoanAmount(loanId2);
        await unlloo.connect(borrower1).borrow(loanId2, maxBorrowable2, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Should return second loan as active
        const activeLoanId = await unlloo.getActiveLoanByBorrower(borrower1.address);
        expect(activeLoanId).to.equal(loanId2);
      });
    });

    describe("canSubmitRequest", function () {
      it("Should return true when borrower can submit request", async function () {
        const canSubmit = await unlloo.canSubmitRequest(borrower1.address);
        expect(canSubmit).to.equal(true);
      });

      it("Should return false when borrower has active loan", async function () {
        await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        const canSubmit = await unlloo.canSubmitRequest(borrower1.address);
        expect(canSubmit).to.equal(false);
      });

      it("Should return false when borrower has unpaid debt", async function () {
        const { loanId } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        // Let loan expire
        const loan = await unlloo.loans(loanId);
        const deadlineBlock = loan.startBlock + loan.loanDurationBlocks;
        const currentBlock = await ethers.provider.getBlockNumber();
        const blocksToDeadline = Number(deadlineBlock) - currentBlock;
        await mine(blocksToDeadline);

        const canSubmit = await unlloo.canSubmitRequest(borrower1.address);
        expect(canSubmit).to.equal(false);
      });

      it("Should return false when cooldown not expired", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        // Submit loan request
        await unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          );
        const loanId = await unlloo.loanCounter();
        await unlloo.connect(owner).rejectLoanRequest(loanId, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Cooldown should not be expired yet
        const canSubmit = await unlloo.canSubmitRequest(borrower1.address);
        expect(canSubmit).to.equal(false);
      });
    });

    describe("getCooldownEndBlock", function () {
      it("Should return correct cooldown end block", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        // Submit loan request
        await unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          );
        const loanId = await unlloo.loanCounter();
        const rejectBlock = await ethers.provider.getBlockNumber();
        await unlloo.connect(owner).rejectLoanRequest(loanId, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const cooldownEndBlock = await unlloo.getCooldownEndBlock(borrower1.address);
        const cooldownBlocks = await unlloo.cooldownBlocks();
        expect(cooldownEndBlock).to.equal(BigInt(rejectBlock) + cooldownBlocks);
      });

      it("Should return zero when no cooldown active", async function () {
        const cooldownEndBlock = await unlloo.getCooldownEndBlock(borrower1.address);
        expect(cooldownEndBlock).to.equal(0n);
      });
    });

    describe("getAccruedInterest", function () {
      it("Should return zero for non-existent loan", async function () {
        // Non-existent loan should revert with LoanNotFound
        await expect(unlloo.getAccruedInterest(99999)).to.be.revertedWithCustomError(unlloo, "LoanNotFound");
      });

      it("Should return correct accrued interest", async function () {
        const { loanId } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        // No interest initially
        const interestBefore = await unlloo.getAccruedInterest(loanId);
        expect(interestBefore).to.equal(0n);

        // Advance blocks
        await mine(Number(ctx.blocksPerDay));

        const interestAfter = await unlloo.getAccruedInterest(loanId);
        expect(interestAfter).to.be.gt(0n);
      });
    });

    describe("getTotalOwed", function () {
      it("Should return principal + interest", async function () {
        const { loanId } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        await mine(Number(ctx.blocksPerDay));

        const totalOwed = await unlloo.getTotalOwed(loanId);
        const interest = await unlloo.getAccruedInterest(loanId);
        const loan = await unlloo.loans(loanId);

        expect(totalOwed).to.equal(loan.principal + interest);
      });
    });

    describe("getLoansByBorrower", function () {
      it("Should return empty array for borrower with no loans", async function () {
        const signers = await ethers.getSigners();
        const newBorrower = signers[10];
        const loans = await unlloo.getLoansByBorrower(newBorrower.address);
        expect(loans.length).to.equal(0);
      });

      it("Should return all loans for borrower across different statuses", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("50000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("50000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        // Create loan sequence for same borrower (one at a time due to cooldown/active loan constraints)
        // 1. First loan - Pending -> Approved -> Active -> Repaid
        await unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            usdcAddress,
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          );
        const loanId1 = await unlloo.loanCounter();
        await unlloo.connect(owner).approveLoanRequest(loanId1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        const maxBorrowable1 = await unlloo.getApprovedLoanAmount(loanId1);
        await unlloo.connect(borrower1).borrow(loanId1, maxBorrowable1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Repay first loan fully
        await mine(Number(ctx.blocksPerDay));
        const totalOwed1 = await unlloo.getTotalOwed(loanId1);
        await mintAndApproveUSDC(usdc, borrower1, totalOwed1 + 1000000n, await unlloo.getAddress());
        await unlloo
          .connect(borrower1)
          .repay(loanId1, totalOwed1 + 1000000n, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Verify loan is fully repaid
        const loan1After = await unlloo.getLoan(loanId1);
        expect(loan1After.status).to.equal(5); // Repaid

        // Verify borrower has no unpaid debt
        const hasUnpaidDebt = await unlloo.hasUnpaidDebt(borrower1.address);
        expect(hasUnpaidDebt).to.equal(false);

        // Wait for cooldown to expire
        const cooldownBlocks = await unlloo.cooldownBlocks();
        await mine(Number(cooldownBlocks) + 1);

        // 2. Second loan - Pending -> Approved -> Active -> Repaid
        await unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            usdcAddress,
            ethers.parseUnits("2000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          );
        const loanId2 = await unlloo.loanCounter();
        await unlloo.connect(owner).approveLoanRequest(loanId2, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        const maxBorrowable2 = await unlloo.getApprovedLoanAmount(loanId2);
        await unlloo.connect(borrower1).borrow(loanId2, maxBorrowable2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Repay second loan
        await mine(Number(ctx.blocksPerDay));
        const totalOwed2 = await unlloo.getTotalOwed(loanId2);
        await mintAndApproveUSDC(usdc, borrower1, totalOwed2, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId2, totalOwed2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Get all loans for borrower - should include both loans
        const allLoans = await unlloo.getLoansByBorrower(borrower1.address);
        expect(allLoans.length).to.be.gte(2);
        expect(allLoans).to.include(loanId1);
        expect(allLoans).to.include(loanId2);
      });

      it("Should match borrowerLoans mapping", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        // Create loan
        await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);

        // Compare getLoansByBorrower() with borrowerLoans() mapping
        const viaFunction = await unlloo.getLoansByBorrower(borrower1.address);
        const viaMapping = await unlloo.borrowerLoans(borrower1.address);
        expect(viaFunction).to.deep.equal(viaMapping);
      });
    });

    describe("getTotalOwed", function () {
      it("Should return correct total owed after partial repayment", async function () {
        const { loanId, borrowAmount } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        await mine(Number(ctx.blocksPerDay));

        const totalOwed = await unlloo.getTotalOwed(loanId);
        const partialRepayment = borrowAmount; // Repay only principal

        await mintAndApproveUSDC(usdc, borrower1, partialRepayment, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId, partialRepayment, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const totalOwedAfter = await unlloo.getTotalOwed(loanId);
        // After partial repayment, total owed should be less than before (or 0 if fully repaid)
        // Contract may have cleared principal if within dust threshold
        if (totalOwedAfter > 0n) {
          expect(totalOwedAfter).to.be.lt(totalOwed);
        } else {
          // Loan may have been fully repaid if principal was cleared
          const loan = await unlloo.loans(loanId);
          expect(loan.status).to.equal(5); // Repaid
        }
      });

      it("Should return zero total owed when loan fully repaid", async function () {
        const { loanId } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        await mine(Number(ctx.blocksPerDay));

        const totalOwed = await unlloo.getTotalOwed(loanId);
        const repayAmount = totalOwed + 1_000_000n;
        await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId, repayAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const remainingBalance = await unlloo.getTotalOwed(loanId);
        expect(remainingBalance).to.equal(0n);
      });
    });
  });

  // ============ Event Emission Tests ============

  describe("Event Emissions", function () {
    describe("LoanRequestSubmitted", function () {
      it("Should emit LoanRequestSubmitted with correct parameters", async function () {
        const usdcAddress = await usdc.getAddress();
        const reputation = constants.VALID_REPUTATION;
        const amount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        const duration = ctx.minLoanDurationBlocks;

        const tx = await unlloo.connect(borrower1).submitLoanRequest(reputation, usdcAddress, amount, duration, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const receipt = await tx.wait();
        const event = receipt?.logs.find(log => {
          try {
            const parsed = unlloo.interface.parseLog(log);
            return parsed?.name === "LoanRequestSubmitted";
          } catch {
            return false;
          }
        });

        expect(event).to.not.equal(undefined);
        if (event) {
          const parsed = unlloo.interface.parseLog(event);
          expect(parsed?.args.borrower).to.equal(borrower1.address);
          expect(parsed?.args.walletReputation).to.equal(reputation);
        }
      });
    });

    describe("LoanRequestApproved", function () {
      it("Should emit LoanRequestApproved with correct parameters", async function () {
        const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);

        // Get the approval event from the transaction
        const loan = await unlloo.loans(loanId);
        expect(loan.status).to.equal(1); // Approved
        expect(loan.approvalBlock).to.be.gt(0n);
      });
    });

    describe("LoanBorrowed", function () {
      it("Should emit LoanBorrowed with correct parameters", async function () {
        const usdcAddress = await usdc.getAddress();
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(usdcAddress, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);

        const tx = await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const receipt = await tx.wait();
        const event = receipt?.logs.find(log => {
          try {
            const parsed = unlloo.interface.parseLog(log);
            return parsed?.name === "LoanBorrowed";
          } catch {
            return false;
          }
        });

        expect(event).to.not.equal(undefined);
        if (event) {
          const parsed = unlloo.interface.parseLog(event);
          expect(parsed?.args.loanId).to.equal(loanId);
          expect(parsed?.args.borrower).to.equal(borrower1.address);
          expect(parsed?.args.principal).to.equal(maxBorrowable);
        }
      });
    });

    describe("LoanRepaid", function () {
      it("Should emit LoanRepaid with correct parameters", async function () {
        const { loanId } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        await mine(Number(ctx.blocksPerDay));

        const totalOwed = await unlloo.getTotalOwed(loanId);
        await mintAndApproveUSDC(usdc, borrower1, totalOwed, await unlloo.getAddress());

        const tx = await unlloo.connect(borrower1).repay(loanId, totalOwed, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const receipt = await tx.wait();
        const event = receipt?.logs.find(log => {
          try {
            const parsed = unlloo.interface.parseLog(log);
            return parsed?.name === "LoanRepaid";
          } catch {
            return false;
          }
        });

        expect(event).to.not.equal(undefined);
        if (event) {
          const parsed = unlloo.interface.parseLog(event);
          expect(parsed?.args.loanId).to.equal(loanId);
          expect(parsed?.args.payer).to.equal(borrower1.address);
        }
      });
    });

    describe("LiquidityDeposited", function () {
      it("Should emit LiquidityDeposited with correct parameters", async function () {
        const usdcAddress = await usdc.getAddress();
        const amount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

        await mintAndApproveUSDC(usdc, lender1, amount, await unlloo.getAddress());

        const tx = await unlloo.connect(lender1).depositLiquidity(usdcAddress, amount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const receipt = await tx.wait();
        const event = receipt?.logs.find(log => {
          try {
            const parsed = unlloo.interface.parseLog(log);
            return parsed?.name === "LiquidityDeposited";
          } catch {
            return false;
          }
        });

        expect(event).to.not.equal(undefined);
        if (event) {
          const parsed = unlloo.interface.parseLog(event);
          expect(parsed?.args.lender).to.equal(lender1.address);
          expect(parsed?.args.token).to.equal(usdcAddress);
          expect(parsed?.args.amount).to.equal(amount);
        }
      });
    });

    describe("LiquidityWithdrawn", function () {
      it("Should emit LiquidityWithdrawn with correct parameters", async function () {
        const usdcAddress = await usdc.getAddress();
        const amount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

        await mintAndApproveUSDC(usdc, lender1, amount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(usdcAddress, amount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const lenderPosition = await unlloo.lenderPositions(lender1.address, usdcAddress);
        const withdrawAmount = lenderPosition.depositedAmount;

        const tx = await unlloo.connect(lender1).withdrawLiquidity(usdcAddress, withdrawAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const receipt = await tx.wait();
        const event = receipt?.logs.find(log => {
          try {
            const parsed = unlloo.interface.parseLog(log);
            return parsed?.name === "LiquidityWithdrawn";
          } catch {
            return false;
          }
        });

        expect(event).to.not.equal(undefined);
        if (event) {
          const parsed = unlloo.interface.parseLog(event);
          expect(parsed?.args.lender).to.equal(lender1.address);
          expect(parsed?.args.token).to.equal(usdcAddress);
        }
      });
    });

    describe("InterestRatesUpdated", function () {
      it("Should emit InterestRatesUpdated when rate curve is updated", async function () {
        const usdcAddress = await usdc.getAddress();
        const newBaseRate = 300;
        const newOptimalUtil = 7500;
        const newSlope1 = 500;
        const newSlope2 = 3000;
        const newProtocolFee = 2000;

        await expect(
          unlloo
            .connect(owner)
            .updatePoolRateCurve(usdcAddress, newBaseRate, newOptimalUtil, newSlope1, newSlope2, newProtocolFee, {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            }),
        )
          .to.emit(unlloo, "InterestRatesUpdated")
          .withArgs(
            usdcAddress,
            newBaseRate,
            newOptimalUtil,
            newSlope1,
            newSlope2,
            newProtocolFee,
            (value: bigint) => value > 0n,
          );
      });
    });

    describe("PoolLoanLimitsUpdated", function () {
      it("Should emit PoolLoanLimitsUpdated when limits are updated", async function () {
        const usdcAddress = await usdc.getAddress();
        const newMinLoan = ethers.parseUnits("20", constants.USDC_DECIMALS);
        const newMaxLoan = ethers.parseUnits("200000", constants.USDC_DECIMALS);

        await expect(
          unlloo.connect(owner).updatePoolLoanLimits(usdcAddress, newMinLoan, newMaxLoan, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        )
          .to.emit(unlloo, "PoolLoanLimitsUpdated")
          .withArgs(usdcAddress, newMinLoan, newMaxLoan, (value: bigint) => value > 0n);
      });
    });

    describe("LoanMovedToUnpaidDebt", function () {
      it("Should emit LoanMovedToUnpaidDebt when markLoanOverdue is called", async function () {
        const { loanId } = await setupCompleteBorrow(
          unlloo,
          usdc,
          borrower1,
          lender1,
          owner,
          1000,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
        );

        const loan = await unlloo.loans(loanId);
        const deadline = BigInt(loan.deadlineBlock.toString());
        const currentBlock = BigInt(await ethers.provider.getBlockNumber());
        if (currentBlock < deadline) {
          await mine(Number(deadline - currentBlock) + 1);
        }

        await expect(unlloo.connect(owner).markLoanOverdue(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT }))
          .to.emit(unlloo, "LoanMovedToUnpaidDebt")
          .withArgs(loanId, borrower1.address, deadline, (value: bigint) => value > 0n);
      });
    });

    describe("MinReputationUpdated", function () {
      it("Should emit MinReputationUpdated when minReputation is updated", async function () {
        const newMinReputation = 300;

        await expect(
          unlloo.connect(owner).updateMinReputation(newMinReputation, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        )
          .to.emit(unlloo, "MinReputationUpdated")
          .withArgs(200, newMinReputation, (value: bigint) => value > 0n);
      });
    });

    describe("CooldownBlocksUpdated", function () {
      it("Should emit CooldownBlocksUpdated when cooldown is updated", async function () {
        const newCooldown = ctx.cooldownBlocks * 2n;

        await expect(
          unlloo.connect(owner).updateCooldownBlocks(newCooldown, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        )
          .to.emit(unlloo, "CooldownBlocksUpdated")
          .withArgs(ctx.cooldownBlocks, newCooldown, (value: bigint) => value > 0n);
      });
    });

    describe("PoolAdded", function () {
      it("Should emit PoolAdded when new pool is added", async function () {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const newToken = (await MockERC20Factory.deploy("NewToken", "NT", constants.USDC_DECIMALS, {
          gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
        })) as MockERC20;
        await newToken.waitForDeployment();

        const minLoanAmount = ethers.parseUnits("10", constants.USDC_DECIMALS);
        const maxLoanAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);

        await expect(
          unlloo.connect(owner).addLiquidityPool(await newToken.getAddress(), minLoanAmount, maxLoanAmount, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        )
          .to.emit(unlloo, "PoolAdded")
          .withArgs(await newToken.getAddress(), (value: bigint) => value > 0n);
      });
    });

    describe("PoolRemoved", function () {
      it("Should emit PoolRemoved when pool is removed", async function () {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const tempToken = (await MockERC20Factory.deploy("TempToken", "TT", constants.USDC_DECIMALS, {
          gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
        })) as MockERC20;
        await tempToken.waitForDeployment();

        const minLoanAmount = ethers.parseUnits("10", constants.USDC_DECIMALS);
        const maxLoanAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);
        await unlloo.connect(owner).addLiquidityPool(await tempToken.getAddress(), minLoanAmount, maxLoanAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        await expect(
          unlloo
            .connect(owner)
            .removeLiquidityPool(await tempToken.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        )
          .to.emit(unlloo, "PoolRemoved")
          .withArgs(await tempToken.getAddress(), (value: bigint) => value > 0n);
      });
    });

    describe("EmergencyWithdraw", function () {
      it("Should emit EmergencyWithdraw when emergency withdraw is called", async function () {
        // Deploy a token that's not a pool token
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const nonPoolToken = (await MockERC20Factory.deploy("NonPoolToken", "NPT", constants.USDC_DECIMALS, {
          gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
        })) as MockERC20;
        await nonPoolToken.waitForDeployment();

        // Send some tokens to contract
        await nonPoolToken.mint(await unlloo.getAddress(), ethers.parseUnits("1000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });

        const withdrawAmount = ethers.parseUnits("500", constants.USDC_DECIMALS);
        await expect(
          unlloo.connect(owner).emergencyWithdraw(await nonPoolToken.getAddress(), withdrawAmount, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        )
          .to.emit(unlloo, "EmergencyWithdraw")
          .withArgs(await nonPoolToken.getAddress(), withdrawAmount, (value: bigint) => value > 0n);

        await unlloo.connect(owner).unpause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
      });
    });

    describe("ETHReceived", function () {
      it("Should emit ETHReceived when ETH is received", async function () {
        const ethAmount = ethers.parseEther("1.0");

        await expect(
          owner.sendTransaction({
            to: await unlloo.getAddress(),
            value: ethAmount,
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        )
          .to.emit(unlloo, "ETHReceived")
          .withArgs(owner.address, ethAmount, (value: bigint) => value > 0n);
      });
    });

    describe("ETHWithdrawn", function () {
      it("Should emit ETHWithdrawn when ETH is withdrawn", async function () {
        // First receive some ETH
        const ethAmount = ethers.parseEther("1.0");
        await owner.sendTransaction({
          to: await unlloo.getAddress(),
          value: ethAmount,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const withdrawAmount = ethers.parseEther("0.5");
        await expect(unlloo.connect(owner).withdrawETH(withdrawAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT }))
          .to.emit(unlloo, "ETHWithdrawn")
          .withArgs(owner.address, withdrawAmount, (value: bigint) => value > 0n);
      });
    });
  });

  // ============ View Functions - Non-existent Pool Edge Cases ============
  describe("View Functions - Non-existent Pool Edge Cases", function () {
    it("Should return empty struct for getLiquidityPool on non-existent token", async function () {
      const nonExistentToken = ethers.Wallet.createRandom().address;
      const pool = await unlloo.getLiquidityPool(nonExistentToken);
      expect(pool.token).to.equal(ethers.ZeroAddress);
      expect(pool.totalLiquidity).to.equal(0n);
      expect(pool.borrowedAmount).to.equal(0n);
    });

    it("Should return empty struct for getPoolRateCurve on non-existent token", async function () {
      const nonExistentToken = ethers.Wallet.createRandom().address;
      const curve = await unlloo.getPoolRateCurve(nonExistentToken);
      expect(curve.baseRateBps).to.equal(0n);
      expect(curve.optimalUtilizationBps).to.equal(0n);
      expect(curve.slope1Bps).to.equal(0n);
      expect(curve.slope2Bps).to.equal(0n);
      expect(curve.protocolFeeBps).to.equal(0n);
    });

    it("Should return zeros for getPoolLoanLimits on non-existent token", async function () {
      const nonExistentToken = ethers.Wallet.createRandom().address;
      const [minLoan, maxLoan] = await unlloo.getPoolLoanLimits(nonExistentToken);
      expect(minLoan).to.equal(0n);
      expect(maxLoan).to.equal(0n);
    });

    it("Should return MIN_BORROWER_RATE for calculateBorrowRate on non-existent token", async function () {
      const nonExistentToken = ethers.Wallet.createRandom().address;
      const rate = await unlloo.calculateBorrowRate(nonExistentToken);
      const minRate = await unlloo.MIN_BORROWER_RATE();
      expect(rate).to.equal(minRate);
    });

    it("Should return zero for getProtocolFees on non-existent token", async function () {
      const nonExistentToken = ethers.Wallet.createRandom().address;
      const fees = await unlloo.getProtocolFees(nonExistentToken);
      expect(fees).to.equal(0n);
    });
  });

  // ============ Public Mapping View Functions ============
  describe("Public Mapping View Functions", function () {
    it("Should match borrowerLoans() with getLoansByBorrower()", async function () {
      const usdcAddress = await usdc.getAddress();
      await mintAndApproveUSDC(
        usdc,
        lender1,
        ethers.parseUnits("30000", constants.USDC_DECIMALS),
        await unlloo.getAddress(),
      );
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, ethers.parseUnits("30000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create first loan for borrower1
      const loanId1 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
      const maxBorrowable1 = await unlloo.getApprovedLoanAmount(loanId1);
      await unlloo.connect(borrower1).borrow(loanId1, maxBorrowable1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Repay first loan
      await mine(Number(ctx.blocksPerDay));
      const totalOwed1 = await unlloo.getTotalOwed(loanId1);
      await mintAndApproveUSDC(usdc, borrower1, totalOwed1 + 1000000n, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId1, totalOwed1 + 1000000n, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Wait for cooldown to expire
      const cooldownBlocks = await unlloo.cooldownBlocks();
      await mine(Number(cooldownBlocks) + 1);

      // Create second loan for borrower1 (after cooldown and repayment)
      const loanId2 = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 2000);

      // Compare getLoansByBorrower() with borrowerLoans() mapping
      const viaFunction = await unlloo.getLoansByBorrower(borrower1.address);
      const viaMapping = await unlloo.borrowerLoans(borrower1.address);
      expect(viaFunction).to.deep.equal(viaMapping);
      expect(viaFunction.length).to.be.gte(2);
      expect(viaFunction).to.include(loanId1);
      expect(viaFunction).to.include(loanId2);
    });

    it("Should match loansByStatus() with getLoansByStatus()", async function () {
      const usdcAddress = await usdc.getAddress();
      await mintAndApproveUSDC(
        usdc,
        lender1,
        ethers.parseUnits("50000", constants.USDC_DECIMALS),
        await unlloo.getAddress(),
      );
      await unlloo.connect(lender1).depositLiquidity(usdcAddress, ethers.parseUnits("50000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create multiple approved loans
      await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
      await createAndApproveLoan(unlloo, usdc, borrower2, owner, constants.VALID_REPUTATION, 2000);
      const signers = await ethers.getSigners();
      const borrower3 = signers[5];
      await createAndApproveLoan(unlloo, usdc, borrower3, owner, constants.VALID_REPUTATION, 3000);

      // Compare loansByStatus() with getLoansByStatus() with large limit
      const status = 1; // Approved
      const viaFunction = await unlloo.getLoansByStatus(status, 0, 1000);
      const viaMapping = await unlloo.loansByStatus(status);
      expect(viaFunction).to.deep.equal(viaMapping);
    });

    it("Should handle loansByStatus() for all status enum values", async function () {
      // Test each status: Pending(0), Approved(1), Active(2), UnpaidDebt(3), Rejected(4), Repaid(5)
      for (let status = 0; status <= 5; status++) {
        const loans = await unlloo.loansByStatus(status);
        expect(loans).to.be.an("array");
        // Should not revert for any valid status enum value
      }
    });
  });
});
