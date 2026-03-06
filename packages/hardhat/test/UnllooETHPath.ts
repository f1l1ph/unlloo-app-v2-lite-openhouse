import { expect } from "chai";
import { ethers } from "hardhat";
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";

describe("Unlloo - ETH Path", function () {
  let ctx: UnllooTestContext;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
  });

  describe("receive()", function () {
    it("Should revert on 0 value send", async function () {
      await expect(
        ctx.lender1.sendTransaction({
          to: ctx.unllooAddress,
          value: 0n,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(ctx.unlloo, "InvalidAmount");
    });

    it("Should accrue protocolFees[0] on non-zero value and emit ETHReceived", async function () {
      const beforeFees = await ctx.unlloo.getProtocolFees(ethers.ZeroAddress);
      const value = ethers.parseEther("0.5");

      await expect(
        ctx.lender1.sendTransaction({
          to: ctx.unllooAddress,
          value,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.emit(ctx.unlloo, "ETHReceived");

      const afterFees = await ctx.unlloo.getProtocolFees(ethers.ZeroAddress);
      expect(afterFees - beforeFees).to.equal(value);
    });

    it("Should revert when paused", async function () {
      await ctx.unlloo.connect(ctx.owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(
        ctx.lender1.sendTransaction({
          to: ctx.unllooAddress,
          value: 1n,
          gasLimit: constants.COVERAGE_GAS_LIMIT,
        }),
      ).to.be.revertedWithCustomError(ctx.unlloo, "EnforcedPause");
    });
  });

  describe("withdrawETH()", function () {
    beforeEach(async function () {
      // Accrue ETH fees
      const value = ethers.parseEther("1");
      await ctx.lender1.sendTransaction({
        to: ctx.unllooAddress,
        value,
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
    });

    it("Should be owner-only", async function () {
      const fees = await ctx.unlloo.getProtocolFees(ethers.ZeroAddress);

      await expect(
        ctx.unlloo.connect(ctx.nonOwner).withdrawETH(fees, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(ctx.unlloo, "OwnableUnauthorizedAccount");
    });

    it("Should revert when amount exceeds protocolFees[0]", async function () {
      const fees = await ctx.unlloo.getProtocolFees(ethers.ZeroAddress);

      await expect(
        ctx.unlloo.connect(ctx.owner).withdrawETH(fees + 1n, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(ctx.unlloo, "InvalidAmount");
    });

    it("Should transfer ETH to owner and update protocolFees", async function () {
      const fees = await ctx.unlloo.getProtocolFees(ethers.ZeroAddress);
      const withdrawAmount = fees / 2n;

      const ownerBalBefore = await ethers.provider.getBalance(ctx.owner.address);

      const tx = await ctx.unlloo.connect(ctx.owner).withdrawETH(withdrawAmount, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const receipt = await tx.wait();
      const gasCost = (receipt?.gasUsed ?? 0n) * (receipt?.gasPrice ?? 0n);

      const ownerBalAfter = await ethers.provider.getBalance(ctx.owner.address);
      expect(ownerBalAfter).to.equal(ownerBalBefore + withdrawAmount - gasCost);

      const remainingFees = await ctx.unlloo.getProtocolFees(ethers.ZeroAddress);
      expect(remainingFees).to.equal(fees - withdrawAmount);
    });

    it("Should revert when paused", async function () {
      await ctx.unlloo.connect(ctx.owner).pause({ gasLimit: constants.COVERAGE_GAS_LIMIT });

      await expect(
        ctx.unlloo.connect(ctx.owner).withdrawETH(1n, { gasLimit: constants.COVERAGE_GAS_LIMIT }),
      ).to.be.revertedWithCustomError(ctx.unlloo, "EnforcedPause");
    });
  });
});
