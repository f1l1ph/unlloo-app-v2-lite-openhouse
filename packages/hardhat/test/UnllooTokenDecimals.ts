/**
 * @file Token Decimals Tests
 * @description Tests for different token decimal configurations
 *              Verifies interest calculations, loan amounts, and protocol fees work correctly
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20, NoDecimalsERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { setupCompleteBorrow, mintAndApproveUSDC, depositLiquidity, repayFully } from "./helpers";

describe("Unlloo - Token Decimals", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    lender1 = ctx.lender1;
  });

  describe("Tokens with 0 Decimals", function () {
    it("Should reject tokens with 0 decimals (contract only accepts 6-18 decimals)", async function () {
      // Note: The contract's _validateTokenDecimals only accepts decimals between 6 and 18
      // Tokens with 0 decimals or where decimals() reverts cannot be added as pools
      // This is correct contract behavior for security
      const NoDecimalsERC20Factory = await ethers.getContractFactory("NoDecimalsERC20");
      const token0Dec = (await NoDecimalsERC20Factory.deploy("Token0Dec", "T0D", {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      })) as NoDecimalsERC20;
      await token0Dec.waitForDeployment();

      // Add pool should revert because decimals() reverts or returns invalid value
      const minLoanAmount = ethers.parseUnits("10", 0); // 10 tokens
      const maxLoanAmount = ethers.parseUnits("100000", 0); // 100k tokens
      await expect(
        unlloo.connect(owner).addLiquidityPool(await token0Dec.getAddress(), minLoanAmount, maxLoanAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
    });
  });

  describe("Tokens with 18 Decimals (Standard)", function () {
    it("Should handle tokens with 18 decimals correctly", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const token18Dec = (await MockERC20Factory.deploy("Token18Dec", "T18D", 18, {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      })) as MockERC20;
      await token18Dec.waitForDeployment();

      const minLoanAmount = ethers.parseUnits("10", 18);
      const maxLoanAmount = ethers.parseUnits("100000", 18);
      await unlloo.connect(owner).addLiquidityPool(await token18Dec.getAddress(), minLoanAmount, maxLoanAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const tokenAddr = await token18Dec.getAddress();
      const depositAmount = ethers.parseUnits("100000", 18);
      await token18Dec.mint(lender1.address, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await token18Dec.connect(lender1).approve(await unlloo.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await unlloo
        .connect(lender1)
        .depositLiquidity(tokenAddr, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Create loan
      await unlloo
        .connect(borrower1)
        .submitLoanRequest(
          constants.VALID_REPUTATION,
          tokenAddr,
          ethers.parseUnits("1000", 18),
          ctx.minLoanDurationBlocks,
          {
            gasLimit: constants.COVERAGE_GAS_LIMIT,
          },
        );
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo
        .connect(borrower1)
        .borrow(loanId, ethers.parseUnits("1000", 18), { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.loans(loanId);
      expect(loan.principal).to.equal(ethers.parseUnits("1000", 18));
    });
  });

  describe("Tokens with 6 Decimals (USDC-like)", function () {
    it("Should handle tokens with 6 decimals correctly", async function () {
      // USDC is already tested in main tests, but verify explicitly
      const usdc = ctx.usdc;
      const usdcAddr = await usdc.getAddress();
      expect(await usdc.decimals()).to.equal(6);

      const depositAmount = ethers.parseUnits("100000", 6);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

      const loanAmount = ethers.parseUnits("1000", 6);
      await unlloo
        .connect(borrower1)
        .submitLoanRequest(constants.VALID_REPUTATION, usdcAddr, loanAmount, ctx.minLoanDurationBlocks, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.loans(loanId);
      expect(loan.principal).to.equal(loanAmount);
    });
  });

  describe("Tokens with 8 Decimals (WBTC-like)", function () {
    it("Should handle tokens with 8 decimals correctly", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const token8Dec = (await MockERC20Factory.deploy("Token8Dec", "T8D", 8, {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      })) as MockERC20;
      await token8Dec.waitForDeployment();

      const minLoanAmount = ethers.parseUnits("10", 8);
      const maxLoanAmount = ethers.parseUnits("100000", 8);
      await unlloo.connect(owner).addLiquidityPool(await token8Dec.getAddress(), minLoanAmount, maxLoanAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const tokenAddr = await token8Dec.getAddress();
      const depositAmount = ethers.parseUnits("100000", 8);
      await token8Dec.mint(lender1.address, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await token8Dec.connect(lender1).approve(await unlloo.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await unlloo
        .connect(lender1)
        .depositLiquidity(tokenAddr, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanAmount = ethers.parseUnits("1000", 8);
      await unlloo
        .connect(borrower1)
        .submitLoanRequest(constants.VALID_REPUTATION, tokenAddr, loanAmount, ctx.minLoanDurationBlocks, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loan = await unlloo.loans(loanId);
      expect(loan.principal).to.equal(loanAmount);
    });
  });

  describe("Decimals Fallback", function () {
    it("Should reject tokens when decimals() call fails (contract security)", async function () {
      // Note: The contract's _validateTokenDecimals reverts if decimals() call fails
      // This is correct security behavior - we don't want to guess decimals
      const NoDecimalsERC20Factory = await ethers.getContractFactory("NoDecimalsERC20");
      const noDecimalsToken = (await NoDecimalsERC20Factory.deploy("NoDecimals", "NODEC", {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      })) as NoDecimalsERC20;
      await noDecimalsToken.waitForDeployment();

      // Adding pool should revert because decimals() reverts
      const minLoanAmount = ethers.parseUnits("10", 18);
      const maxLoanAmount = ethers.parseUnits("100000", 18);
      await expect(
        unlloo.connect(owner).addLiquidityPool(await noDecimalsToken.getAddress(), minLoanAmount, maxLoanAmount, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidPool");
    });
  });

  describe("Interest Calculations with Different Decimals", function () {
    it("Should calculate interest correctly with 6 decimals", async function () {
      const usdc = ctx.usdc;
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

      // Mine blocks to accrue interest
      const { mine } = await import("@nomicfoundation/hardhat-network-helpers");
      await mine(Number(ctx.blocksPerDay));

      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gt(0n);
    });

    it("Should calculate interest correctly with 18 decimals", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const token18Dec = (await MockERC20Factory.deploy("Token18Dec", "T18D", 18, {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      })) as MockERC20;
      await token18Dec.waitForDeployment();

      const minLoanAmount = ethers.parseUnits("10", 18);
      const maxLoanAmount = ethers.parseUnits("100000", 18);
      await unlloo.connect(owner).addLiquidityPool(await token18Dec.getAddress(), minLoanAmount, maxLoanAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      const tokenAddr = await token18Dec.getAddress();
      const depositAmount = ethers.parseUnits("100000", 18);
      await token18Dec.mint(lender1.address, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await token18Dec.connect(lender1).approve(await unlloo.getAddress(), depositAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await unlloo
        .connect(lender1)
        .depositLiquidity(tokenAddr, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const loanAmount = ethers.parseUnits("1000", 18);
      await unlloo
        .connect(borrower1)
        .submitLoanRequest(constants.VALID_REPUTATION, tokenAddr, loanAmount, ctx.minLoanDurationBlocks, {
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        });
      const loanId = await unlloo.loanCounter();
      await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await unlloo.connect(borrower1).borrow(loanId, loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const { mine } = await import("@nomicfoundation/hardhat-network-helpers");
      await mine(Number(ctx.blocksPerDay));

      const accruedInterest = await unlloo.getAccruedInterest(loanId);
      expect(accruedInterest).to.be.gt(0n);
    });
  });

  describe("Protocol Fees with Different Decimals", function () {
    it("Should calculate protocol fees correctly with 6 decimals", async function () {
      const usdc = ctx.usdc;
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

      const { mine } = await import("@nomicfoundation/hardhat-network-helpers");
      await mine(Number(ctx.blocksPerDay));

      await repayFully(unlloo, usdc, borrower1, loanId);

      const fees = await unlloo.getProtocolFees(await usdc.getAddress());
      expect(fees).to.be.gt(0n);
    });
  });

  describe("Cross-Pool Operations with Different Decimals", function () {
    it("Should handle operations across pools with different decimals", async function () {
      const usdc = ctx.usdc;
      const usdcAddr = await usdc.getAddress();

      // Create 18 decimal token pool
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const token18Dec = (await MockERC20Factory.deploy("Token18Dec", "T18D", 18, {
        gasLimit: constants.DEPLOYMENT_GAS_LIMIT,
      })) as MockERC20;
      await token18Dec.waitForDeployment();

      const minLoanAmount18 = ethers.parseUnits("10", 18);
      const maxLoanAmount18 = ethers.parseUnits("100000", 18);
      await unlloo.connect(owner).addLiquidityPool(await token18Dec.getAddress(), minLoanAmount18, maxLoanAmount18, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Deposit to both pools
      const depositUsdc = ethers.parseUnits("100000", 6);
      await mintAndApproveUSDC(usdc, lender1, depositUsdc, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositUsdc);

      const deposit18 = ethers.parseUnits("100000", 18);
      await token18Dec.mint(lender1.address, deposit18, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      await token18Dec.connect(lender1).approve(await unlloo.getAddress(), deposit18, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      await unlloo.connect(lender1).depositLiquidity(await token18Dec.getAddress(), deposit18, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });

      // Verify both pools work independently
      const poolUsdc = await unlloo.getLiquidityPool(usdcAddr);
      const pool18 = await unlloo.getLiquidityPool(await token18Dec.getAddress());

      expect(poolUsdc.totalLiquidity).to.equal(depositUsdc);
      expect(pool18.totalLiquidity).to.equal(deposit18);
    });
  });
});
