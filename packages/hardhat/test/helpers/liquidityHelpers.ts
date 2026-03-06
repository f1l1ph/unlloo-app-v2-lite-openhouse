import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Unlloo, MockERC20 } from "../../typechain-types";
import { COVERAGE_GAS_LIMIT } from "../fixtures/constants";
import { mintAndApproveUSDC } from "./tokenHelpers";

export interface LenderPosition {
  depositedAmount: bigint;
  accruedInterest: bigint;
  totalWithdrawable: bigint;
}

export async function depositLiquidity(
  unlloo: Unlloo,
  token: MockERC20,
  lender: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const unllooAddress = await unlloo.getAddress();
  const tokenAddress = await token.getAddress();

  await mintAndApproveUSDC(token, lender, amount, unllooAddress);
  await unlloo.connect(lender).depositLiquidity(tokenAddress, amount, {
    gasLimit: COVERAGE_GAS_LIMIT,
  });
}

export async function withdrawLiquidity(
  unlloo: Unlloo,
  token: MockERC20,
  lender: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const tokenAddress = await token.getAddress();

  await unlloo.connect(lender).withdrawLiquidity(tokenAddress, amount, {
    gasLimit: COVERAGE_GAS_LIMIT,
  });
}

export async function withdrawAllLiquidity(
  unlloo: Unlloo,
  token: MockERC20,
  lender: HardhatEthersSigner,
): Promise<void> {
  const tokenAddress = await token.getAddress();
  const position = await unlloo.getLenderPosition(lender.address, tokenAddress);

  if (position.depositedAmount > 0n) {
    await unlloo.connect(lender).withdrawLiquidity(tokenAddress, position.depositedAmount, {
      gasLimit: COVERAGE_GAS_LIMIT,
    });
  }
}

export async function getLenderPosition(unlloo: Unlloo, lender: string, token: string): Promise<LenderPosition> {
  const position = await unlloo.getLenderPosition(lender, token);
  return {
    depositedAmount: position.depositedAmount,
    accruedInterest: position.accruedInterest,
    totalWithdrawable: position.totalWithdrawable,
  };
}

export async function getPoolUtilization(unlloo: Unlloo, token: string): Promise<bigint> {
  const pool = await unlloo.getLiquidityPool(token);

  if (pool.totalLiquidity === 0n) return 0n;

  return (pool.borrowedAmount * 10000n) / pool.totalLiquidity;
}

export async function getFreeLiquidity(unlloo: Unlloo, token: string): Promise<bigint> {
  const pool = await unlloo.getLiquidityPool(token);
  return pool.totalLiquidity - pool.borrowedAmount;
}
