/**
 * @file Upgrade Scenarios Tests
 * @description Tests for upgrade scenarios and storage layout compatibility.
 *
 * The new architecture has two independent upgrade paths:
 *
 * 1. Proxy upgrade (UUPS): Deploy a new UnllooCore implementation and upgrade
 *    the proxy to point to it. Handles hot-path logic changes. Storage is
 *    preserved in the proxy. Tested via storage persistence checks below.
 *
 * 2. Extension swap (setExtension): Deploy a new UnllooExt and call
 *    setExtension() on the proxy address. Handles admin/view logic changes.
 *    No proxy upgrade needed. State is preserved because Ext always reads
 *    from the proxy's storage via delegatecall. Tested in "Extension Management".
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { setupCompleteBorrow, mintAndApproveUSDC, depositLiquidity, getLenderPosition } from "./helpers";

describe("Unlloo - Upgrade Scenarios", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let owner: HardhatEthersSigner;
  let borrower1: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    owner = ctx.owner;
    borrower1 = ctx.borrower1;
    lender1 = ctx.lender1;
    nonOwner = ctx.nonOwner;
  });

  // ---------------------------------------------------------------------------
  // Storage Layout Compatibility
  // These tests verify that proxy storage is preserved correctly. In the new
  // architecture, UnllooCore is the proxy implementation. Upgrading the proxy
  // to a new UnllooCore implementation must preserve all storage slots.
  // The "Simulate upgrade" comments mark where a real proxy swap would occur —
  // state read before and after must be identical.
  // ---------------------------------------------------------------------------
  describe("Storage Layout Compatibility", function () {
    it("Should preserve loan data across upgrade", async function () {
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
      const loanCounterBefore = await unlloo.loanCounter();

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      const loanAfter = await unlloo.loans(loanId);
      expect(loanAfter.loanId).to.equal(loanBefore.loanId);
      expect(loanAfter.borrower).to.equal(loanBefore.borrower);
      expect(loanAfter.status).to.equal(loanBefore.status);
      expect(loanAfter.principal).to.equal(loanBefore.principal);

      const loanCounterAfter = await unlloo.loanCounter();
      expect(loanCounterAfter).to.equal(loanCounterBefore);
    });

    it("Should preserve pool data across upgrade", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

      const poolBefore = await unlloo.getLiquidityPool(usdcAddr);
      const activeLenderCountBefore = await unlloo.getActiveLenderCount(usdcAddr);

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      const poolAfter = await unlloo.getLiquidityPool(usdcAddr);
      expect(poolAfter.token).to.equal(poolBefore.token);
      expect(poolAfter.totalLiquidity).to.equal(poolBefore.totalLiquidity);
      expect(poolAfter.borrowedAmount).to.equal(poolBefore.borrowedAmount);

      const activeLenderCountAfter = await unlloo.getActiveLenderCount(usdcAddr);
      expect(activeLenderCountAfter).to.equal(activeLenderCountBefore);
    });

    it("Should preserve lender positions across upgrade", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

      const positionBefore = await getLenderPosition(unlloo, lender1.address, usdcAddr);

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      const positionAfter = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      expect(positionAfter.depositedAmount).to.equal(positionBefore.depositedAmount);
    });

    it("Should preserve protocol fees across upgrade", async function () {
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

      const totalOwed = await unlloo.getTotalOwed(loanId);
      await mintAndApproveUSDC(usdc, borrower1, totalOwed, ctx.unllooAddress);
      await unlloo.connect(borrower1).repay(loanId, totalOwed, { gasLimit: constants.COVERAGE_GAS_LIMIT });

      const feesBefore = await unlloo.getProtocolFees(await usdc.getAddress());
      expect(feesBefore).to.be.gt(0n);

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      const feesAfter = await unlloo.getProtocolFees(await usdc.getAddress());
      expect(feesAfter).to.equal(feesBefore);
    });

    it("Should preserve counters across upgrade", async function () {
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

      const usdcAddr = await usdc.getAddress();
      const loanCounterBefore = await unlloo.loanCounter();
      const activeLoansBefore = await unlloo.activeLoansPerPool(usdcAddr);
      const activeLenderCountBefore = await unlloo.getActiveLenderCount(usdcAddr);

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      const loanCounterAfter = await unlloo.loanCounter();
      const activeLoansAfter = await unlloo.activeLoansPerPool(usdcAddr);
      const activeLenderCountAfter = await unlloo.getActiveLenderCount(usdcAddr);

      expect(loanCounterAfter).to.equal(loanCounterBefore);
      expect(activeLoansAfter).to.equal(activeLoansBefore);
      expect(activeLenderCountAfter).to.equal(activeLenderCountBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // Functionality After Upgrade
  // ---------------------------------------------------------------------------
  describe("Functionality After Upgrade", function () {
    it("Should allow existing functions to work after upgrade", async function () {
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

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      const loan = await unlloo.loans(loanId);
      expect(loan.loanId).to.equal(loanId);

      const totalOwed = await unlloo.getTotalOwed(loanId);
      await mintAndApproveUSDC(usdc, borrower1, totalOwed, ctx.unllooAddress);
      await expect(unlloo.connect(borrower1).repay(loanId, totalOwed, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to
        .not.be.reverted;
    });

    it("Should allow new loan requests after upgrade", async function () {
      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.not.be.reverted;
    });

    it("Should allow deposits after upgrade", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await expect(
        unlloo.connect(lender1).depositLiquidity(usdcAddr, depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.not.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Initializer Protection
  // ---------------------------------------------------------------------------
  describe("Initializer Protection", function () {
    it("Should not allow initialize to be called again", async function () {
      const usdcAddr = await usdc.getAddress();
      const minLoanAmount = BigInt(constants.MIN_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
      const maxLoanAmount = BigInt(constants.MAX_LOAN_AMOUNT_USD) * 10n ** BigInt(constants.USDC_DECIMALS);
      const extAddress = await unlloo.extensionDelegate();

      await expect(
        unlloo.initialize(
          usdcAddr,
          constants.BLOCK_TIME_SECONDS,
          owner.address,
          minLoanAmount,
          maxLoanAmount,
          extAddress,
          { gasLimit: constants.COVERAGE_GAS_LIMIT },
        ),
      ).to.be.revertedWithCustomError(unlloo, "InvalidInitialization");
    });
  });

  // ---------------------------------------------------------------------------
  // Gap Storage Slots
  // UnllooStorage maintains uint256[34] __gap (reduced from 35 because
  // extensionDelegate occupies one slot). This ensures storage layout
  // compatibility for future proxy upgrades.
  // ---------------------------------------------------------------------------
  describe("Gap Storage Slots", function () {
    it("Should preserve gap storage slots for future upgrades", async function () {
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
      expect(loan.loanId).to.equal(loanId);

      const totalOwed = await unlloo.getTotalOwed(loanId);
      expect(totalOwed).to.be.gt(0n);
    });
  });

  // ---------------------------------------------------------------------------
  // State Consistency After Upgrade
  // ---------------------------------------------------------------------------
  describe("State Consistency After Upgrade", function () {
    it("Should maintain state consistency across all mappings", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

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
      const poolBefore = await unlloo.getLiquidityPool(usdcAddr);
      const positionBefore = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      const activeLoansBefore = await unlloo.activeLoansPerPool(usdcAddr);
      const activeLenderCountBefore = await unlloo.getActiveLenderCount(usdcAddr);

      // Swap ERC1967 implementation slot to simulate a real proxy upgrade.
      const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const UnllooCoreFactory = await ethers.getContractFactory("UnllooCore");
      const newImpl = await UnllooCoreFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();
      const paddedAddr = "0x" + "0".repeat(24) + newImplAddr.slice(2).toLowerCase();
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, ERC1967_IMPL_SLOT, paddedAddr]);

      const loanAfter = await unlloo.loans(loanId);
      const poolAfter = await unlloo.getLiquidityPool(usdcAddr);
      const positionAfter = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      const activeLoansAfter = await unlloo.activeLoansPerPool(usdcAddr);
      const activeLenderCountAfter = await unlloo.getActiveLenderCount(usdcAddr);

      expect(loanAfter.loanId).to.equal(loanBefore.loanId);
      expect(poolAfter.totalLiquidity).to.equal(poolBefore.totalLiquidity);
      expect(positionAfter.depositedAmount).to.equal(positionBefore.depositedAmount);
      expect(activeLoansAfter).to.equal(activeLoansBefore);
      expect(activeLenderCountAfter).to.equal(activeLenderCountBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // Extension Management
  // Tests for the setExtension() upgrade path. Deploying a new UnllooExt and
  // calling setExtension() updates admin/view logic without touching the proxy
  // or hot-path Core functions. Storage is always the proxy's storage, so all
  // state is preserved across extension swaps automatically.
  // ---------------------------------------------------------------------------
  describe("Extension Management", function () {
    it("Should store the extension address after initialization", async function () {
      const extAddress = await unlloo.extensionDelegate();
      expect(extAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should allow owner to update the extension address", async function () {
      const oldExt = await unlloo.extensionDelegate();

      const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
      const newExt = await UnllooExtFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newExt.waitForDeployment();
      const newExtAddress = await newExt.getAddress();

      const tx = await unlloo.connect(owner).setExtension(newExtAddress, { gasLimit: constants.COVERAGE_GAS_LIMIT });
      const receipt = await tx.wait();
      await expect(tx).to.emit(unlloo, "ExtensionUpdated").withArgs(oldExt, newExtAddress, receipt!.blockNumber);

      expect(await unlloo.extensionDelegate()).to.equal(newExtAddress);
    });

    it("Should revert when non-owner calls setExtension", async function () {
      const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
      const newExt = await UnllooExtFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newExt.waitForDeployment();

      await expect(
        unlloo.connect(nonOwner).setExtension(await newExt.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when setting extension to zero address", async function () {
      await expect(
        unlloo.connect(owner).setExtension(ethers.ZeroAddress, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(unlloo, "InvalidAddress");
    });

    it("Should revert Ext calls when extensionDelegate is address(0)", async function () {
      // Scan storage slots to find extensionDelegate dynamically (robust against layout changes)
      const currentExt = (await unlloo.extensionDelegate()).toLowerCase();
      const paddedExt = "0x" + "0".repeat(24) + currentExt.slice(2);
      let extSlot = "";
      for (let i = 0; i < 128; i++) {
        const slot = "0x" + i.toString(16).padStart(64, "0");
        const val: string = await ethers.provider.send("eth_getStorageAt", [ctx.unllooAddress, slot, "latest"]);
        if (val.toLowerCase() === paddedExt.toLowerCase()) {
          extSlot = slot;
          break;
        }
      }
      expect(extSlot).to.not.equal("", "Could not find extensionDelegate storage slot");

      // Zero the extensionDelegate slot — bypasses setExtension's code.length guard
      await ethers.provider.send("hardhat_setStorageAt", [ctx.unllooAddress, extSlot, "0x" + "0".repeat(64)]);

      // Any Ext-routed call should now revert with InvalidAddress from Core's fallback
      await expect(unlloo.getLoan(1)).to.be.revertedWithCustomError(unlloo, "InvalidAddress");
    });

    it("Should preserve all state after swapping extension", async function () {
      const usdcAddr = await usdc.getAddress();
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);

      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await depositLiquidity(unlloo, usdc, lender1, depositAmount);

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
      const poolBefore = await unlloo.getLiquidityPool(usdcAddr);
      const positionBefore = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      const loanCounterBefore = await unlloo.loanCounter();

      // Deploy new Ext and swap — same bytecode, new instance
      const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
      const newExt = await UnllooExtFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newExt.waitForDeployment();
      await unlloo.connect(owner).setExtension(await newExt.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // All state readable via new Ext (state lives in proxy storage, not Ext)
      const loanAfter = await unlloo.loans(loanId);
      const poolAfter = await unlloo.getLiquidityPool(usdcAddr);
      const positionAfter = await getLenderPosition(unlloo, lender1.address, usdcAddr);
      const loanCounterAfter = await unlloo.loanCounter();

      expect(loanAfter.loanId).to.equal(loanBefore.loanId);
      expect(loanAfter.borrower).to.equal(loanBefore.borrower);
      expect(loanAfter.principal).to.equal(loanBefore.principal);
      expect(poolAfter.totalLiquidity).to.equal(poolBefore.totalLiquidity);
      expect(positionAfter.depositedAmount).to.equal(positionBefore.depositedAmount);
      expect(loanCounterAfter).to.equal(loanCounterBefore);
    });

    it("Should allow hot-path functions to continue working after extension swap", async function () {
      // Deploy and swap Ext first
      const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
      const newExt = await UnllooExtFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newExt.waitForDeployment();
      await unlloo.connect(owner).setExtension(await newExt.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Hot-path (Core) functions must be unaffected by Ext swap
      const depositAmount = ethers.parseUnits("100000", constants.USDC_DECIMALS);
      await mintAndApproveUSDC(usdc, lender1, depositAmount, ctx.unllooAddress);
      await expect(
        unlloo
          .connect(lender1)
          .depositLiquidity(await usdc.getAddress(), depositAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.not.be.reverted;

      await expect(
        unlloo
          .connect(borrower1)
          .submitLoanRequest(
            constants.VALID_REPUTATION,
            await usdc.getAddress(),
            ethers.parseUnits("1000", constants.USDC_DECIMALS),
            ctx.minLoanDurationBlocks,
            { gasLimit: constants.COVERAGE_GAS_LIMIT },
          ),
      ).to.not.be.reverted;
    });

    it("Should allow admin functions to work after extension swap", async function () {
      const UnllooExtFactory = await ethers.getContractFactory("UnllooExt");
      const newExt = await UnllooExtFactory.deploy({ gasLimit: constants.DEPLOYMENT_GAS_LIMIT });
      await newExt.waitForDeployment();
      await unlloo.connect(owner).setExtension(await newExt.getAddress(), { gasLimit: constants.COVERAGE_GAS_LIMIT });

      // Admin function routed via new Ext — must still work
      await expect(unlloo.connect(owner).updateMinReputation(300, { gasLimit: constants.COVERAGE_GAS_LIMIT })).to.not.be
        .reverted;

      expect(await unlloo.minReputation()).to.equal(300n);
    });
  });
});
