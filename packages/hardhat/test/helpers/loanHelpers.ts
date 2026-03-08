import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../../typechain-types";
import { UnllooCombined } from "../fixtures/UnllooTestFixture";
import { COVERAGE_GAS_LIMIT, USDC_DECIMALS } from "../fixtures/constants";
import { mintAndApproveUSDC } from "./tokenHelpers";

export interface LoanSetupResult {
  loanId: bigint;
  borrowAmount: bigint;
}

export async function submitLoanRequestHelper(
  unlloo: UnllooCombined,
  token: MockERC20,
  borrower: HardhatEthersSigner,
  reputation: number,
  amountUSD: number,
  durationBlocks: bigint,
) {
  const tokenAddress = await token.getAddress();
  const loanAmount = ethers.parseUnits(amountUSD.toString(), USDC_DECIMALS);

  return await unlloo.connect(borrower).submitLoanRequest(reputation, tokenAddress, loanAmount, durationBlocks, {
    gasLimit: COVERAGE_GAS_LIMIT,
  });
}

export async function createAndApproveLoan(
  unlloo: UnllooCombined,
  token: MockERC20,
  borrower: HardhatEthersSigner,
  owner: HardhatEthersSigner,
  reputation: number = 500,
  amountUSD: number = 1000,
  durationBlocks?: bigint,
): Promise<bigint> {
  const duration = durationBlocks ?? (await unlloo.minLoanDurationBlocks());

  await submitLoanRequestHelper(unlloo, token, borrower, reputation, amountUSD, duration);
  const loanId = await unlloo.loanCounter();

  await unlloo.connect(owner).approveLoanRequest(loanId, { gasLimit: COVERAGE_GAS_LIMIT });

  return loanId;
}

export async function setupCompleteBorrow(
  unlloo: UnllooCombined,
  token: MockERC20,
  borrower: HardhatEthersSigner,
  lender: HardhatEthersSigner,
  owner: HardhatEthersSigner,
  loanAmountUSD: number = 1000,
  liquidityAmount: bigint = ethers.parseUnits("10000", USDC_DECIMALS),
  durationBlocks?: bigint,
): Promise<LoanSetupResult> {
  const tokenAddress = await token.getAddress();
  const unllooAddress = await unlloo.getAddress();

  // Deposit liquidity (only if lender has no existing position or needs more)
  const existingPosition = await unlloo.lenderPositions(lender.address, tokenAddress);
  const existingDeposited = BigInt(existingPosition.depositedAmount.toString());
  if (existingDeposited < liquidityAmount) {
    const depositNeeded = liquidityAmount - existingDeposited;
    await mintAndApproveUSDC(token, lender, depositNeeded, unllooAddress);
    await unlloo.connect(lender).depositLiquidity(tokenAddress, depositNeeded, {
      gasLimit: COVERAGE_GAS_LIMIT,
    });
  }

  // Create and approve loan
  const loanId = await createAndApproveLoan(unlloo, token, borrower, owner, 500, loanAmountUSD, durationBlocks);

  // Borrow maximum allowed
  const maxBorrowable = await unlloo.getApprovedLoanAmount(loanId);
  await unlloo.connect(borrower).borrow(loanId, maxBorrowable, {
    gasLimit: COVERAGE_GAS_LIMIT,
  });

  return { loanId, borrowAmount: maxBorrowable };
}
export async function repayFully(
  unlloo: UnllooCombined,
  token: MockERC20,
  borrower: HardhatEthersSigner,
  loanId: bigint,
): Promise<void> {
  const unllooAddress = await unlloo.getAddress();
  const remainingBalance = await unlloo.getTotalOwed(loanId);

  if (remainingBalance > 0n) {
    // Add buffer to account for interest accruing during transaction
    const repayAmount = remainingBalance + 1_000_000n;
    await mintAndApproveUSDC(token, borrower, repayAmount, unllooAddress);
    await unlloo.connect(borrower).repay(loanId, repayAmount, {
      gasLimit: COVERAGE_GAS_LIMIT,
    });
  }
}

export async function repayPartial(
  unlloo: UnllooCombined,
  token: MockERC20,
  borrower: HardhatEthersSigner,
  loanId: bigint,
  amount: bigint,
): Promise<void> {
  const unllooAddress = await unlloo.getAddress();
  await mintAndApproveUSDC(token, borrower, amount, unllooAddress);
  await unlloo.connect(borrower).repay(loanId, amount, {
    gasLimit: COVERAGE_GAS_LIMIT,
  });
}
