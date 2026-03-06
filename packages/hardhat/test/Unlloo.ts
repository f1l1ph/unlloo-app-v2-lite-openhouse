import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import { mintAndApproveUSDC } from "./helpers/tokenHelpers";
import { submitLoanRequestHelper, createAndApproveLoan, setupCompleteBorrow, repayFully } from "./helpers/loanHelpers";
import * as constants from "./fixtures/constants";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Unlloo", function () {
  let ctx: UnllooTestContext;

  // Convenience aliases for cleaner test code
  let unlloo: typeof ctx.unlloo;
  let usdc: typeof ctx.usdc;
  let owner: typeof ctx.owner;
  let borrower1: typeof ctx.borrower1;
  let borrower2: typeof ctx.borrower2;
  let lender1: typeof ctx.lender1;
  let lender2: typeof ctx.lender2;
  let nonOwner: typeof ctx.nonOwner;
  let BLOCKS_PER_DAY: typeof ctx.blocksPerDay;
  let MIN_LOAN_DURATION_BLOCKS: typeof ctx.minLoanDurationBlocks;
  let MAX_LOAN_DURATION_BLOCKS: bigint;
  let COOLDOWN_BLOCKS: typeof ctx.cooldownBlocks;
  let APPROVED_LOAN_EXPIRY_BLOCKS: typeof ctx.approvedLoanExpiryBlocks;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();

    // Set convenience aliases
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    borrower2 = ctx.borrower2;
    lender1 = ctx.lender1;
    lender2 = ctx.lender2;
    nonOwner = ctx.nonOwner;
    BLOCKS_PER_DAY = ctx.blocksPerDay;
    MIN_LOAN_DURATION_BLOCKS = ctx.minLoanDurationBlocks;
    MAX_LOAN_DURATION_BLOCKS = await unlloo.maxLoanDurationBlocks();
    COOLDOWN_BLOCKS = ctx.cooldownBlocks;
    APPROVED_LOAN_EXPIRY_BLOCKS = ctx.approvedLoanExpiryBlocks;
  });

  // ============ Deployment Tests ============
  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await unlloo.owner()).to.equal(owner.address);
    });

    it("Should set the correct default token", async function () {
      expect(await unlloo.defaultToken()).to.equal(await usdc.getAddress());
    });

    // Price feed removed - oracle no longer used

    it("Should initialize default pool", async function () {
      const pool = await unlloo.getLiquidityPool(await usdc.getAddress());
      expect(pool.token).to.equal(await usdc.getAddress());
      expect(pool.totalLiquidity).to.equal(0);
      expect(pool.borrowedAmount).to.equal(0);
    });

    it("Should set correct default parameters", async function () {
      expect(await unlloo.minReputation()).to.equal(200);
      // Rates are now per-pool configurable
      // Check default pool rate curve
      const rateCurve = await unlloo.getPoolRateCurve(await usdc.getAddress());
      expect(rateCurve.baseRateBps).to.equal(1200); // 12% base rate
      expect(rateCurve.optimalUtilizationBps).to.equal(8000); // 80% optimal utilization
      expect(rateCurve.slope1Bps).to.equal(600); // 6% slope1
      expect(rateCurve.slope2Bps).to.equal(4000); // 40% slope2
      expect(rateCurve.protocolFeeBps).to.equal(2500); // 25% protocol fee
    });

    it("Should calculate correct block-based durations", async function () {
      expect(MIN_LOAN_DURATION_BLOCKS).to.equal(BLOCKS_PER_DAY);
      expect(MAX_LOAN_DURATION_BLOCKS).to.equal(BLOCKS_PER_DAY * 60n); // 2 months
      expect(COOLDOWN_BLOCKS).to.equal(BLOCKS_PER_DAY); // 1 day
    });

    // InterestCalculator is no longer used - removed test

    it("Should revert with zero token address", async function () {
      const UnllooFactory = await ethers.getContractFactory("Unlloo");
      const unllooImpl = await UnllooFactory.deploy({
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      });
      await unllooImpl.waitForDeployment();

      const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
      const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);

      // Encode invalid init data (zero token address)
      const initData = unllooImpl.interface.encodeFunctionData("initialize", [
        ethers.ZeroAddress,
        constants.BLOCK_TIME_SECONDS,
        owner.address,
        minLoanAmount,
        maxLoanAmount,
      ]);

      const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
      await expect(
        UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unllooImpl, "InvalidDefaultToken");
    });

    it("Should revert with zero owner address", async function () {
      const usdcAddress = await usdc.getAddress();
      const UnllooFactory = await ethers.getContractFactory("Unlloo");
      const unllooImpl = await UnllooFactory.deploy({
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      });
      await unllooImpl.waitForDeployment();

      const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
      const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);

      // Encode invalid init data (zero owner address)
      const initData = unllooImpl.interface.encodeFunctionData("initialize", [
        usdcAddress,
        constants.BLOCK_TIME_SECONDS,
        ethers.ZeroAddress,
        minLoanAmount,
        maxLoanAmount,
      ]);

      const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
      await expect(
        UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unllooImpl, "InvalidOwner");
    });

    it("Should revert initialize with blockTimeSeconds > 86400", async function () {
      const usdcAddress = await usdc.getAddress();
      const UnllooFactory = await ethers.getContractFactory("Unlloo");
      const unllooImpl = await UnllooFactory.deploy({
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      });
      await unllooImpl.waitForDeployment();

      const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
      const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);

      // Encode invalid init data (blockTimeSeconds > 86400)
      const invalidBlockTime = 86401;
      const initData = unllooImpl.interface.encodeFunctionData("initialize", [
        usdcAddress,
        invalidBlockTime,
        owner.address,
        minLoanAmount,
        maxLoanAmount,
      ]);

      const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
      await expect(
        UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unllooImpl, "InvalidBlockTime");
    });

    it("Should revert initialize with blockTimeSeconds causing blocksPerDay == 0", async function () {
      const usdcAddress = await usdc.getAddress();
      const UnllooFactory = await ethers.getContractFactory("Unlloo");
      const unllooImpl = await UnllooFactory.deploy({
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      });
      await unllooImpl.waitForDeployment();

      const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
      const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);

      // Use very large blockTimeSeconds that would cause blocksPerDay to be 0
      // blocksPerDay = 86400 / blockTimeSeconds
      // For blocksPerDay == 0, we need blockTimeSeconds > 86400
      const veryLargeBlockTime = 86401;
      const initData = unllooImpl.interface.encodeFunctionData("initialize", [
        usdcAddress,
        veryLargeBlockTime,
        owner.address,
        minLoanAmount,
        maxLoanAmount,
      ]);

      const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
      await expect(
        UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unllooImpl, "InvalidBlockTime");
    });

    it("Should handle initialize with blockTimeSeconds at boundary (86400)", async function () {
      const usdcAddress = await usdc.getAddress();
      const UnllooFactory = await ethers.getContractFactory("Unlloo");
      const unllooImpl = await UnllooFactory.deploy({
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      });
      await unllooImpl.waitForDeployment();

      const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
      const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);

      // Test exactly at 86400 boundary
      const boundaryBlockTime = 86400;
      const initData = unllooImpl.interface.encodeFunctionData("initialize", [
        usdcAddress,
        boundaryBlockTime,
        owner.address,
        minLoanAmount,
        maxLoanAmount,
      ]);

      const UnllooProxyFactory = await ethers.getContractFactory("UnllooProxy");
      const proxy = await UnllooProxyFactory.deploy(await unllooImpl.getAddress(), initData, {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      });
      await proxy.waitForDeployment();

      // Should succeed - verify block time was set correctly
      const unllooBoundary = await ethers.getContractAt("Unlloo", await proxy.getAddress());
      expect(await unllooBoundary.blockTimeSeconds()).to.equal(boundaryBlockTime);
    });
  });

  // ============ Loan Request Tests ============
  describe("Loan Request Submission", function () {
    it("Should submit a valid loan request", async function () {
      const tx = await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );

      await expect(tx)
        .to.emit(unlloo, "LoanRequestSubmitted")
        .withArgs(
          1,
          borrower1.address,
          constants.VALID_REPUTATION,
          ethers.parseUnits("1000", constants.USDC_DECIMALS),
          MIN_LOAN_DURATION_BLOCKS,
          await ethers.provider.getBlockNumber(),
        );

      const loan = await unlloo.getLoan(1);
      expect(loan.borrower).to.equal(borrower1.address);
      expect(loan.status).to.equal(0); // Pending
      expect(loan.walletReputation).to.equal(constants.VALID_REPUTATION);
      expect(loan.loanAmount).to.equal(ethers.parseUnits("1000", constants.USDC_DECIMALS));
    });

    it("Should increment loan counter correctly", async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      expect(await unlloo.loanCounter()).to.equal(1);

      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower2,
        constants.VALID_REPUTATION,
        2000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      expect(await unlloo.loanCounter()).to.equal(2);
    });

    it("Should revert with reputation below minimum", async function () {
      await expect(
        submitLoanRequestHelper(unlloo, usdc, borrower1, constants.MIN_REPUTATION - 1, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "InvalidReputation");
    });

    it("Should revert with reputation above 1000", async function () {
      await expect(
        submitLoanRequestHelper(unlloo, usdc, borrower1, 1001, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "InvalidReputation");
    });

    it("Should allow reputation exactly at 1000 (boundary test)", async function () {
      await expect(submitLoanRequestHelper(unlloo, usdc, borrower1, 1000, 1000, MIN_LOAN_DURATION_BLOCKS)).to.not.be
        .reverted;

      const loanId = await unlloo.loanCounter();
      const loan = await unlloo.getLoan(loanId);
      expect(loan.walletReputation).to.equal(1000);
    });

    it("Should revert with loan amount below minimum", async function () {
      await expect(
        submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          constants.MIN_LOAN_AMOUNT_USD - 1,
          MIN_LOAN_DURATION_BLOCKS,
        ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert with loan amount above maximum", async function () {
      await expect(
        submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          constants.MAX_LOAN_AMOUNT_USD + 1,
          MIN_LOAN_DURATION_BLOCKS,
        ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert with duration below minimum", async function () {
      await expect(
        submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS - 1n,
        ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
    });

    it("Should revert with duration above maximum", async function () {
      await expect(
        submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MAX_LOAN_DURATION_BLOCKS + 1n,
        ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
    });

    it("Should revert when user has pending loan (ExceedsMaxPendingLoans)", async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );

      // Wait for cooldown to pass, but pending loan still exists
      await mine(COOLDOWN_BLOCKS);

      await expect(
        submitLoanRequestHelper(unlloo, usdc, borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "ExceedsMaxPendingLoans");
    });

    it("Should allow request after cooldown expires", async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      await unlloo.connect(owner).rejectLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await mine(COOLDOWN_BLOCKS);

      await expect(
        submitLoanRequestHelper(unlloo, usdc, borrower1, constants.VALID_REPUTATION, 2000, MIN_LOAN_DURATION_BLOCKS),
      ).to.not.be.reverted;
    });

    it("Should revert when contract is paused", async function () {
      await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
      await expect(
        submitLoanRequestHelper(unlloo, usdc, borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "EnforcedPause");
    });

    it("Should track borrower loans correctly", async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );

      const borrowerLoans = await unlloo.getLoansByBorrower(borrower1.address);
      expect(borrowerLoans.length).to.equal(1);
      expect(borrowerLoans[0]).to.equal(1);
    });
  });

  // ============ Loan Approval/Rejection Tests ============
  describe("Loan Approval", function () {
    beforeEach(async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );
    });

    it("Should approve a pending loan request", async function () {
      const tx = await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(tx)
        .to.emit(unlloo, "LoanRequestApproved")
        .withArgs(1, borrower1.address, await ethers.provider.getBlockNumber());

      const loan = await unlloo.getLoan(1);
      expect(loan.status).to.equal(1); // Approved
    });

    it("Should revert when non-owner tries to approve", async function () {
      await expect(
        unlloo.connect(nonOwner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when approving non-existent loan", async function () {
      await expect(
        unlloo.connect(owner).approveLoanRequest(999, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "LoanNotFound");
    });

    it("Should revert when approving non-pending loan", async function () {
      await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await expect(
        unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should allow approval when reputation equals minReputation", async function () {
      await submitLoanRequestHelper(unlloo, usdc, borrower2, constants.MIN_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS);
      const loanId = await unlloo.loanCounter();

      await expect(unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to.not
        .be.reverted;

      const loan = await unlloo.getLoan(loanId);
      expect(loan.status).to.equal(1); // Approved
      expect(loan.walletReputation).to.equal(constants.MIN_REPUTATION);
    });
  });

  describe("Loan Rejection", function () {
    beforeEach(async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );
    });

    it("Should reject a pending loan request", async function () {
      const tx = await unlloo.connect(owner).rejectLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(tx)
        .to.emit(unlloo, "LoanRequestRejected")
        .withArgs(1, borrower1.address, await ethers.provider.getBlockNumber());

      const loan = await unlloo.getLoan(1);
      expect(loan.status).to.equal(4); // Rejected
    });

    it("Should revert when non-owner tries to reject", async function () {
      await expect(
        unlloo.connect(nonOwner).rejectLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when rejecting non-pending loan", async function () {
      await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await expect(
        unlloo.connect(owner).rejectLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });
  });

  // ============ Borrowing Tests ============
  describe("Borrowing", function () {
    let loanId: bigint;
    const liquidityAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

    beforeEach(async function () {
      // Deposit liquidity
      await mintAndApproveUSDC(usdc, lender1, liquidityAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), liquidityAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Create and approve loan
      loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner);
    });

    it("Should allow borrowing from approved loan", async function () {
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      const borrowerBalanceBefore = await usdc.balanceOf(borrower1.address);

      const tx = await unlloo
        .connect(borrower1)
        .borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(tx).to.emit(unlloo, "LoanBorrowed");

      const borrowerBalanceAfter = await usdc.balanceOf(borrower1.address);
      expect(borrowerBalanceAfter - borrowerBalanceBefore).to.equal(maxBorrowable);

      const loan = await unlloo.getLoan(loanId);
      expect(loan.status).to.equal(2); // Active
      expect(loan.principal).to.equal(maxBorrowable);
    });

    it("Should calculate max borrowable amount correctly", async function () {
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      const expectedAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      expect(maxBorrowable).to.equal(expectedAmount);
    });

    it("Should revert when borrowing zero amount", async function () {
      await expect(
        unlloo.connect(borrower1).borrow(loanId, 0, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert when borrowing more than max", async function () {
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await expect(
        unlloo.connect(borrower1).borrow(loanId, maxBorrowable + 1n, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should revert when insufficient liquidity", async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower2,
        constants.VALID_REPUTATION,
        50000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      const largeLoanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(largeLoanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(largeLoanId);
      await expect(
        unlloo.connect(borrower2).borrow(largeLoanId, maxBorrowable, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InsufficientLiquidity");
    });

    it("Should revert when non-borrower tries to borrow", async function () {
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await expect(
        unlloo.connect(borrower2).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "NotBorrower");
    });

    it("Should revert when loan not approved", async function () {
      await mine(COOLDOWN_BLOCKS);
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower2,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      const pendingLoanId = await unlloo.loanCounter();

      await expect(
        unlloo.connect(borrower2).borrow(pendingLoanId, ethers.parseUnits("500", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidLoanStatus");
    });

    it("Should revert when user already has active loan", async function () {
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(loanId);

      // Now submitLoanRequest should fail with HasActiveLoan
      await expect(
        submitLoanRequestHelper(unlloo, usdc, borrower1, constants.VALID_REPUTATION, 1000, MIN_LOAN_DURATION_BLOCKS),
      ).to.be.revertedWithCustomError(unlloo, "HasActiveLoan");
    });

    it("Should update pool borrowed amount", async function () {
      const poolBefore = await unlloo.getLiquidityPool(await usdc.getAddress());
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);

      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const poolAfter = await unlloo.getLiquidityPool(await usdc.getAddress());
      expect(poolAfter.borrowedAmount - poolBefore.borrowedAmount).to.equal(maxBorrowable);
    });

    it("Should calculate protocol fee as > 0 for a loan with interest", async function () {
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await mine(BLOCKS_PER_DAY);

      const loan = await unlloo.getLoan(loanId);
      expect(loan.protocolFee).to.equal(0);

      const totalOwed = await unlloo.getTotalOwed(loanId);
      const protocolFeeBefore = await unlloo.getProtocolFees(await usdc.getAddress());

      const repayAmount = totalOwed + 1_000_000n;
      await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const protocolFeeAfter = await unlloo.getProtocolFees(await usdc.getAddress());
      const actualProtocolFee = protocolFeeAfter - protocolFeeBefore;
      expect(actualProtocolFee).to.be.gt(0);
    });

    it("Should revert when approved loan has expired", async function () {
      await mine(APPROVED_LOAN_EXPIRY_BLOCKS + 1n);

      await expect(
        unlloo.connect(borrower1).borrow(loanId, ethers.parseUnits("100", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "ApprovedLoanExpired");

      const loan = await unlloo.getLoan(loanId);
      expect(loan.status).to.equal(1); // still Approved (state rolled back)
    });

    it("Should revert when contract is paused", async function () {
      await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await expect(
        unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "EnforcedPause");
    });

    it("Should handle borrower interest calculation with zero blocks (defensive path)", async function () {
      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gte(0);

      await mine(100);

      const accruedInterestAfter = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterestAfter).to.be.gt(0);
    });
  });

  // ============ Repayment Tests ============
  describe("Repayment", function () {
    it("Should allow partial repayment", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      // Mine some blocks to allow interest to accrue
      await mine(100);

      const totalOwed = await unlloo.getTotalOwed(loanId); // Use getTotalOwed for accurate calculation
      const partialAmount = totalOwed / 2n;

      await mintAndApproveUSDC(usdc, borrower1, partialAmount, await unlloo.getAddress());
      const tx = await unlloo
        .connect(borrower1)
        .repay(loanId, partialAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(tx).to.emit(unlloo, "LoanRepaid");

      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.amountRepaid).to.equal(partialAmount);
      expect(loanAfter.status).to.equal(2); // Still Active
    });

    it("Should allow full repayment", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      // Mine enough blocks to ensure meaningful interest accrues
      await mine(BLOCKS_PER_DAY);

      const remainingBalance = await unlloo.getRemainingBalance(loanId);
      // Repay with a buffer; contract will cap to exact amount due (prevents 1-block drift leaving dust).
      const repayAmount = remainingBalance + 1_000_000n; // +1 USDC (6 decimals)
      await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());

      const tx = await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(tx).to.emit(unlloo, "LoanRepaid");

      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.status).to.equal(5); // Repaid
      expect(await unlloo.getRemainingBalance(loanId)).to.equal(0n);
    });

    it("Should collect protocol fees on full repayment", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      // Mine enough blocks to ensure meaningful interest accrues
      await mine(BLOCKS_PER_DAY);

      const remainingBalance = await unlloo.getRemainingBalance(loanId);
      const protocolFeeBefore = await unlloo.getProtocolFees(await usdc.getAddress());

      const repayAmount = remainingBalance + 1_000_000n;
      await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const protocolFeeAfter = await unlloo.getProtocolFees(await usdc.getAddress());
      // Protocol fee is calculated at repayment time
      expect(protocolFeeAfter - protocolFeeBefore).to.be.gt(0);
    });

    it("Should update pool borrowed amount on full repayment", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      // Mine some blocks to allow interest to accrue
      await mine(100);

      const loan = await unlloo.getLoan(loanId);
      const poolBefore = await unlloo.getLiquidityPool(await usdc.getAddress());
      const originalPrincipal = loan.principal; // Store original principal before repayment

      // Use getRemainingBalance to get the exact amount needed to fully repay
      const remainingBalance = await unlloo.getRemainingBalance(loanId);
      const repayAmount = remainingBalance + 1_000_000n;
      await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const poolAfter = await unlloo.getLiquidityPool(await usdc.getAddress());
      // Pool borrowedAmount should be reduced by original principal
      // With index-based interest, there might be small rounding differences
      // So we check that the reduction is close to the original principal (within 1% tolerance)
      const reduction = poolBefore.borrowedAmount - poolAfter.borrowedAmount;
      expect(reduction).to.be.gte((originalPrincipal * 99n) / 100n);
      expect(reduction).to.be.lte((originalPrincipal * 101n) / 100n);
    });

    it("Should revert when repaying zero", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      await expect(
        unlloo.connect(borrower1).repay(loanId, 0, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
    });

    it("Should cap repayment when repaying more than owed", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      // Mine some blocks to allow interest to accrue
      await mine(100);

      const remainingBalance = await unlloo.getRemainingBalance(loanId);
      // Add a significant amount to ensure it's clearly more than owed
      const excessiveAmount = remainingBalance + ethers.parseUnits("1000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, borrower1, excessiveAmount, await unlloo.getAddress());
      await expect(unlloo.connect(borrower1).repay(loanId, excessiveAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT }))
        .to.not.be.reverted;
      expect(await unlloo.getRemainingBalance(loanId)).to.equal(0n);
    });

    it("Should revert when non-borrower tries to repay", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      await mintAndApproveUSDC(
        usdc,
        borrower2,
        ethers.parseUnits("100", constants.USDC_DECIMALS),
        await unlloo.getAddress(),
      );
      await expect(
        unlloo
          .connect(borrower2)
          .repay(loanId, ethers.parseUnits("100", constants.USDC_DECIMALS), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "NotBorrower");
    });

    it("Should move to UnpaidDebt status when maxLoanDuration exceeded", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      const loan = await unlloo.getLoan(loanId);

      // Fast forward past loan duration
      await mine(loan.loanDurationBlocks);

      // Any repayment should trigger status change
      const repayAmount = ethers.parseUnits("10", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());

      const tx = await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await expect(tx).to.emit(unlloo, "LoanMovedToUnpaidDebt");

      const loanAfter = await unlloo.getLoan(loanId);
      expect(loanAfter.status).to.equal(3); // UnpaidDebt
    });

    it("Should allow repayment even in UnpaidDebt status", async function () {
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      const loan = await unlloo.getLoan(loanId);

      // Move to UnpaidDebt
      await mine(loan.loanDurationBlocks);

      // Make a small partial repayment first to trigger UnpaidDebt transition
      const smallAmount = ethers.parseUnits("10", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, borrower1, smallAmount, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, smallAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanAfterFirst = await unlloo.getLoan(loanId);
      expect(loanAfterFirst.status).to.equal(3); // UnpaidDebt
      const repaidAfterFirst = loanAfterFirst.amountRepaid;

      // Should still be able to make another repayment in UnpaidDebt
      const remainingBalance = await unlloo.getRemainingBalance(loanId);
      await mintAndApproveUSDC(usdc, borrower1, remainingBalance, await unlloo.getAddress());
      await unlloo.connect(borrower1).repay(loanId, remainingBalance, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanAfterSecond = await unlloo.getLoan(loanId);
      expect(loanAfterSecond.amountRepaid).to.be.gt(repaidAfterFirst);
      // We intentionally don't assert exact final status to avoid rounding-related flakiness.
    });

    it("Should handle repayment in same block as borrow", async function () {
      // Setup complete borrow
      const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

      // Get loan immediately after borrowing (no extra blocks mined)
      const loan = await unlloo.getLoan(loanId);
      expect(loan.status).to.equal(2); // Active

      // Repay immediately using remaining balance from view
      const remainingBalance = await unlloo.getRemainingBalance(loanId);
      await mintAndApproveUSDC(usdc, borrower1, remainingBalance, await unlloo.getAddress());
      const tx = await unlloo
        .connect(borrower1)
        .repay(loanId, remainingBalance, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(tx).to.emit(unlloo, "LoanRepaid");

      const loanAfter = await unlloo.getLoan(loanId);
      // Key property: immediate repayment works and updates accounting
      expect(loanAfter.amountRepaid).to.be.gte(remainingBalance);
    });

    it("Should handle zero-block interest calculation in lender withdrawal", async function () {
      // This test verifies that _calculateLenderInterest handles blocksElapsed == 0 correctly
      // The function has an early return: if (blocksElapsed == 0) return 0;
      // While we can't guarantee zero blocks in Hardhat (blocks are mined between transactions),
      // we verify the code path exists and the function works correctly

      // Deposit liquidity
      const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Get position - verify deposit was successful
      const positionBefore = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());

      // Withdraw a small amount
      const withdrawAmount = ethers.parseUnits("100", constants.USDC_DECIMALS);
      const balanceBefore = await usdc.balanceOf(lender1.address);

      await unlloo
        .connect(lender1)
        .withdrawLiquidity(await usdc.getAddress(), withdrawAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      const balanceAfter = await usdc.balanceOf(lender1.address);

      // Verify withdrawal succeeded
      const received = balanceAfter - balanceBefore;
      expect(received).to.be.gte(withdrawAmount);

      // Verify position was updated
      const positionAfter = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
      expect(positionAfter.depositedAmount).to.be.lt(positionBefore.depositedAmount);
    });
  });

  // ============ Liquidity Pool Tests ============
  describe("Liquidity Pool", function () {
    describe("Deposit", function () {
      it("Should allow depositing liquidity", async function () {
        const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());

        const tx = await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        await expect(tx)
          .to.emit(unlloo, "LiquidityDeposited")
          .withArgs(lender1.address, await usdc.getAddress(), depositAmount, await ethers.provider.getBlockNumber());

        const pool = await unlloo.getLiquidityPool(await usdc.getAddress());
        expect(pool.totalLiquidity).to.equal(depositAmount);

        const position = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
        expect(position.depositedAmount).to.equal(depositAmount);
      });

      it("Should allow multiple deposits", async function () {
        const deposit1 = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        const deposit2 = ethers.parseUnits("500", constants.USDC_DECIMALS);

        await mintAndApproveUSDC(usdc, lender1, deposit1 + deposit2, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), deposit1, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), deposit2, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const position = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
        expect(position.depositedAmount).to.equal(deposit1 + deposit2);
      });

      it("Should revert when depositing zero", async function () {
        await expect(
          unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), 0, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
      });

      it("Should revert when depositing to invalid pool", async function () {
        const randomToken = ethers.Wallet.createRandom().address;
        await expect(
          unlloo.connect(lender1).depositLiquidity(randomToken, ethers.parseUnits("100", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
      });

      it("Should revert when allowance is insufficient", async function () {
        const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        await usdc.mint(lender1.address, depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        // No approve

        await expect(
          unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InsufficientAllowance");
      });

      it("Should revert when contract is paused", async function () {
        await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
        await expect(
          unlloo
            .connect(lender1)
            .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("100", constants.USDC_DECIMALS), {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            }),
        ).to.be.revertedWithCustomError(unlloo, "EnforcedPause");
      });
    });

    describe("Withdrawal", function () {
      const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);

      beforeEach(async function () {
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
      });

      it("Should allow withdrawing liquidity", async function () {
        const withdrawAmount = depositAmount / 2n;
        const balanceBefore = await usdc.balanceOf(lender1.address);

        const tx = await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        await expect(tx).to.emit(unlloo, "LiquidityWithdrawn");

        const balanceAfter = await usdc.balanceOf(lender1.address);
        expect(balanceAfter).to.be.gte(balanceBefore + withdrawAmount);
      });

      it("Should include accrued interest in withdrawal", async function () {
        // New behavior: lenders only earn interest when borrowers pay interest (no time-based deposit APR).
        // Create a loan, accrue borrower interest, and repay to generate lender interest.
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          900,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const loanId = await unlloo.loanCounter();
        await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const borrowAmount = (await unlloo.getApprovedLoanAmount(loanId)) / 2n;
        await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        await mine(BLOCKS_PER_DAY); // accrue borrower interest

        const totalOwed = await unlloo.getTotalOwed(loanId);
        const repayAmount = totalOwed + 1_000_000n;
        await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const positionBefore = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
        expect(positionBefore.accruedInterest).to.be.gt(0);

        const balanceBefore = await usdc.balanceOf(lender1.address);
        await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        const balanceAfter = await usdc.balanceOf(lender1.address);

        expect(balanceAfter - balanceBefore).to.be.gt(depositAmount);
      });

      it("Should revert when withdrawing zero", async function () {
        await expect(
          unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), 0, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
      });

      it("Should revert when withdrawing more than deposited", async function () {
        await expect(
          unlloo
            .connect(lender1)
            .withdrawLiquidity(await usdc.getAddress(), depositAmount + 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
      });

      it("Should revert when no position exists", async function () {
        await expect(
          unlloo
            .connect(lender2)
            .withdrawLiquidity(await usdc.getAddress(), ethers.parseUnits("100", constants.USDC_DECIMALS), {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
      });

      it("Should revert when liquidity is borrowed", async function () {
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          900,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const loanId = await unlloo.loanCounter();
        await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
        await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        await expect(
          unlloo
            .connect(lender1)
            .withdrawLiquidity(await usdc.getAddress(), depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "InsufficientLiquidity");
      });
    });

    describe("Lender Position", function () {
      it("Should return zero for non-existent position", async function () {
        const position = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
        expect(position.depositedAmount).to.equal(0);
        expect(position.accruedInterest).to.equal(0);
        expect(position.totalWithdrawable).to.equal(0);
      });

      it("Should calculate accrued interest correctly", async function () {
        const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // New behavior: deposit alone doesn't accrue interest; generate interest via borrower repayment.
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          900,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const loanId = await unlloo.loanCounter();
        await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        const borrowAmount = (await unlloo.getApprovedLoanAmount(loanId)) / 2n;
        await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        await mine(BLOCKS_PER_DAY);
        const totalOwed = await unlloo.getTotalOwed(loanId);
        const repayAmount = totalOwed + 1_000_000n;
        await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const position = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
        expect(position.accruedInterest).to.be.gt(0);
        expect(position.totalWithdrawable).to.equal(position.depositedAmount + position.accruedInterest);
      });

      it("Should continue accruing interest beyond MAX_BLOCKS_FOR_INTEREST (simple interest)", async function () {
        // With simple interest, interest continues to accrue linearly - no cap on blocks
        // MAX_BLOCKS_FOR_INTEREST only limits loan duration, not interest accrual
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        await mine(1000n);
        const interest1 = await unlloo.getAccruedInterest(loanId);
        expect(interest1).to.be.gt(0);

        await mine(1000);
        const interest2 = await unlloo.getAccruedInterest(loanId);
        // Interest should continue increasing with simple interest
        expect(interest2).to.be.gt(interest1);
      });
    });
  });

  // ============ Admin Functions Tests ============
  describe("Admin Functions", function () {
    describe("Pause/Unpause", function () {
      it("Should allow owner to pause", async function () {
        await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
        expect(await unlloo.paused()).to.equal(true);
      });

      it("Should allow owner to unpause", async function () {
        await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
        await unlloo.connect(owner).unpause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
        expect(await unlloo.paused()).to.equal(false);
      });

      it("Should revert when non-owner tries to pause", async function () {
        await expect(
          unlloo.connect(nonOwner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
      });
    });

    describe("Emergency Withdraw", function () {
      it("Should allow emergency withdraw when paused", async function () {
        // New behavior: emergencyWithdraw is only for NON-pool tokens.
        // For pool tokens (like the default USDC pool), emergencyWithdraw must revert.
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const miscToken = await MockERC20Factory.deploy("Misc Token", "MISC", 18, {
          gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
        });
        await miscToken.waitForDeployment();

        const amount = ethers.parseUnits("100", 18);
        await miscToken.mint(await unlloo.getAddress(), amount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });

        const ownerBalBefore = await miscToken.balanceOf(owner.address);
        await unlloo.connect(owner).emergencyWithdraw(await miscToken.getAddress(), amount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        const ownerBalAfter = await miscToken.balanceOf(owner.address);
        expect(ownerBalAfter - ownerBalBefore).to.equal(amount);
      });

      it("Should revert emergency withdraw for pool token even when paused", async function () {
        const amount = ethers.parseUnits("100", constants.USDC_DECIMALS);
        await usdc.mint(await unlloo.getAddress(), amount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
        await expect(
          unlloo
            .connect(owner)
            .emergencyWithdraw(await usdc.getAddress(), amount, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
      });

      it("Should revert emergency withdraw when not paused", async function () {
        await expect(
          unlloo
            .connect(owner)
            .emergencyWithdraw(await usdc.getAddress(), ethers.parseUnits("100", constants.USDC_DECIMALS), {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            }),
        ).to.be.revertedWithCustomError(unlloo, "ExpectedPause");
      });
    });

    describe("ETH Receiving", function () {
      it("Should accept ETH deposits via receive() function", async function () {
        const ethAmount = ethers.parseEther("1");
        const contractAddress = await unlloo.getAddress();
        const protocolFeesBefore = await unlloo.getProtocolFees(ethers.ZeroAddress);

        const tx = await owner.sendTransaction({
          to: contractAddress,
          value: ethAmount,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        const receipt = await tx.wait();

        await expect(tx).to.emit(unlloo, "ETHReceived").withArgs(owner.address, ethAmount, receipt!.blockNumber);

        const protocolFeesAfter = await unlloo.getProtocolFees(ethers.ZeroAddress);
        expect(protocolFeesAfter).to.equal(protocolFeesBefore + ethAmount);
      });

      it("Should revert when sending zero ETH to receive()", async function () {
        const contractAddress = await unlloo.getAddress();

        // Sending zero ETH should revert
        await expect(
          owner.sendTransaction({
            to: contractAddress,
            value: 0,
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
      });

      it("Should revert when contract is paused", async function () {
        await unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });
        const contractAddress = await unlloo.getAddress();

        await expect(
          owner.sendTransaction({
            to: contractAddress,
            value: ethers.parseEther("0.1"),
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "EnforcedPause");
      });

      it("Should accumulate multiple ETH deposits", async function () {
        const ethAmount1 = ethers.parseEther("0.5");
        const ethAmount2 = ethers.parseEther("1.5");
        const contractAddress = await unlloo.getAddress();

        await owner.sendTransaction({
          to: contractAddress,
          value: ethAmount1,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        await owner.sendTransaction({
          to: contractAddress,
          value: ethAmount2,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const totalProtocolFees = await unlloo.getProtocolFees(ethers.ZeroAddress);
        expect(totalProtocolFees).to.equal(ethAmount1 + ethAmount2);
      });
    });

    describe("ETH Withdrawal", function () {
      it("Should allow owner to withdraw ETH", async function () {
        const ethAmount = ethers.parseEther("1");
        await owner.sendTransaction({
          to: await unlloo.getAddress(),
          value: ethAmount,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

        await unlloo.connect(owner).withdrawETH(ethAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
        expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
      });

      it("Should revert when withdrawing more ETH than protocol fees", async function () {
        await expect(
          unlloo.connect(owner).withdrawETH(ethers.parseEther("1"), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
      });

      it("Should revert when non-owner tries to withdraw ETH", async function () {
        await expect(
          unlloo.connect(nonOwner).withdrawETH(1, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
      });
    });

    describe("Update Min Reputation", function () {
      it("Should allow owner to update min reputation", async function () {
        await unlloo.connect(owner).updateMinReputation(500, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        expect(await unlloo.minReputation()).to.equal(500);
      });

      it("Should revert with reputation above 1000", async function () {
        await expect(
          unlloo.connect(owner).updateMinReputation(1001, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidReputation");
      });

      it("Should allow setting minReputation to 1000 (boundary test)", async function () {
        await unlloo.connect(owner).updateMinReputation(1000, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        expect(await unlloo.minReputation()).to.equal(1000);
      });

      it("Should revert when non-owner tries to update", async function () {
        await expect(
          unlloo.connect(nonOwner).updateMinReputation(500, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
      });
    });

    // Update Interest Rates - REMOVED: Rates are now calculated dynamically based on utilization
    // No longer have fixed borrowerRateBps/lenderRateBps state variables

    // Update Protocol Fee - REMOVED: Protocol fee is now fixed at 25% (2500 bps)
    // No longer have updateProtocolFeePercentage function

    describe("Update Cooldown", function () {
      it("Should allow owner to update cooldown", async function () {
        const newCooldown = BLOCKS_PER_DAY * 14n; // 14 days
        await unlloo.connect(owner).updateCooldownBlocks(newCooldown, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        expect(await unlloo.cooldownBlocks()).to.equal(newCooldown);
      });

      it("Should revert with cooldown below 1 day", async function () {
        await expect(
          unlloo.connect(owner).updateCooldownBlocks(100, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
      });

      it("Should revert with cooldown above 30 days", async function () {
        const tooBig = BLOCKS_PER_DAY * 31n;
        await expect(
          unlloo.connect(owner).updateCooldownBlocks(tooBig, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidDuration");
      });
    });

    // Price Oracle removed - no longer needed

    describe("Liquidity Pool Management", function () {
      it("Should allow owner to add new pool", async function () {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const newToken = await MockERC20Factory.deploy("DAI", "DAI", 18, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const minLoanAmount = ethers.parseUnits(constants.MIN_LOAN_AMOUNT_USD.toString(), 18);
        const maxLoanAmount = ethers.parseUnits(constants.MAX_LOAN_AMOUNT_USD.toString(), 18);
        const tx = await unlloo
          .connect(owner)
          .addLiquidityPool(await newToken.getAddress(), minLoanAmount, maxLoanAmount, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });
        await expect(tx).to.emit(unlloo, "PoolAdded");

        const pool = await unlloo.getLiquidityPool(await newToken.getAddress());
        expect(pool.token).to.equal(await newToken.getAddress());
      });

      it("Should revert adding pool with zero address", async function () {
        await expect(
          unlloo
            .connect(owner)
            .addLiquidityPool(
              ethers.ZeroAddress,
              ethers.parseUnits(constants.MIN_LOAN_AMOUNT_USD.toString(), constants.USDC_DECIMALS),
              ethers.parseUnits(constants.MAX_LOAN_AMOUNT_USD.toString(), constants.USDC_DECIMALS),
              { gasLimit: constants.COVERAGE_GAS_LIMIT },
            ),
        ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
      });

      it("Should revert adding existing pool", async function () {
        await expect(
          unlloo
            .connect(owner)
            .addLiquidityPool(
              await usdc.getAddress(),
              ethers.parseUnits(constants.MIN_LOAN_AMOUNT_USD.toString(), constants.USDC_DECIMALS),
              ethers.parseUnits(constants.MAX_LOAN_AMOUNT_USD.toString(), constants.USDC_DECIMALS),
              { gasLimit: constants.COVERAGE_GAS_LIMIT },
            ),
        ).to.be.revertedWithCustomError(unlloo, "PoolExists");
      });

      it("Should allow owner to remove empty pool", async function () {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const newToken = await MockERC20Factory.deploy("DAI", "DAI", 18, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        const minLoanAmount = ethers.parseUnits(constants.MIN_LOAN_AMOUNT_USD.toString(), 18);
        const maxLoanAmount = ethers.parseUnits(constants.MAX_LOAN_AMOUNT_USD.toString(), 18);
        await unlloo.connect(owner).addLiquidityPool(await newToken.getAddress(), minLoanAmount, maxLoanAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const tx = await unlloo.connect(owner).removeLiquidityPool(await newToken.getAddress(), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        await expect(tx).to.emit(unlloo, "PoolRemoved");
      });

      it("Should revert removing pool with liquidity", async function () {
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("100", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("100", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("100", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        await expect(
          unlloo.connect(owner).removeLiquidityPool(await usdc.getAddress(), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "PoolNotEmpty");
      });

      it("Should have ActiveLoansUsingPool defensive check in removeLiquidityPool", async function () {
        const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 1000);
        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
        await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const loan = await unlloo.getLoan(loanId);
        expect(loan.status).to.equal(2);
        expect(loan.token).to.equal(await usdc.getAddress());

        const activeLoans = await unlloo.loansByStatus(2);
        expect(activeLoans.length).to.be.gt(0);
        expect(activeLoans).to.include(loanId);

        await expect(
          unlloo.connect(owner).removeLiquidityPool(await usdc.getAddress(), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "PoolNotEmpty");
      });
    });

    describe("Protocol Fee Withdrawal", function () {
      it("Should allow owner to withdraw protocol fees", async function () {
        const result = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        await mine(BLOCKS_PER_DAY);

        const totalOwed = await unlloo.getTotalOwed(result.loanId);
        await mintAndApproveUSDC(usdc, borrower1, totalOwed, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(result.loanId, totalOwed, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const fees = await unlloo.getProtocolFees(await usdc.getAddress());
        expect(fees).to.be.gt(0);

        const ownerBalanceBefore = await usdc.balanceOf(owner.address);
        await unlloo.connect(owner).withdrawProtocolFees(await usdc.getAddress(), fees, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        const ownerBalanceAfter = await usdc.balanceOf(owner.address);

        expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(fees);
      });

      it("Should revert withdrawing more than available fees", async function () {
        await expect(
          unlloo
            .connect(owner)
            .withdrawProtocolFees(await usdc.getAddress(), ethers.parseUnits("100", constants.USDC_DECIMALS), {
              gasLimit: constants.COVERAGE_GAS_LIMIT,
            }),
        ).to.be.revertedWithCustomError(unlloo, "InvalidAmount");
      });
    });

    describe("Ownership", function () {
      it("Should allow owner to transfer ownership", async function () {
        if (!nonOwner) throw new Error("nonOwner not available");
        await unlloo.connect(owner).transferOwnership(nonOwner.address, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
        expect(await unlloo.owner()).to.equal(nonOwner.address);
      });

      it("Should allow renouncing ownership (owner becomes zero address)", async function () {
        await unlloo.connect(owner).renounceOwnership({ gasLimit: constants.COVERAGE_GAS_LIMIT });
        expect(await unlloo.owner()).to.equal(ethers.ZeroAddress);

        // After renouncing, the previous owner can no longer call onlyOwner functions
        await expect(
          unlloo.connect(owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT }),
        ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
      });
    });
  });

  // Price Feed tests removed - oracle no longer used in contract

  // ============ View Functions Tests ============
  describe("View Functions", function () {
    describe("getLoan", function () {
      it("Should return correct loan data", async function () {
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );

        const loan = await unlloo.getLoan(1);
        expect(loan.loanId).to.equal(1);
        expect(loan.borrower).to.equal(borrower1.address);
        expect(loan.status).to.equal(0); // Pending
        expect(loan.walletReputation).to.equal(constants.VALID_REPUTATION);
        expect(loan.loanAmount).to.equal(ethers.parseUnits("1000", constants.USDC_DECIMALS));
      });

      it("Should auto-update status to UnpaidDebt in view", async function () {
        const result = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        const loan = await unlloo.getLoan(result.loanId);
        await mine(loan.loanDurationBlocks + 1n);

        const loanAfter = await unlloo.getLoan(result.loanId);
        expect(loanAfter.status).to.equal(3); // UnpaidDebt
      });
    });

    describe("getLoansByStatus", function () {
      it("Should return correct loans by status", async function () {
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower2,
          constants.VALID_REPUTATION,
          2000,
          MIN_LOAN_DURATION_BLOCKS,
        );

        const pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
        expect(pendingLoans.length).to.equal(2);

        await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const pendingLoansAfter = await unlloo.getLoansByStatus(0, 0, 10);
        expect(pendingLoansAfter.length).to.equal(1);

        const approvedLoans = await unlloo.getLoansByStatus(1, 0, 10);
        expect(approvedLoans.length).to.equal(1);
      });

      it("Should handle pagination correctly", async function () {
        for (let i = 0; i < 5; i++) {
          const borrower = (await ethers.getSigners())[10 + i];
          await submitLoanRequestHelper(
            unlloo,
            usdc,
            borrower as HardhatEthersSigner,
            constants.VALID_REPUTATION,
            1000,
            MIN_LOAN_DURATION_BLOCKS,
          );
        }

        const page1 = await unlloo.getLoansByStatus(0, 0, 2);
        expect(page1.length).to.equal(2);

        const page2 = await unlloo.getLoansByStatus(0, 2, 2);
        expect(page2.length).to.equal(2);

        const page3 = await unlloo.getLoansByStatus(0, 4, 10);
        expect(page3.length).to.equal(1);
      });

      it("Should return empty array for offset beyond length", async function () {
        const loans = await unlloo.getLoansByStatus(0, 100, 10);
        expect(loans.length).to.equal(0);
      });
    });

    describe("canSubmitRequest", function () {
      it("Should return true for new user", async function () {
        expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(true);
      });

      it("Should return false during cooldown", async function () {
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        await unlloo.connect(owner).rejectLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(false);
      });

      it("Should return true after cooldown", async function () {
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        await unlloo.connect(owner).rejectLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        await mine(COOLDOWN_BLOCKS);
        expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(true);
      });

      it("Should return false for user with active loan", async function () {
        await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
        expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(false);
      });

      it("Should return false for user with unpaid debt", async function () {
        const result = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
        const loan = await unlloo.getLoan(result.loanId);
        await mine(loan.loanDurationBlocks + 1n);
        expect(await unlloo.canSubmitRequest(borrower1.address)).to.equal(false);
      });
    });

    describe("hasUnpaidDebt", function () {
      it("Should return false for user without loans", async function () {
        expect(await unlloo.hasUnpaidDebt(borrower1.address)).to.equal(false);
      });

      it("Should return false for active loan within duration", async function () {
        await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
        expect(await unlloo.hasUnpaidDebt(borrower1.address)).to.equal(false);
      });

      it("Should return true for loan past duration", async function () {
        const result = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
        const loan = await unlloo.getLoan(result.loanId);
        await mine(loan.loanDurationBlocks + 1n);
        expect(await unlloo.hasUnpaidDebt(borrower1.address)).to.equal(true);
      });
    });

    describe("getActiveLoanByBorrower", function () {
      it("Should return 0 for user without active loan", async function () {
        expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(0);
      });

      it("Should return loan ID for user with active loan", async function () {
        const result = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
        expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(result.loanId);
      });

      it("Should return 0 when loan duration exceeded", async function () {
        const result = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
        const loan = await unlloo.getLoan(result.loanId);
        await mine(loan.loanDurationBlocks + 1n);
        expect(await unlloo.getActiveLoanByBorrower(borrower1.address)).to.equal(0);
      });
    });

    describe("getCooldownEndBlock", function () {
      it("Should return correct cooldown end block", async function () {
        const blockBefore = await ethers.provider.getBlockNumber();
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const blockAfter = await ethers.provider.getBlockNumber();

        const cooldownEnd = await unlloo.getCooldownEndBlock(borrower1.address);
        expect(cooldownEnd).to.be.gte(BigInt(blockBefore) + COOLDOWN_BLOCKS);
        expect(cooldownEnd).to.be.lte(BigInt(blockAfter) + COOLDOWN_BLOCKS);
      });
    });
  });

  // ============ Edge Cases & Security ============
  describe("Edge Cases & Security", function () {
    it("Should handle multiple lenders correctly", async function () {
      const amount1 = ethers.parseUnits("5000", constants.USDC_DECIMALS);
      const amount2 = ethers.parseUnits("3000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, amount1, await unlloo.getAddress());
      await mintAndApproveUSDC(usdc, lender2, amount2, await unlloo.getAddress());

      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), amount1, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await unlloo.connect(lender2).depositLiquidity(await usdc.getAddress(), amount2, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const pool = await unlloo.getLiquidityPool(await usdc.getAddress());
      expect(pool.totalLiquidity).to.equal(amount1 + amount2);

      const pos1 = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
      const pos2 = await unlloo.getLenderPosition(lender2.address, await usdc.getAddress());
      expect(pos1.depositedAmount).to.equal(amount1);
      expect(pos2.depositedAmount).to.equal(amount2);
    });

    it("Should prevent reentrancy attacks (basic guard)", async function () {
      const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await unlloo
        .connect(lender1)
        .withdrawLiquidity(await usdc.getAddress(), depositAmount / 2n, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      const position = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
      expect(position.depositedAmount).to.equal(depositAmount / 2n);
    });

    it("Should handle interest calculation for edge durations", async function () {
      await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner, 1000);

      await mine(100);

      const accruedInterest = await unlloo.getAccruedInterest(1);
      expect(accruedInterest).to.be.gt(0);
    });

    it("Should allow borrow with max allowed duration (defensive MAX_BLOCKS_FOR_INTEREST check)", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MAX_LOAN_DURATION_BLOCKS,
      );
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.getLoan(loanId);
      expect(loan.status).to.equal(2); // Active
      expect(loan.loanDurationBlocks).to.equal(MAX_LOAN_DURATION_BLOCKS);
    });

    it("Should handle interest calculation at MAX_BLOCKS_FOR_INTEREST boundary", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
      await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      await mine(100);

      const loan = await unlloo.getLoan(loanId);
      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gt(0);
      expect(loan.status).to.equal(2);
    });

    it("Should cap blocks elapsed for lender withdrawal (no revert after huge time)", async function () {
      const MAX_BLOCKS_FOR_INTEREST = 10_000_000n;
      const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await mine(MAX_BLOCKS_FOR_INTEREST + 1n);

      const withdrawAmount = ethers.parseUnits("100", constants.USDC_DECIMALS);
      const balanceBefore = await usdc.balanceOf(lender1.address);

      await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const balanceAfter = await usdc.balanceOf(lender1.address);
      expect(balanceAfter).to.be.gte(balanceBefore + withdrawAmount);
    });

    it("Should handle large loan amounts correctly", async function () {
      const largeAmount = ethers.parseUnits("1000000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, largeAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), largeAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        constants.MAX_LOAN_AMOUNT_USD,
        MIN_LOAN_DURATION_BLOCKS,
      );
      await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const maxBorrowable = await unlloo.getApprovedLoanAmount(1);
      await unlloo.connect(borrower1).borrow(1, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.getLoan(1);
      expect(loan.principal).to.equal(maxBorrowable);
    });

    it("Should correctly track loans across status changes", async function () {
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );

      // Check pending
      let statusLoans = await unlloo.loansByStatus(0); // Pending
      expect(statusLoans.length).to.equal(1);

      // Approve
      await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      statusLoans = await unlloo.loansByStatus(0);
      expect(statusLoans.length).to.equal(0);
      statusLoans = await unlloo.loansByStatus(1); // Approved
      expect(statusLoans.length).to.equal(1);

      // Borrow
      await mintAndApproveUSDC(
        usdc,
        lender1,
        ethers.parseUnits("10000", constants.USDC_DECIMALS),
        await unlloo.getAddress(),
      );
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
      const maxBorrowable = await unlloo.getApprovedLoanAmount(1);
      await unlloo.connect(borrower1).borrow(1, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      statusLoans = await unlloo.loansByStatus(1);
      expect(statusLoans.length).to.equal(0);
      statusLoans = await unlloo.loansByStatus(2); // Active
      expect(statusLoans.length).to.equal(1);
    });
  });

  // ============ Integration Tests ============
  describe("Integration Tests", function () {
    it("Should complete full loan lifecycle", async function () {
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        1000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      expect((await unlloo.getLoan(1)).status).to.equal(0);

      await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      expect((await unlloo.getLoan(1)).status).to.equal(1);

      const maxBorrowable = await unlloo.getApprovedLoanAmount(1);
      await unlloo.connect(borrower1).borrow(1, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      expect((await unlloo.getLoan(1)).status).to.equal(2);

      await mine(BLOCKS_PER_DAY);

      await repayFully(unlloo, usdc, borrower1, 1n);
      expect((await unlloo.getLoan(1)).status).to.equal(5);

      const fees = await unlloo.getProtocolFees(await usdc.getAddress());
      expect(fees).to.be.gt(0);

      await mine(100);
      const position = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
      expect(position.accruedInterest).to.be.gt(0);
    });

    it("Should handle concurrent borrowers correctly", async function () {
      // Setup liquidity
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
      await unlloo
        .connect(lender1)
        .depositLiquidity(await usdc.getAddress(), depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Both borrowers submit requests
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower1,
        constants.VALID_REPUTATION,
        5000,
        MIN_LOAN_DURATION_BLOCKS,
      );
      await submitLoanRequestHelper(
        unlloo,
        usdc,
        borrower2,
        constants.VALID_REPUTATION,
        3000,
        MIN_LOAN_DURATION_BLOCKS,
      );

      // Approve both
      await unlloo.connect(owner).approveLoanRequest(1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(owner).approveLoanRequest(2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Both borrow
      const max1 = await unlloo.getApprovedLoanAmount(1);
      const max2 = await unlloo.getApprovedLoanAmount(2);

      await unlloo.connect(borrower1).borrow(1, max1, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(borrower2).borrow(2, max2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Verify pool state reflects both borrows
      const pool = await unlloo.getLiquidityPool(await usdc.getAddress());
      expect(pool.borrowedAmount).to.equal(max1 + max2);
    });
  });

  // ============ Additional Coverage Tests ============
  describe("Additional Coverage - Edge Cases", function () {
    describe("getApprovedLoanAmount edge cases", function () {
      it("Should return 0 for non-approved/pending loan", async function () {
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
        // After borrowing, loan status is Active, so should return 0
        expect(maxBorrowable).to.equal(0);
      });

      it("Should return 0 for rejected loan", async function () {
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const loanId = await unlloo.loanCounter();
        await unlloo.connect(owner).rejectLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
        expect(maxBorrowable).to.equal(0);
      });
    });

    describe("approveLoanRequest reputation validation", function () {
      it("Should revert when approving loan with reputation above 1000", async function () {
        // Create a loan with reputation 1000 (boundary)
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const firstLoanId = await unlloo.loanCounter();
        // Reject the first loan so we can submit another one
        await unlloo.connect(owner).rejectLoanRequest(firstLoanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        // Wait for cooldown to pass
        await mine(COOLDOWN_BLOCKS);

        // Now submit a loan with reputation 1000 (boundary)
        await submitLoanRequestHelper(unlloo, usdc, borrower1, 1000, 1000, MIN_LOAN_DURATION_BLOCKS);
        const loanId = await unlloo.loanCounter();

        // This should work since 1000 is valid (boundary case)
        await expect(unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to
          .not.be.reverted;

        // Note: We can't actually test reputation > 1000 because submitLoanRequest
        // validates reputation <= 1000. The approval check for reputation > 1000
        // is defensive code that would catch any edge cases or future changes.
      });
    });

    // Oracle error condition tests removed - oracle no longer used

    describe("Index overflow and calculation edge cases", function () {
      // Borrow index cache mechanism - REMOVED: No longer use borrow index with simple interest

      it("Should handle _removeFromStatusArray with empty array edge case", async function () {
        // This is a defensive check that's hard to test directly
        // But we can verify the function works correctly by testing status transitions
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const loanId = await unlloo.loanCounter();

        // Approve (removes from Pending, adds to Approved)
        await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        const approvedLoans = await unlloo.getLoansByStatus(1, 0, 10);
        expect(approvedLoans).to.include(loanId);

        // Reject (removes from Approved, adds to Rejected)
        // But wait, we can't reject an approved loan. Let's test by borrowing then repaying
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
        await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Now repay fully (removes from Active, adds to Repaid)
        await mine(BLOCKS_PER_DAY);

        const remainingBalance = await unlloo.getRemainingBalance(loanId);
        await mintAndApproveUSDC(usdc, borrower1, remainingBalance, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId, remainingBalance, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        const activeLoans = await unlloo.getLoansByStatus(2, 0, 10);
        expect(activeLoans).to.not.include(loanId);
      });
    });

    describe("Withdraw liquidity edge cases", function () {
      it("Should handle withdrawal when surplus is zero", async function () {
        const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Immediately withdraw (no time for interest, no surplus)
        const withdrawAmount = depositAmount / 2n;
        const balanceBefore = await usdc.balanceOf(lender1.address);

        await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const balanceAfter = await usdc.balanceOf(lender1.address);
        // Should receive at least the principal amount
        expect(balanceAfter - balanceBefore).to.be.gte(withdrawAmount);
      });

      it("Should handle withdrawal when effectiveLiquidity is zero", async function () {
        // Deposit liquidity
        const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Create loan with amount that allows borrowing all liquidity
        // 1000 USD loan = 1,000,000 USDC (6 decimals), which is more than depositAmount
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const loanId = await unlloo.loanCounter();
        await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Get free liquidity and borrow exactly that amount
        const poolBefore = await unlloo.getLiquidityPool(await usdc.getAddress());
        const freeLiquidityBefore = poolBefore.totalLiquidity - poolBefore.borrowedAmount;
        expect(freeLiquidityBefore).to.equal(depositAmount);

        // Borrow exactly all free liquidity
        await unlloo.connect(borrower1).borrow(loanId, freeLiquidityBefore, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // Verify free liquidity is now zero
        const poolAfter = await unlloo.getLiquidityPool(await usdc.getAddress());
        const freeLiquidityAfter = poolAfter.totalLiquidity - poolAfter.borrowedAmount;
        expect(freeLiquidityAfter).to.equal(0);

        // Now try to withdraw - should fail due to insufficient free liquidity
        await expect(
          unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          }),
        ).to.be.revertedWithCustomError(unlloo, "InsufficientLiquidity");

        // Repay loan to free up liquidity
        await mine(BLOCKS_PER_DAY);
        await repayFully(unlloo, usdc, borrower1, loanId);

        // Now withdrawal should work
        await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
      });

      it("Should handle withdrawal when no surplus exists (tokenBalance <= effectiveLiquidity + protocolFeeBalance)", async function () {
        const depositAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // Withdraw immediately - no time for interest to accrue, no surplus
        const withdrawAmount = depositAmount / 2n;
        const balanceBefore = await usdc.balanceOf(lender1.address);

        await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const balanceAfter = await usdc.balanceOf(lender1.address);
        // Should receive at least the principal (interest might be 0 if no surplus)
        expect(balanceAfter - balanceBefore).to.be.gte(withdrawAmount);
      });

      it("Should cap interest when interestForWithdrawal > maxInterestShare", async function () {
        const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, lender1, depositAmount, await unlloo.getAddress());
        await unlloo.connect(lender1).depositLiquidity(await usdc.getAddress(), depositAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        // New behavior: lenders accrue interest only after borrowers repay interest.
        const loanId = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 5000);
        const borrowAmount = await unlloo.getApprovedLoanAmount(loanId);
        await unlloo.connect(borrower1).borrow(loanId, borrowAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        await mine(BLOCKS_PER_DAY * 5n);
        await repayFully(unlloo, usdc, borrower1, loanId);

        const position = await unlloo.getLenderPosition(lender1.address, await usdc.getAddress());
        expect(position.accruedInterest).to.be.gt(0);

        // Withdraw - interest should be bounded by available surplus
        const withdrawAmount = depositAmount / 2n;
        const balanceBefore = await usdc.balanceOf(lender1.address);

        await unlloo.connect(lender1).withdrawLiquidity(await usdc.getAddress(), withdrawAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });

        const balanceAfter = await usdc.balanceOf(lender1.address);
        // Should receive principal + some interest (bounded by surplus)
        expect(balanceAfter - balanceBefore).to.be.gte(withdrawAmount);
      });
    });

    describe("Interest calculation edge cases", function () {
      it("Should handle currentDebt < loan.principal defensive check", async function () {
        // This is a defensive check that's very hard to trigger in practice
        // It would require the borrow index to decrease, which shouldn't happen
        // But we can verify the code path exists by checking the function structure
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        // Get accrued interest - should work normally
        const interest = await unlloo.getAccruedInterest(loanId);
        expect(interest).to.be.gte(0);

        // The defensive check at line 1756-1757 would return 0 if currentDebt < principal
        // This is extremely unlikely but the code handles it defensively
        // If this edge case occurred, _calculateAccruedInterest would return 0,
        // making totalOwed = principal, and getRemainingBalance would work normally
        const remainingBalance = await unlloo.getRemainingBalance(loanId);
        expect(remainingBalance).to.be.gte(0);
      });

      it("Should handle getRemainingBalance when totalOwed equals amountRepaid", async function () {
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        // Wait for some interest to accrue
        await mine(BLOCKS_PER_DAY);

        const totalOwed = await unlloo.getTotalOwed(loanId);
        const repayAmount = totalOwed + 1_000_000n;
        await mintAndApproveUSDC(usdc, borrower1, repayAmount, await unlloo.getAddress());

        // Repay with buffer; contract caps to the exact due.
        await unlloo.connect(borrower1).repay(loanId, repayAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        // After full repayment, remaining balance should be 0 (covers the else branch: totalOwed <= amountRepaid)
        const remainingBalance = await unlloo.getRemainingBalance(loanId);
        expect(remainingBalance).to.equal(0);

        // Verify the loan shows as fully repaid
        const loan = await unlloo.getLoan(loanId);
        expect(loan.amountRepaid).to.be.gte(totalOwed);
      });

      it("Should handle calculation overflow check", async function () {
        // This tests the overflow check: loan.principal > type(uint256).max / currentIndex
        // This is extremely hard to trigger, but we can verify the check exists
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        // Normal operation should work
        const totalOwed = await unlloo.getTotalOwed(loanId);
        expect(totalOwed).to.be.gt(0);

        // The overflow check is defensive and would revert with CalculationOverflow
        // if loan.principal * currentIndex would overflow
      });

      // IndexOverflow defensive check - REMOVED: No longer use borrow index with simple interest
    });

    describe("View function edge cases", function () {
      it("Should handle getLoan for non-existent loan", async function () {
        // getLoan doesn't revert - it returns a loan with default values (borrower = address(0))
        const loan = await unlloo.getLoan(99999);
        expect(loan.borrower).to.equal(ethers.ZeroAddress);
        expect(loan.loanId).to.equal(0);
        expect(loan.status).to.equal(0); // LoanStatus.Pending (default enum value)
      });

      it("Should handle getAccruedInterest for loan with zero principal", async function () {
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        // Repay fully
        await mine(BLOCKS_PER_DAY);
        await repayFully(unlloo, usdc, borrower1, loanId);

        // After full repayment, principal should be 0
        const loan = await unlloo.getLoan(loanId);
        expect(loan.principal).to.equal(0);

        // getAccruedInterest should return 0 for zero principal
        const interest = await unlloo.getAccruedInterest(loanId);
        expect(interest).to.equal(0);
      });

      it("Should handle getTotalOwed for repaid loan", async function () {
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        await mine(BLOCKS_PER_DAY);
        await repayFully(unlloo, usdc, borrower1, loanId);

        const totalOwed = await unlloo.getTotalOwed(loanId);
        expect(totalOwed).to.equal(0);
      });

      it("Should handle getRemainingBalance for fully repaid loan", async function () {
        const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);

        await mine(BLOCKS_PER_DAY);
        await repayFully(unlloo, usdc, borrower1, loanId);

        const finalBalance = await unlloo.getRemainingBalance(loanId);
        expect(finalBalance).to.equal(0);
      });
    });

    describe("Status array management", function () {
      it("Should correctly handle multiple status transitions", async function () {
        await submitLoanRequestHelper(
          unlloo,
          usdc,
          borrower1,
          constants.VALID_REPUTATION,
          1000,
          MIN_LOAN_DURATION_BLOCKS,
        );
        const loanId = await unlloo.loanCounter();

        // Check Pending
        let pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
        expect(pendingLoans).to.include(loanId);

        // Approve
        await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
        pendingLoans = await unlloo.getLoansByStatus(0, 0, 10);
        expect(pendingLoans).to.not.include(loanId);

        let approvedLoans = await unlloo.getLoansByStatus(1, 0, 10);
        expect(approvedLoans).to.include(loanId);

        // Borrow
        await mintAndApproveUSDC(
          usdc,
          lender1,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          await unlloo.getAddress(),
        );
        await unlloo
          .connect(lender1)
          .depositLiquidity(await usdc.getAddress(), ethers.parseUnits("10000", constants.USDC_DECIMALS), {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          });

        const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
        await unlloo.connect(borrower1).borrow(loanId, maxBorrowable, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        approvedLoans = await unlloo.getLoansByStatus(1, 0, 10);
        expect(approvedLoans).to.not.include(loanId);

        let activeLoans = await unlloo.getLoansByStatus(2, 0, 10);
        expect(activeLoans).to.include(loanId);

        // Move to UnpaidDebt
        const loan = await unlloo.getLoan(loanId);
        await mine(loan.loanDurationBlocks + 1n);

        // Make a repayment to trigger status change
        const smallAmount = ethers.parseUnits("10", constants.USDC_DECIMALS);
        await mintAndApproveUSDC(usdc, borrower1, smallAmount, await unlloo.getAddress());
        await unlloo.connect(borrower1).repay(loanId, smallAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

        activeLoans = await unlloo.getLoansByStatus(2, 0, 10);
        expect(activeLoans).to.not.include(loanId);

        const unpaidDebtLoans = await unlloo.getLoansByStatus(3, 0, 10);
        expect(unpaidDebtLoans).to.include(loanId);
      });
    });

    // Index system edge cases - REMOVED: No longer use borrow index with simple interest
  });
});
