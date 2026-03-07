"use client";

import React, { useMemo } from "react";
import { formatUnits } from "viem";
import { useBlockNumber } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { blocksRemainingToHumanReadable } from "~~/utils/unlloo/blockTime";

interface LoanCardProps {
  loanId: number;
  assetSymbol: string;
  principal: bigint;
  totalInterest: bigint;
  repaidInterest: bigint;
  repaidPrincipal: bigint;
  expirationBlock: bigint;
  currentBlock: bigint;
  isActive: boolean;
  maxLoanAmount?: bigint; // Optional: for displaying max loan amount
  onRepay: () => void;
}

/**
 * Component to display a single loan card
 */
export const LoanCard: React.FC<LoanCardProps> = ({
  loanId,
  assetSymbol,
  principal,
  expirationBlock,
  currentBlock,
  isActive,
  onRepay,
}) => {
  const { data: blockNumber } = useBlockNumber();

  // Get loan details from contract
  const { data: loanData } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "loans",
    args: [BigInt(loanId)],
  });

  // Get block time for human-readable format
  const { data: blockTimeSeconds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "blockTimeSeconds",
  });

  // Get remaining balance
  const { data: remainingBalance } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getRemainingBalance",
    args: [BigInt(loanId)],
  });

  // Get accrued interest
  const { data: accruedInterest } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getAccruedInterest",
    args: [BigInt(loanId)],
  });

  // Extract borrower interest rate from loan data
  const borrowerRateBps = useMemo(() => {
    if (!loanData) return 0n;
    if (Array.isArray(loanData)) {
      const rateValue = loanData[16]; // borrowRateBps is at index 16
      return typeof rateValue === "bigint" ? rateValue : BigInt(String(rateValue ?? 0));
    }
    if (typeof loanData === "object" && loanData !== null && "borrowRateBps" in loanData) {
      const rateValue = (loanData as any).borrowRateBps;
      return typeof rateValue === "bigint" ? rateValue : BigInt(String(rateValue ?? 0));
    }
    return 0n;
  }, [loanData]);

  const effectiveBlock = blockNumber || currentBlock;
  const blocksRemaining = expirationBlock > effectiveBlock ? expirationBlock - effectiveBlock : 0n;
  const isOverdue = effectiveBlock > expirationBlock;

  const totalOwed = useMemo((): bigint => {
    // Prefer using getRemainingBalance as it's the most accurate (includes current accrued interest)
    if (remainingBalance !== undefined && remainingBalance !== null) {
      return BigInt(remainingBalance.toString());
    }

    // Fallback: calculate from loan data if remainingBalance is not available
    if (loanData && Array.isArray(loanData)) {
      const principalValue = loanData[12]; // principal is at index 12 (not 10)
      const amountRepaidValue = loanData[14]; // amountRepaid is at index 14 (not 12)
      const principal = typeof principalValue === "bigint" ? principalValue : BigInt(String(principalValue ?? 0));
      const amountRepaid =
        typeof amountRepaidValue === "bigint" ? amountRepaidValue : BigInt(String(amountRepaidValue ?? 0));
      const accrued =
        accruedInterest !== undefined && accruedInterest !== null
          ? typeof accruedInterest === "bigint"
            ? accruedInterest
            : BigInt(String(accruedInterest))
          : 0n;
      const total: bigint = principal + accrued;
      if (total > amountRepaid) {
        return total - amountRepaid;
      }
      return 0n;
    }

    // If loanData is an object (viem format), try to access fields directly
    if (loanData && typeof loanData === "object" && !Array.isArray(loanData) && "principal" in loanData) {
      const loan = loanData as any;
      const principal =
        loan.principal !== undefined && loan.principal !== null
          ? typeof loan.principal === "bigint"
            ? loan.principal
            : BigInt(String(loan.principal))
          : 0n;
      const amountRepaid =
        loan.amountRepaid !== undefined && loan.amountRepaid !== null
          ? typeof loan.amountRepaid === "bigint"
            ? loan.amountRepaid
            : BigInt(String(loan.amountRepaid))
          : 0n;
      const accrued =
        accruedInterest !== undefined && accruedInterest !== null
          ? typeof accruedInterest === "bigint"
            ? accruedInterest
            : BigInt(String(accruedInterest))
          : 0n;
      const total: bigint = principal + accrued;
      if (total > amountRepaid) {
        return total - amountRepaid;
      }
      return 0n;
    }

    return 0n;
  }, [loanData, accruedInterest, remainingBalance]);

  const totalOwedFormatted = parseFloat(formatUnits(totalOwed, 6)); // USDC has 6 decimals
  const principalFormatted = parseFloat(formatUnits(principal, 6));
  const interestFormatted = parseFloat(formatUnits(accruedInterest || 0n, 6));
  const interestRatePercent = borrowerRateBps ? Number(borrowerRateBps) / 100 : 0; // Convert basis points to percentage

  // Human-readable time remaining
  const timeRemaining = useMemo(() => {
    if (!blockTimeSeconds) return blocksRemaining.toString() + " blocks";
    return blocksRemainingToHumanReadable(blocksRemaining, blockTimeSeconds);
  }, [blocksRemaining, blockTimeSeconds]);

  return (
    <div className="bg-base-200 rounded-lg border border-base-300/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-base-content">Loan #{loanId}</div>
        <div
          className={`px-2 py-1 rounded text-xs font-medium ${
            isActive ? "bg-success/20 text-success" : "bg-error/20 text-error"
          }`}
        >
          {isActive ? "Active" : "Overdue"}
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-base-content/70">Loan Amount:</span>
          <span className="font-medium text-base-content">
            {principalFormatted.toFixed(2)} {assetSymbol}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-base-content/70">Interest (accrued):</span>
          <span className="font-medium text-warning">
            {interestFormatted.toFixed(2)} {assetSymbol}
          </span>
        </div>
        {interestRatePercent > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-base-content/60">Interest Rate (APR):</span>
            <span className="font-medium text-base-content">{interestRatePercent.toFixed(2)}%</span>
          </div>
        )}
        <div className="flex justify-between border-t border-base-300/50 pt-1.5">
          <span className="text-base-content/70 font-semibold">Total Owed:</span>
          <span className="font-bold text-primary">
            {totalOwedFormatted.toFixed(2)} {assetSymbol}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-base-content/70">Time Remaining:</span>
          <span className={`font-medium ${isOverdue ? "text-error" : "text-base-content"}`}>{timeRemaining}</span>
        </div>
      </div>

      <button onClick={onRepay} className="w-full btn btn-primary btn-sm" disabled={totalOwedFormatted === 0}>
        Repay
      </button>
    </div>
  );
};
