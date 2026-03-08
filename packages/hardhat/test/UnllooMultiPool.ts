/**
 * @file Multi-Pool Tests
 * @description Tests for token isolation across multiple liquidity pools
 *              Verifies that accounting remains isolated per token
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import {
  mintAndApproveUSDC,
  repayFully,
  getLenderPosition,
  createAndApproveLoan,
  setupCompleteBorrow,
} from "./helpers";

describe("Unlloo - Multi Pool (Token Isolation)", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let tokenB: MockERC20;
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let borrower2: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;
  let lender2: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    borrower2 = ctx.borrower2;
    lender1 = ctx.lender1;
    lender2 = ctx.lender2;

    // Deploy second pool token (same decimals as USDC for simplicity)
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    tokenB = (await MockERC20Factory.deploy("TokenB", "TB", constants.USDC_DECIMALS, {
      gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
    })) as MockERC20;
    await tokenB.waitForDeployment();

    // Add second liquidity pool
    const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
    const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
    await unlloo.connect(owner).addLiquidityPool(await tokenB.getAddress(), minLoanAmount, maxLoanAmount, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });
  });

  it("Should keep accounting isolated across pools (borrowedAmount, protocolFees, withdraws)", async function () {
    const usdcAddr = await usdc.getAddress();
    const tokenBAddr = await tokenB.getAddress();

    // Lenders deposit into both pools
    const depA1 = ethers.parseUnits("10000", constants.USDC_DECIMALS);
    const depB1 = ethers.parseUnits("7000", constants.USDC_DECIMALS);
    const depA2 = ethers.parseUnits("5000", constants.USDC_DECIMALS);
    const depB2 = ethers.parseUnits("9000", constants.USDC_DECIMALS);

    // Lender1 deposits to USDC pool
    await mintAndApproveUSDC(usdc, lender1, depA1, ctx.unllooAddress);
    await unlloo.connect(lender1).depositLiquidity(usdcAddr, depA1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Lender1 deposits to TokenB pool
    await mintAndApproveUSDC(tokenB, lender1, depB1, ctx.unllooAddress);
    await unlloo.connect(lender1).depositLiquidity(tokenBAddr, depB1, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Lender2 deposits to USDC pool
    await mintAndApproveUSDC(usdc, lender2, depA2, ctx.unllooAddress);
    await unlloo.connect(lender2).depositLiquidity(usdcAddr, depA2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Lender2 deposits to TokenB pool
    await mintAndApproveUSDC(tokenB, lender2, depB2, ctx.unllooAddress);
    await unlloo.connect(lender2).depositLiquidity(tokenBAddr, depB2, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Verify initial pool states
    const poolA0 = await unlloo.getLiquidityPool(usdcAddr);
    const poolB0 = await unlloo.getLiquidityPool(tokenBAddr);
    expect(poolA0.totalLiquidity).to.equal(depA1 + depA2);
    expect(poolB0.totalLiquidity).to.equal(depB1 + depB2);
    expect(poolA0.borrowedAmount).to.equal(0n);
    expect(poolB0.borrowedAmount).to.equal(0n);

    // Borrower1 borrows from pool A (USDC)
    const loanAmountA = ethers.parseUnits("4000", constants.USDC_DECIMALS);
    await unlloo
      .connect(borrower1)
      .submitLoanRequest(constants.VALID_REPUTATION, usdcAddr, loanAmountA, ctx.minLoanDurationBlocks, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
    const loanIdA = await unlloo.loanCounter();
    await unlloo.connect(owner).approveLoanRequest(loanIdA, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    await unlloo.connect(borrower1).borrow(loanIdA, loanAmountA, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Borrower2 borrows from pool B (TokenB)
    const loanAmountB = ethers.parseUnits("6000", constants.USDC_DECIMALS);
    await unlloo
      .connect(borrower2)
      .submitLoanRequest(constants.VALID_REPUTATION, tokenBAddr, loanAmountB, ctx.minLoanDurationBlocks, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
    const loanIdB = await unlloo.loanCounter();
    await unlloo.connect(owner).approveLoanRequest(loanIdB, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    await unlloo.connect(borrower2).borrow(loanIdB, loanAmountB, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Verify borrowed amounts are isolated
    const poolA1 = await unlloo.getLiquidityPool(usdcAddr);
    const poolB1 = await unlloo.getLiquidityPool(tokenBAddr);
    expect(poolA1.borrowedAmount).to.equal(loanAmountA);
    expect(poolB1.borrowedAmount).to.equal(loanAmountB);

    // Mine blocks and repay both (generate protocol fees per token)
    await mine(Number(ctx.blocksPerDay));

    await repayFully(unlloo, usdc, borrower1, loanIdA);
    await repayFully(unlloo, tokenB, borrower2, loanIdB);

    // Verify protocol fees are isolated
    const feesA = await unlloo.getProtocolFees(usdcAddr);
    const feesB = await unlloo.getProtocolFees(tokenBAddr);
    expect(feesA).to.be.gt(0n);
    expect(feesB).to.be.gt(0n);
    // Fees will be different due to different loan sizes
    expect(feesA).to.not.equal(feesB);

    // Withdraw from pool A should not depend on pool B state
    const lender1PosA = await getLenderPosition(unlloo, lender1.address, usdcAddr);
    await expect(
      unlloo.connect(lender1).withdrawLiquidity(usdcAddr, lender1PosA.depositedAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      }),
    ).to.not.be.reverted;

    // Withdraw from pool B should not depend on pool A state
    const lender2PosB = await getLenderPosition(unlloo, lender2.address, tokenBAddr);
    await expect(
      unlloo.connect(lender2).withdrawLiquidity(tokenBAddr, lender2PosB.depositedAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      }),
    ).to.not.be.reverted;
  });

  it("Should keep rate curves isolated across pools", async function () {
    const usdcAddr = await usdc.getAddress();
    const tokenBAddr = await tokenB.getAddress();

    // Get default rate curves (should be same initially)
    const usdcCurveBefore = await unlloo.getPoolRateCurve(usdcAddr);
    const tokenBCurveBefore = await unlloo.getPoolRateCurve(tokenBAddr);
    expect(usdcCurveBefore.baseRateBps).to.equal(tokenBCurveBefore.baseRateBps);

    // Update USDC rate curve
    await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 500, 7500, 800, 3500, 3000, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });

    // Verify USDC changed
    const usdcCurveAfter = await unlloo.getPoolRateCurve(usdcAddr);
    expect(usdcCurveAfter.baseRateBps).to.equal(500);
    expect(usdcCurveAfter.baseRateBps).to.not.equal(usdcCurveBefore.baseRateBps);

    // Verify TokenB unchanged
    const tokenBCurveAfter = await unlloo.getPoolRateCurve(tokenBAddr);
    expect(tokenBCurveAfter.baseRateBps).to.equal(tokenBCurveBefore.baseRateBps);
  });

  it("Should use correct rate curve for loans in each pool", async function () {
    const usdcAddr = await usdc.getAddress();
    const tokenBAddr = await tokenB.getAddress();

    // Set different rate curves
    await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, 200, 8000, 600, 4000, 2500, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });

    await unlloo.connect(owner).updatePoolRateCurve(tokenBAddr, 500, 7000, 1000, 3500, 3000, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });

    // Deposit to both pools
    const depUsdc = ethers.parseUnits("100000", constants.USDC_DECIMALS);
    const depTokenB = ethers.parseUnits("100000", constants.USDC_DECIMALS);

    await mintAndApproveUSDC(usdc, lender1, depUsdc, ctx.unllooAddress);
    await unlloo.connect(lender1).depositLiquidity(usdcAddr, depUsdc, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    await mintAndApproveUSDC(tokenB, lender1, depTokenB, ctx.unllooAddress);
    await unlloo.connect(lender1).depositLiquidity(tokenBAddr, depTokenB, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    // Create loans in both pools
    const loanUsdc = await createAndApproveLoan(unlloo, usdc, borrower1, owner, constants.VALID_REPUTATION, 10000);
    const loanTokenB = await createAndApproveLoan(unlloo, tokenB, borrower2, owner, constants.VALID_REPUTATION, 10000);

    await unlloo.connect(borrower1).borrow(loanUsdc, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });
    await unlloo.connect(borrower2).borrow(loanTokenB, ethers.parseUnits("10000", constants.USDC_DECIMALS), {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });

    // Verify loans use their respective pool's rate curves
    const loan1 = await unlloo.loans(loanUsdc);
    const loan2 = await unlloo.loans(loanTokenB);

    // Rates should be different due to different rate curves
    // (exact values depend on utilization, but they should be calculated with different curves)
    expect(loan1.borrowRateBps).to.be.gte(200); // USDC base rate
    expect(loan2.borrowRateBps).to.be.gte(500); // TokenB base rate
  });

  it("Should persist rate curves after pool operations", async function () {
    const usdcAddr = await usdc.getAddress();
    const customBaseRate = 400;

    // Set custom rate curve
    await unlloo.connect(owner).updatePoolRateCurve(usdcAddr, customBaseRate, 8000, 600, 4000, 2500, {
      gasLimit: constants.COVERAGE_GAS_LIMIT,
    });

    // Perform operations
    const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);
    await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
    await unlloo.connect(lender1).depositLiquidity(usdcAddr, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    await setupCompleteBorrow(
      unlloo,
      usdc,
      borrower1,
      lender1,
      owner,
      1000,
      ethers.parseUnits("100000", constants.USDC_DECIMALS),
      ctx.minLoanDurationBlocks,
    );

    // Rate curve should persist
    const rateCurve = await unlloo.getPoolRateCurve(usdcAddr);
    expect(rateCurve.baseRateBps).to.equal(customBaseRate);
  });
});
