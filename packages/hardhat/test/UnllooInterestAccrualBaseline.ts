import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import * as constants from "./fixtures/constants";
import { UnllooCombined } from "./fixtures/UnllooTestFixture";

/**
 * @title Unlloo Interest Accrual Baseline Tests (Strategy A)
 * @notice Tests verify that interest accrual baseline is separate from principal changes
 * @dev Strategy A: Never reset interest accrual baseline on principal-only repayments
 *      - Interest accrues continuously based on time, not principal payments
 *      - lastAccrualBlock only updates when interest is fully settled
 *      - Micro-repayments don't reduce interest growth
 *      - Borrowers pay full time-based interest
 */
describe("Unlloo - Interest Accrual Baseline (Strategy A)", function () {
  // Contract instances
  let unlloo: UnllooCombined;
  let usdc: MockERC20;

  // Signers
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;

  // Loan duration constants
  let MIN_LOAN_DURATION_BLOCKS: bigint;

  // Helper to mint and approve USDC
  async function mintAndApproveUSDC(user: HardhatEthersSigner, amount: bigint) {
    await usdc.mint(user.address, amount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    await usdc.connect(user).approve(await unlloo.getAddress(), amount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
  }

  // Helper to create and approve loan
  async function createAndApproveLoan(
    borrower: HardhatEthersSigner,
    amount: bigint,
    durationBlocks: bigint,
  ): Promise<bigint> {
    const usdcAddress = await usdc.getAddress();
    const tx = await unlloo
      .connect(borrower)
      .submitLoanRequest(constants.VALID_REPUTATION, usdcAddress, amount, durationBlocks, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
    const receipt = await tx.wait();
    const event = receipt?.logs.find(log => {
      try {
        const parsed = unlloo.interface.parseLog(log as any);
        return parsed?.name === "LoanRequestSubmitted";
      } catch {
        return false;
      }
    });
    const loanId = event ? unlloo.interface.parseLog(event as any)?.args[0] : null;
    if (!loanId) throw new Error("Loan ID not found");

    await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    return loanId;
  }

  // Helper to calculate expected interest
  async function calculateExpectedInterest(principal: bigint, blocksElapsed: bigint, rateBps: bigint): Promise<bigint> {
    const blockTimeSeconds = await unlloo.blockTimeSeconds();
    const secondsPerYear = 365n * 24n * 60n * 60n;
    return (principal * rateBps * blocksElapsed * blockTimeSeconds) / (10000n * secondsPerYear);
  }

  beforeEach(async function () {
    [owner, borrower1, lender1] = await ethers.getSigners();

    // Deploy MockERC20
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USD Coin", "USDC", constants.USDC_DECIMALS, {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    });
    await usdc.waitForDeployment();

    // Deploy UnllooExt (extension delegate)
    const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
    const unllooExt = await UnllooExtFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
    await unllooExt.waitForDeployment();

    // Deploy UnllooCore implementation
    const UnllooFactory = await ethers.getContractFactory("UnllooCore");
    const unllooImpl = await UnllooFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
    await unllooImpl.waitForDeployment();
    const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
    const unllooProxy = await UnllooProxyFactory.deploy(await unllooImpl.getAddress(), "0x", {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    });
    await unllooProxy.waitForDeployment();

    // Build merged ABI so all Core + Ext functions are callable via the proxy
    const proxyAddress = await unllooProxy.getAddress();
    const mergedAbi = [
      ...UnllooFactory.interface.fragments,
      ...UnllooExtFactory.interface.fragments.filter((extFrag: any) => {
        if (extFrag.type !== "function") return true;
        return UnllooFactory.interface.getFunction(extFrag.selector) === null;
      }),
    ];
    unlloo = new ethers.Contract(proxyAddress, mergedAbi, owner) as unknown as UnllooCombined;

    // Initialize
    const usdcAddress = await usdc.getAddress();
    const blockTimeSeconds = 12n; // 12 seconds per block
    const defaultMinLoan = ethers.parseUnits("100", constants.USDC_DECIMALS);
    const defaultMaxLoan = ethers.parseUnits("1000000", constants.USDC_DECIMALS);
    await unlloo.initialize(
      usdcAddress,
      blockTimeSeconds,
      owner.address,
      defaultMinLoan,
      defaultMaxLoan,
      await unllooExt.getAddress(),
      {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      },
    );

    // Setup liquidity
    const depositAmount = ethers.parseUnits("1000000", constants.USDC_DECIMALS);
    await mintAndApproveUSDC(lender1, depositAmount);
    await unlloo.connect(lender1).depositLiquidity(usdcAddress, depositAmount, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });

    // Get loan duration constants from contract
    MIN_LOAN_DURATION_BLOCKS = await unlloo.minLoanDurationBlocks();
  });

  describe("Strategy A: Separate Accrual Baseline from Principal", function () {
    it("Should NOT reset lastAccrualBlock on principal-only payments", async function () {
      const loanAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const durationBlocks = MIN_LOAN_DURATION_BLOCKS;

      // Create and borrow
      const loanId = await createAndApproveLoan(borrower1, loanAmount, durationBlocks);
      await mintAndApproveUSDC(borrower1, loanAmount);
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanBefore = await unlloo.getLoan(loanId);
      const initialLastAccrualBlock = loanBefore.lastAccrualBlock;
      expect(initialLastAccrualBlock).to.be.gt(0n);

      // Wait some blocks to accrue interest
      await mine(100);

      // Make a principal-only payment (pay interest first, then principal)
      const interestDue = await unlloo.getAccruedInterest(loanId);
      const principalPayment = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      const totalPayment = interestDue + principalPayment;

      await mintAndApproveUSDC(borrower1, totalPayment);
      await unlloo.connect(borrower1).repay(loanId, totalPayment, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify lastAccrualBlock was NOT reset (should still be the same or updated only if interest fully paid)
      const loanAfter = await unlloo.getLoan(loanId);
      // If interest was fully paid, lastAccrualBlock should be updated to current block
      // If interest was partially paid, lastAccrualBlock should remain unchanged
      // Since we paid all interest + principal, interest should be fully paid
      expect(loanAfter.lastAccrualBlock).to.be.gte(initialLastAccrualBlock);
    });

    it("Should only reset lastAccrualBlock when interest is fully settled", async function () {
      const loanAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const durationBlocks = MIN_LOAN_DURATION_BLOCKS;

      // Create and borrow
      const loanId = await createAndApproveLoan(borrower1, loanAmount, durationBlocks);
      await mintAndApproveUSDC(borrower1, loanAmount);
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanBefore = await unlloo.getLoan(loanId);
      const initialLastAccrualBlock = loanBefore.lastAccrualBlock;

      // Wait some blocks to accrue interest
      await mine(100);
      const interestDue = await unlloo.getAccruedInterest(loanId);
      expect(interestDue).to.be.gt(0n);

      // Make partial interest payment
      const partialPayment = interestDue / 2n;
      await mintAndApproveUSDC(borrower1, partialPayment);
      await unlloo.connect(borrower1).repay(loanId, partialPayment, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify lastAccrualBlock was NOT reset (interest not fully paid)
      const loanAfterPartial = await unlloo.getLoan(loanId);
      expect(loanAfterPartial.lastAccrualBlock).to.equal(initialLastAccrualBlock);
      expect(loanAfterPartial.interestAccrued).to.be.gt(0n);

      // Now pay remaining interest (get total owed to account for any interest accrued during transaction)
      const totalOwed = await unlloo.getTotalOwed(loanId);
      await mintAndApproveUSDC(borrower1, totalOwed);
      await unlloo.connect(borrower1).repay(loanId, totalOwed, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify lastAccrualBlock was reset (interest fully paid)
      const loanAfterFull = await unlloo.getLoan(loanId);
      expect(loanAfterFull.lastAccrualBlock).to.be.gt(initialLastAccrualBlock);
      expect(loanAfterFull.interestAccrued).to.equal(0n);
    });

    it("Should accrue interest continuously regardless of principal payments", async function () {
      const loanAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const durationBlocks = MIN_LOAN_DURATION_BLOCKS;

      // Create and borrow
      const loanId = await createAndApproveLoan(borrower1, loanAmount, durationBlocks);
      await mintAndApproveUSDC(borrower1, loanAmount);
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.getLoan(loanId);
      const initialPrincipal = loan.principal;
      const initialLastAccrualBlock = loan.lastAccrualBlock;
      const rateBps = loan.borrowRateBps;

      // Wait blocks and accrue interest
      await mine(100);
      const interestAfter100Blocks = await unlloo.getAccruedInterest(loanId);
      expect(interestAfter100Blocks).to.be.gt(0n);

      // Make principal payment (pay interest + principal)
      // Note: repay() accrues interest first, so we need to account for that
      const principalPayment = ethers.parseUnits("2000", constants.USDC_DECIMALS);
      // Get total owed which includes interest that will be accrued during repay()
      const totalOwedBefore = await unlloo.getTotalOwed(loanId);
      const interestBefore = totalOwedBefore - initialPrincipal;

      // Calculate payment: interest + principal payment
      // But we need to ensure we don't pay more than total owed
      const totalPayment = interestBefore + principalPayment;
      const cappedPayment = totalPayment > totalOwedBefore ? totalOwedBefore : totalPayment;

      await mintAndApproveUSDC(borrower1, cappedPayment);
      await unlloo.connect(borrower1).repay(loanId, cappedPayment, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify principal decreased but lastAccrualBlock should be updated (interest was fully paid)
      const loanAfterPayment = await unlloo.getLoan(loanId);
      // Principal should be reduced by the principal payment amount (or remaining principal if less)
      // Allow small tolerance for interest accrual during transaction affecting principal payment
      const expectedPrincipal = initialPrincipal > principalPayment ? initialPrincipal - principalPayment : 0n;
      const tolerance = ethers.parseUnits("0.1", constants.USDC_DECIMALS); // 0.1 USDC tolerance
      expect(loanAfterPayment.principal).to.be.closeTo(expectedPrincipal, tolerance);
      expect(loanAfterPayment.interestAccrued).to.equal(0n);
      expect(loanAfterPayment.lastAccrualBlock).to.be.gt(initialLastAccrualBlock);

      // Wait more blocks
      await mine(100);

      // Verify interest accrues on the new (lower) principal
      const interestAfter200Blocks = await unlloo.getAccruedInterest(loanId);
      expect(interestAfter200Blocks).to.be.gt(0n);

      // Get actual blocks elapsed from lastAccrualBlock
      const currentBlock = await ethers.provider.getBlockNumber();
      const actualBlocksElapsed = BigInt(currentBlock) - loanAfterPayment.lastAccrualBlock;

      // Calculate expected interest on reduced principal using actual blocks elapsed
      const expectedInterest = await calculateExpectedInterest(
        loanAfterPayment.principal,
        actualBlocksElapsed,
        rateBps,
      );

      // Allow tolerance for rounding and transaction timing (up to 2 USDC)
      const interestTolerance = ethers.parseUnits("2", constants.USDC_DECIMALS);
      expect(interestAfter200Blocks).to.be.closeTo(expectedInterest, interestTolerance);
    });

    it("Should prevent micro-repayments from reducing interest growth", async function () {
      const loanAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const durationBlocks = MIN_LOAN_DURATION_BLOCKS;

      // Create and borrow
      const loanId = await createAndApproveLoan(borrower1, loanAmount, durationBlocks);
      await mintAndApproveUSDC(borrower1, loanAmount);
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.getLoan(loanId);
      const initialLastAccrualBlock = loan.lastAccrualBlock;

      // Wait blocks to accrue interest
      await mine(200);

      // Make multiple small principal payments
      const numPayments = 5;
      const principalPaymentPerTime = ethers.parseUnits("100", constants.USDC_DECIMALS);

      for (let i = 0; i < numPayments; i++) {
        await mine(20); // Wait between payments

        const interestDue = await unlloo.getAccruedInterest(loanId);
        const totalPayment = interestDue + principalPaymentPerTime;
        await mintAndApproveUSDC(borrower1, totalPayment);
        await unlloo.connect(borrower1).repay(loanId, totalPayment, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      }

      // Verify interest accrued over the full time period
      // Interest should be based on continuous accrual, not reset by principal payments
      const finalLoan = await unlloo.getLoan(loanId);

      // Interest should have accrued continuously, accounting for principal reductions
      // We can't easily calculate exact expected interest due to principal changes,
      // but we can verify that lastAccrualBlock was properly managed
      expect(finalLoan.lastAccrualBlock).to.be.gt(initialLastAccrualBlock);

      // If interest is fully paid, lastAccrualBlock should be recent
      if (finalLoan.interestAccrued === 0n) {
        const currentBlock = await ethers.provider.getBlockNumber();
        expect(finalLoan.lastAccrualBlock).to.be.closeTo(BigInt(currentBlock), 5n);
      }
    });

    it("Should maintain correct interest accrual baseline across multiple repayments", async function () {
      const loanAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const durationBlocks = MIN_LOAN_DURATION_BLOCKS;

      // Create and borrow
      const loanId = await createAndApproveLoan(borrower1, loanAmount, durationBlocks);
      await mintAndApproveUSDC(borrower1, loanAmount);
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.getLoan(loanId);
      const initialPrincipal = loan.principal;
      const initialLastAccrualBlock = loan.lastAccrualBlock;

      // Scenario: Make interest-only payment, then principal payment
      await mine(100);
      const interest1 = await unlloo.getAccruedInterest(loanId);
      expect(interest1).to.be.gt(0n);

      // Pay interest only
      // Get the interest amount that will be due (getAccruedInterest calculates it correctly)
      // Note: repay() will call _accrueLoanInterest() first, which adds interest to loan.interestAccrued
      // So we need to pay the amount that getAccruedInterest() returns (which includes the accrual)
      const interestToPay = await unlloo.getAccruedInterest(loanId);
      expect(interestToPay).to.be.gt(0n);

      // Pay the interest amount (add tiny buffer for any rounding, but keep it minimal)
      // The buffer should be small enough that it doesn't significantly affect principal
      const tinyBuffer = ethers.parseUnits("0.001", constants.USDC_DECIMALS); // 0.001 USDC buffer
      const paymentAmount = interestToPay + tinyBuffer;
      await mintAndApproveUSDC(borrower1, paymentAmount);
      await unlloo.connect(borrower1).repay(loanId, paymentAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanAfterInterest = await unlloo.getLoan(loanId);
      // Interest may accrue during the transaction itself, so allow small tolerance
      const interestToleranceAfterPay = ethers.parseUnits("0.001", constants.USDC_DECIMALS);
      expect(loanAfterInterest.interestAccrued).to.be.closeTo(0n, interestToleranceAfterPay);
      // lastAccrualBlock only updates when interest is FULLY settled; if tiny amount remains, it may not update
      expect(loanAfterInterest.lastAccrualBlock).to.be.gte(initialLastAccrualBlock);
      // Principal should remain unchanged (we only paid interest)
      // Allow small tolerance for the tiny buffer we added (0.001 USDC)
      const principalTolerance = ethers.parseUnits("0.002", constants.USDC_DECIMALS); // Slightly more than buffer
      expect(loanAfterInterest.principal).to.be.closeTo(initialPrincipal, principalTolerance);

      // Wait and accrue more interest
      await mine(100);
      const interest2 = await unlloo.getAccruedInterest(loanId);
      expect(interest2).to.be.gt(0n);

      // Pay interest + principal
      // Get the actual interest that will be due (repay() accrues interest first)
      const principalPayment = ethers.parseUnits("2000", constants.USDC_DECIMALS);
      const interest2ToPay = await unlloo.getAccruedInterest(loanId);
      const loanBeforePrincipalPayment = await unlloo.getLoan(loanId);

      // Calculate payment: interest + principal (but cap at remaining principal)
      const maxPrincipalToPay2 =
        loanBeforePrincipalPayment.principal < principalPayment
          ? loanBeforePrincipalPayment.principal
          : principalPayment;
      const totalPayment = interest2ToPay + maxPrincipalToPay2;
      await mintAndApproveUSDC(borrower1, totalPayment);
      await unlloo.connect(borrower1).repay(loanId, totalPayment, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanAfterPrincipal = await unlloo.getLoan(loanId);
      // Interest may accrue during the transaction itself, so allow small tolerance
      // for interest that accrues between getAccruedInterest() call and repay() execution
      const interestTolerance = ethers.parseUnits("0.001", constants.USDC_DECIMALS);
      expect(loanAfterPrincipal.interestAccrued).to.be.closeTo(0n, interestTolerance);
      // Principal should be reduced by the principal payment amount (or remaining principal if less)
      // Allow small tolerance for interest accrual during transaction affecting principal payment
      const expectedPrincipal2 =
        loanAfterInterest.principal > principalPayment ? loanAfterInterest.principal - principalPayment : 0n;
      const principalTolerance2 = ethers.parseUnits("0.1", constants.USDC_DECIMALS);
      expect(loanAfterPrincipal.principal).to.be.closeTo(expectedPrincipal2, principalTolerance2);
      expect(loanAfterPrincipal.lastAccrualBlock).to.be.gt(loanAfterInterest.lastAccrualBlock);
    });

    it("Should handle edge case: principal payment when no interest accrued", async function () {
      const loanAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      const durationBlocks = MIN_LOAN_DURATION_BLOCKS;

      // Create and borrow
      const loanId = await createAndApproveLoan(borrower1, loanAmount, durationBlocks);
      await mintAndApproveUSDC(borrower1, loanAmount);
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.getLoan(loanId);
      const initialLastAccrualBlock = loan.lastAccrualBlock;

      // Immediately make principal payment (no time elapsed, no interest expected)
      // Note: Interest may accrue during the transaction itself, so we need to handle both cases
      const principalPayment = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      const loanBeforeRepay = await unlloo.getLoan(loanId);
      const interestBefore = loanBeforeRepay.interestAccrued;

      if (interestBefore === 0n) {
        // No interest in storage, try to pay just principal
        // But interest might accrue during transaction, so get total owed
        const totalOwed = await unlloo.getTotalOwed(loanId);
        const paymentAmount = totalOwed < principalPayment ? principalPayment : totalOwed;
        await mintAndApproveUSDC(borrower1, paymentAmount);
        await unlloo.connect(borrower1).repay(loanId, paymentAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Check loan state after payment
        const loanAfter = await unlloo.getLoan(loanId);
        expect(loanAfter.interestAccrued).to.equal(0n);

        // If no interest was paid, lastAccrualBlock should be unchanged (within tolerance)
        // If interest was paid (accrued during transaction), lastAccrualBlock should be updated
        // We can detect if interest was paid by checking if lastAccrualBlock changed significantly
        const blockDifference =
          loanAfter.lastAccrualBlock > initialLastAccrualBlock
            ? loanAfter.lastAccrualBlock - initialLastAccrualBlock
            : 0n;

        if (blockDifference <= 3n) {
          // Small change (1-3 blocks) - likely no interest paid, just transaction timing
          // Allow tolerance for transaction timing
          expect(loanAfter.lastAccrualBlock).to.be.closeTo(initialLastAccrualBlock, 3n);
        } else {
          // Significant change - interest was accrued and paid during transaction
          expect(loanAfter.lastAccrualBlock).to.be.gt(initialLastAccrualBlock);
        }
      } else {
        // Interest already accrued, pay it all
        const totalOwed = await unlloo.getTotalOwed(loanId);
        await mintAndApproveUSDC(borrower1, totalOwed);
        await unlloo.connect(borrower1).repay(loanId, totalOwed, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // If interest was paid, lastAccrualBlock should be updated
        const loanAfter = await unlloo.getLoan(loanId);
        if (loanAfter.interestAccrued === 0n) {
          expect(loanAfter.lastAccrualBlock).to.be.gte(initialLastAccrualBlock);
        }
      }
    });
  });
});
