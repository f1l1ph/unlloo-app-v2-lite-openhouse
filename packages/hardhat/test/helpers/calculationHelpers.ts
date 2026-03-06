import { expect } from "chai";
import { Unlloo, MockERC20 } from "../../typechain-types";
import { BLOCK_TIME_SECONDS, PROTOCOL_FEE_BPS } from "../fixtures/constants";

export interface BalanceAccounting {
  contractBalance: bigint;
  totalLiquidity: bigint;
  borrowedAmount: bigint;
  freeLiquidity: bigint;
  protocolFees: bigint;
  surplus: bigint;
}

export function calculateExpectedInterest(
  principal: bigint,
  blocksElapsed: bigint,
  rateBps: bigint,
  blockTime: number = BLOCK_TIME_SECONDS,
): bigint {
  if (principal === 0n || blocksElapsed === 0n || rateBps === 0n) return 0n;

  const blocksPerYear = BigInt((365 * 24 * 60 * 60) / blockTime);
  if (blocksPerYear === 0n) return 0n;

  // Simple interest: I = P * r * t
  // r = rateBps / 10000 (annual rate)
  // t = blocksElapsed / blocksPerYear
  return (principal * rateBps * blocksElapsed) / (10000n * blocksPerYear);
}

export function calculateProtocolFee(interest: bigint, feeBps: bigint = BigInt(PROTOCOL_FEE_BPS)): bigint {
  return (interest * feeBps) / 10000n;
}

export function calculateLenderSurplus(interest: bigint, feeBps: bigint = BigInt(PROTOCOL_FEE_BPS)): bigint {
  const protocolFee = calculateProtocolFee(interest, feeBps);
  return interest - protocolFee;
}

export async function getContractBalanceAccounting(
  unlloo: Unlloo,
  token: MockERC20,
  tokenAddress: string,
): Promise<BalanceAccounting> {
  const contractBalance = await token.balanceOf(await unlloo.getAddress());
  const pool = await unlloo.getLiquidityPool(tokenAddress);
  const protocolFees = await unlloo.getProtocolFees(tokenAddress);

  const totalLiquidity = pool.totalLiquidity;
  const borrowedAmount = pool.borrowedAmount;
  const freeLiquidity = totalLiquidity - borrowedAmount;

  // Surplus = excess funds over (freeLiquidity + protocolFees)
  // This represents interest collected from borrowers minus protocol fees (lender's share)
  const surplus = contractBalance > freeLiquidity + protocolFees ? contractBalance - freeLiquidity - protocolFees : 0n;

  return {
    contractBalance,
    totalLiquidity,
    borrowedAmount,
    freeLiquidity,
    protocolFees,
    surplus,
  };
}

export async function verifyEconomicBalance(
  unlloo: Unlloo,
  token: MockERC20,
  tokenAddress: string,
  description: string,
  tolerance: bigint = 1000n,
): Promise<void> {
  const accounting = await getContractBalanceAccounting(unlloo, token, tokenAddress);

  // Economic balance: contractBalance = (totalLiquidity - borrowedAmount) + protocolFees + surplus
  const expectedBalance =
    accounting.totalLiquidity - accounting.borrowedAmount + accounting.protocolFees + accounting.surplus;

  expect(accounting.contractBalance).to.be.closeTo(
    expectedBalance,
    tolerance,
    `${description}: Contract balance mismatch. Actual: ${accounting.contractBalance}, Expected: ${expectedBalance}, Surplus: ${accounting.surplus}`,
  );
}

export function verifyInterestDistribution(
  protocolFee: bigint,
  lenderInterest: bigint,
  totalInterest: bigint,
  tolerance: bigint = 1000n,
): void {
  const totalDistributed = protocolFee + lenderInterest;

  expect(totalDistributed).to.be.closeTo(
    totalInterest,
    tolerance,
    `Interest distribution mismatch. Protocol: ${protocolFee}, Lender: ${lenderInterest}, Total: ${totalInterest}`,
  );

  // Verify protocol fee percentage (25%)
  if (totalInterest > 0n) {
    const actualFeePercent = (protocolFee * 10000n) / totalInterest;
    expect(actualFeePercent).to.be.closeTo(
      BigInt(PROTOCOL_FEE_BPS),
      100n, // 1% tolerance
      `Protocol fee percentage incorrect. Expected: ${PROTOCOL_FEE_BPS}, Actual: ${actualFeePercent}`,
    );
  }
}

export function assertNoDuplicates(ids: bigint[], label: string): void {
  const set = new Set(ids.map(x => x.toString()));
  expect(set.size, `${label} has duplicates`).to.equal(ids.length);
}
