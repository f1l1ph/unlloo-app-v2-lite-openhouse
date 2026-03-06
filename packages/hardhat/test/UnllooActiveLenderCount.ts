/**
 * @file Active Lender Count Tests
 * @description Tests for activeLenderCount tracking per pool
 *              Verifies increment/decrement logic and isolation
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Unlloo, MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC, depositLiquidity, withdrawLiquidity, getLenderPosition } from "./helpers";

describe("Unlloo - Active Lender Count", function () {
  let ctx: UnllooTestContext;
  let unlloo: Unlloo;
  let usdc: MockERC20;
  let tokenB: MockERC20;
  let owner: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;
  let lender2: HardhatEthersSigner;
  let lender3: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    lender1 = ctx.lender1;
    lender2 = ctx.lender2;
    const signers = await ethers.getSigners();
    lender3 = signers[6];

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

  describe("Increment Logic", function () {
    it("Should increment activeLenderCount on first deposit", async function () {
      const usdcAddr = await usdc.getAddress();
      const countBefore = await unlloo.getActiveLenderCount(usdcAddr);
      expect(countBefore).to.equal(0n);

      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

      const countAfter = await unlloo.getActiveLenderCount(usdcAddr);
      expect(countAfter).to.equal(1n);
    });

    it("Should not increment on subsequent deposits by same lender", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount1 = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount1, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount1);

      const countAfterFirst = await unlloo.getActiveLenderCount(usdcAddr);
      expect(countAfterFirst).to.equal(1n);

      // Second deposit by same lender
      const depositAmount2 = ethers.parseUnits("5000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount2, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount2);

      const countAfterSecond = await unlloo.getActiveLenderCount(usdcAddr);
      expect(countAfterSecond).to.equal(1n); // Should still be 1
    });

    it("Should increment for multiple different lenders", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Lender1 deposits
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Lender2 deposits
      await mintAndApproveUSDC(usdc, lender2, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender2, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(2n);

      // Lender3 deposits
      await mintAndApproveUSDC(usdc, lender3, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender3, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(3n);
    });
  });

  describe("Decrement Logic", function () {
    it("Should decrement when lender fully withdraws", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Full withdrawal
      const position = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender1, position.depositedAmount);

      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(0n);
    });

    it("Should not decrement on partial withdrawal", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Partial withdrawal
      const partialAmount = depositAmount / 2n;
      await withdrawLiquidity(unlloo, usdc, lender1, partialAmount);

      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n); // Should still be 1
    });

    it("Should not decrement below zero", async function () {
      const usdcAddr = await usdc.getAddress();
      const count = await unlloo.getActiveLenderCount(usdcAddr);
      expect(count).to.equal(0n);

      // Try to withdraw when count is already 0 (should revert due to no position)
      await expect(
        unlloo.connect(lender1).withdrawLiquidity(usdcAddr, ethers.parseUnits("1000", constants.USDC_DECIMALS), {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.reverted; // Should revert for other reasons, not because count would go negative
    });

    it("Should handle multiple lenders withdrawing", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Setup 3 lenders
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      await mintAndApproveUSDC(usdc, lender2, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender2, depositAmount);
      await mintAndApproveUSDC(usdc, lender3, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender3, depositAmount);

      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(3n);

      // Lender1 withdraws
      const pos1 = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender1, pos1.depositedAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(2n);

      // Lender2 withdraws
      const pos2 = await getLenderPosition(unlloo, lender2.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender2, pos2.depositedAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Lender3 withdraws
      const pos3 = await getLenderPosition(unlloo, lender3.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender3, pos3.depositedAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(0n);
    });
  });

  describe("Per-Pool Isolation", function () {
    it("Should keep counts isolated per pool", async function () {
      const usdcAddr = await usdc.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      // Deposit to USDC pool
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);
      expect(await unlloo.getActiveLenderCount(tokenBAddr)).to.equal(0n);

      // Deposit to TokenB pool
      await mintAndApproveUSDC(tokenB, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, tokenB, lender1, depositAmount);

      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);
      expect(await unlloo.getActiveLenderCount(tokenBAddr)).to.equal(1n);

      // Withdraw from USDC pool
      const posUsdc = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender1, posUsdc.depositedAmount);

      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(0n);
      expect(await unlloo.getActiveLenderCount(tokenBAddr)).to.equal(1n); // TokenB count unchanged
    });

    it("Should track different lenders across different pools", async function () {
      const usdcAddr = await usdc.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // Lender1 deposits to USDC
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

      // Lender2 deposits to TokenB
      await mintAndApproveUSDC(tokenB, lender2, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, tokenB, lender2, depositAmount);

      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);
      expect(await unlloo.getActiveLenderCount(tokenBAddr)).to.equal(1n);
    });
  });

  describe("Persistence Across Loan Lifecycle", function () {
    it("Should persist count during loan lifecycle", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Create and borrow loan
      await unlloo
        .connect(ctx.borrower1)
        .submitLoanRequest(
          constants.VALID_REPUTATION,
          usdcAddr,
          ethers.parseUnits("10000", constants.USDC_DECIMALS),
          ctx.minLoanDurationBlocks,
          {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          },
        );
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(ctx.owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(ctx.borrower1).borrow(loanId, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Count should still be 1
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Repay loan
      const totalOwed = await unlloo.getTotalOwed(loanId);
      await mintAndApproveUSDC(usdc, ctx.borrower1, totalOwed, ctx.unllooAddress);
      await unlloo.connect(ctx.borrower1).repay(loanId, totalOwed, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Count should still be 1
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle lender deposits, withdraws, deposits again (count should be 1)", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // First deposit
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Full withdrawal
      const pos1 = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender1, pos1.depositedAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(0n);

      // Deposit again
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);
    });

    it("Should handle multiple partial withdrawals until fully withdrawn", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // First partial withdrawal
      await withdrawLiquidity(unlloo, usdc, lender1, depositAmount / 3n);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Second partial withdrawal
      await withdrawLiquidity(unlloo, usdc, lender1, depositAmount / 3n);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      // Final withdrawal (should decrement)
      const pos = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender1, pos.depositedAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(0n);
    });
  });

  describe("View Function", function () {
    it("Should return correct active lender count via getActiveLenderCount", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("10000", constants.USDC_DECIMALS);

      // No lenders initially
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(0n);

      // Add lenders
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      await mintAndApproveUSDC(usdc, lender2, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender2, depositAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(2n);

      // Remove lenders
      const pos1 = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender1, pos1.depositedAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(1n);

      const pos2 = await getLenderPosition(unlloo, lender2.address, usdcAddr);
      await withdrawLiquidity(unlloo, usdc, lender2, pos2.depositedAmount);
      expect(await unlloo.getActiveLenderCount(usdcAddr)).to.equal(0n);
    });

    it("Should return 0 for non-existent pool", async function () {
      const invalidToken = ethers.Wallet.createRandom().address;
      expect(await unlloo.getActiveLenderCount(invalidToken)).to.equal(0n);
    });
  });
});
