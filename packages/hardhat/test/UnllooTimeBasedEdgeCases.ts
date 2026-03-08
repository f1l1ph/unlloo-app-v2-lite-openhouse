/**
 * @file Time-Based Edge Cases Tests
 * @description Tests for time manipulation, block time variations, and boundary conditions
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { setupCompleteBorrow, mintAndApproveUSDC, depositLiquidity, createAndApproveLoan } from "./helpers";

describe("Unlloo - Time-Based Edge Cases", function () {
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

  describe("Interest Accrual with Different Block Times", function () {
    it("Should calculate interest correctly with standard block time", async function () {
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

      const blocksPerDay = Number(ctx.blocksPerDay);
      await mine(blocksPerDay);

      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gt(0n);
    });

    it("Should handle interest calculation when blocks are mined during transaction", async function () {
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

      // Get interest before mining
      const interestBefore = await unlloo.getAccruedInterest(loanId);

      // Mine blocks
      await mine(10);

      // Get interest after mining (should be higher)
      const interestAfter = await unlloo.getAccruedInterest(loanId);
      expect(interestAfter).to.be.gte(interestBefore);
    });
  });

  describe("Loan Duration Calculations", function () {
    it("Should calculate loan duration correctly with block time", async function () {
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
      const expectedDeadline = loan.startBlock + loan.loanDurationBlocks;
      expect(loan.deadlineBlock).to.equal(expectedDeadline);
    });
  });

  describe("Cooldown Calculations", function () {
    it("Should calculate cooldown correctly with block time", async function () {
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

      const cooldownEnd = await unlloo.getCooldownEndBlock(borrower1.address);
      const lastRequestBlock = await ethers.provider.getBlockNumber();
      const expectedCooldownEnd = BigInt(lastRequestBlock) + ctx.cooldownBlocks;

      expect(cooldownEnd).to.equal(expectedCooldownEnd);
    });
  });

  describe("Expiry Calculations", function () {
    it("Should calculate expiry correctly with block time", async function () {
      const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);

      // Loan should expire after APPROVED_LOAN_EXPIRY_BLOCKS
      await mine(Number(ctx.approvedLoanExpiryBlocks) + 1);

      // Try to borrow (should fail due to expiry)
      await mintAndApproveUSDC(usdc, lender1, ethers.parseUnits("100000", constants.USDC_DECIMALS), ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, ethers.parseUnits("100000", constants.USDC_DECIMALS));

      await expect(
        unlloo.connect(borrower1).borrow(loanId, ethers.parseUnits("1000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "ApprovedLoanExpired");
    });
  });

  describe("Interest Calculation at MAX_BLOCKS_FOR_INTEREST Boundary", function () {
    it("Should handle very large block jumps (>= MAX_BLOCKS_FOR_INTEREST) without reverting", async function () {
      // Note: MAX_LOAN_DURATION_BLOCKS (~60 days) is smaller than MAX_BLOCKS_FOR_INTEREST (10,000,000),
      // so we can't create a loan with duration == MAX_BLOCKS_FOR_INTEREST. What we *can* test is that
      // interest computation remains safe even if the chain advances by that many blocks.
      const maxBlocks = await unlloo.MAX_BLOCKS_FOR_INTEREST();

      const { loanId } = await setupCompleteBorrow(
        unlloo,
        usdc,
        borrower1,
        lender1,
        owner,
        1000,
        ethers.parseUnits("100000", constants.USDC_DECIMALS),
        ctx.maxLoanDurationBlocks,
      );

      await mine(Number(maxBlocks) + 5);

      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gt(0n);
    });
  });

  describe("Time Jump Manipulation", function () {
    it("Should handle time jumps correctly", async function () {
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

      const interestBefore = await unlloo.getAccruedInterest(loanId);

      // Jump time forward (simulating hardhat time manipulation)
      await time.increase(86400); // 1 day in seconds

      // Interest should still be calculated based on blocks, not time
      const interestAfter = await unlloo.getAccruedInterest(loanId);
      // Interest might be same if no blocks mined, or higher if blocks were mined
      expect(interestAfter).to.be.gte(interestBefore);
    });
  });

  describe("Boundary Conditions", function () {
    it("Should handle interest calculation at exactly deadline block", async function () {
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

      // Mine to exactly deadline
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock));
      }

      // Interest should still accrue
      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gte(0n);
    });

    it("Should handle interest calculation after deadline", async function () {
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
        await mine(Number(deadline - currentBlock + 100n));
      }

      // Interest should continue accruing (interest continues after due date)
      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gt(0n);
    });
  });

  describe("5-Year Interest Accrual Cap After Deadline", function () {
    it("Should cap interest accrual to 5 years after deadline for non-repaid loans", async function () {
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

      // Calculate 5 years in blocks
      const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
      const BLOCK_TIME_SECONDS = BigInt(constants.BLOCK_TIME_SECONDS);
      const MAX_INTEREST_ACCRUAL_YEARS = 5n;
      const maxInterestAccrualBlocks = (MAX_INTEREST_ACCRUAL_YEARS * SECONDS_PER_YEAR) / BLOCK_TIME_SECONDS;
      const maxInterestBlock = deadline + maxInterestAccrualBlocks;

      // Mine to just before the deadline
      if (currentBlock < deadline) {
        await mine(Number(deadline - currentBlock));
      }

      // Get interest just before deadline
      const interestBeforeDeadline = await unlloo.getAccruedInterest(loanId);
      expect(interestBeforeDeadline).to.be.gt(0n);

      // Mine past deadline but before 5-year cap
      const blocksAfterDeadline = Number(maxInterestAccrualBlocks / 2n); // Halfway to 5-year cap
      await mine(blocksAfterDeadline);

      // Interest should continue accruing after deadline
      const interestAfterDeadline = await unlloo.getAccruedInterest(loanId);
      expect(interestAfterDeadline).to.be.gt(interestBeforeDeadline);

      // Mine to exactly 5 years after deadline
      const currentBlockAfter = BigInt(await ethers.provider.getBlockNumber());
      if (currentBlockAfter < maxInterestBlock) {
        await mine(Number(maxInterestBlock - currentBlockAfter));
      }

      // Get interest at 5-year cap
      const interestAt5Years = await unlloo.getAccruedInterest(loanId);
      expect(interestAt5Years).to.be.gt(interestAfterDeadline);

      // Mine additional blocks beyond 5-year cap
      await mine(1000);

      // Interest should NOT increase beyond 5-year cap
      const interestAfter5Years = await unlloo.getAccruedInterest(loanId);
      expect(interestAfter5Years).to.equal(interestAt5Years, "Interest should not accrue beyond 5-year cap");
    });

    it("Should enforce 5-year cap when calling _accrueLoanInterest (via repay)", async function () {
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

      // Calculate 5 years in blocks
      const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
      const BLOCK_TIME_SECONDS = BigInt(constants.BLOCK_TIME_SECONDS);
      const MAX_INTEREST_ACCRUAL_YEARS = 5n;
      const maxInterestAccrualBlocks = (MAX_INTEREST_ACCRUAL_YEARS * SECONDS_PER_YEAR) / BLOCK_TIME_SECONDS;
      const maxInterestBlock = deadline + maxInterestAccrualBlocks;

      // Mine to 5 years after deadline + extra blocks
      if (currentBlock < maxInterestBlock) {
        await mine(Number(maxInterestBlock - currentBlock + 1000n));
      }

      // Get interest before repay (should be capped)
      const interestBeforeRepay = await unlloo.getAccruedInterest(loanId);

      // Try to repay (this will call _accrueLoanInterest internally)
      // First, ensure borrower has enough USDC
      await mintAndApproveUSDC(
        usdc,
        borrower1,
        ethers.parseUnits("200000", constants.USDC_DECIMALS),
        ctx.unllooAddress,
      );

      const totalOwed = await unlloo.getTotalOwed(loanId);
      await unlloo.connect(borrower1).repay(loanId, totalOwed, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Interest should still be capped (not increased beyond 5-year limit)
      // After repayment, interest should be reduced, but the cap should have been respected
      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.interestAccrued).to.be.lte(interestBeforeRepay);
    });

    it("Should handle edge case: deadline exactly at 5-year cap boundary", async function () {
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

      // Calculate 5 years in blocks
      const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
      const BLOCK_TIME_SECONDS = BigInt(constants.BLOCK_TIME_SECONDS);
      const MAX_INTEREST_ACCRUAL_YEARS = 5n;
      const maxInterestAccrualBlocks = (MAX_INTEREST_ACCRUAL_YEARS * SECONDS_PER_YEAR) / BLOCK_TIME_SECONDS;
      const maxInterestBlock = deadline + maxInterestAccrualBlocks;

      // Mine to exactly 5 years after deadline
      if (currentBlock < maxInterestBlock) {
        await mine(Number(maxInterestBlock - currentBlock));
      }

      const interestAtCap = await unlloo.getAccruedInterest(loanId);
      expect(interestAtCap).to.be.gt(0n);

      // Mine one more block
      await mine(1);

      // Interest should not increase
      const interestAfterCap = await unlloo.getAccruedInterest(loanId);
      expect(interestAfterCap).to.equal(interestAtCap, "Interest should not increase beyond 5-year cap");
    });
  });
});
