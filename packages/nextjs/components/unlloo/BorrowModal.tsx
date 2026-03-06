"use client";

import React, { useMemo, useState } from "react";
import { Address, formatUnits, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth/notification";
import { blocksToHumanReadable } from "~~/utils/unlloo/blockTime";

interface BorrowModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolAddress: Address;
  assetSymbol: string;
  assetName: string;
  assetDecimals: number;
  maxLoanAmount: bigint; // In token units (already converted from USD)
  approvedLoanId?: bigint; // Optional: if provided, use this loan ID
  onTransactionSuccess?: () => void;
}

/**
 * Modal component for borrowing from an approved loan
 */
export const BorrowModal: React.FC<BorrowModalProps> = ({
  isOpen,
  onClose,
  poolAddress,
  assetSymbol,
  assetDecimals,
  maxLoanAmount,
  approvedLoanId: propApprovedLoanId,
  onTransactionSuccess,
}) => {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [isBorrowing, setIsBorrowing] = useState(false);
  const { writeContractAsync: writeUnllooAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });

  // Get all loans for this borrower if loanId not provided
  const { data: borrowerLoanIds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoansByBorrower",
    args: address && !propApprovedLoanId ? [address] : [undefined],
  });

  // Use provided loan ID or find approved loan from borrower's loans
  // For now, we'll use the first loan ID if available (simplified)
  // In production, you'd iterate through and check each loan's status
  const approvedLoanId =
    propApprovedLoanId ||
    (borrowerLoanIds && Array.isArray(borrowerLoanIds) && borrowerLoanIds.length > 0
      ? borrowerLoanIds[0] // Simplified - should check status
      : undefined);

  // Get max borrowable amount in tokens (already in token units, no oracle needed)
  const { data: maxBorrowableAmount } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getApprovedLoanAmount",
    args: approvedLoanId ? [approvedLoanId] : [undefined],
  });

  // Get loan details to show duration
  const { data: loanData } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoan",
    args: approvedLoanId ? [approvedLoanId] : [undefined],
  });

  // Get block time for human-readable format
  const { data: blockTimeSeconds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "BLOCK_TIME_SECONDS",
  });

  // Get borrower interest rate for estimation (using current pool rate)
  const { data: borrowerRateBps } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "calculateBorrowRate",
    args: [poolAddress],
  });

  // Extract loan amount from loan data as fallback
  const approvedLoanAmount = useMemo(() => {
    if (!loanData) return null;
    if (Array.isArray(loanData)) {
      const loanAmountValue = loanData[5]; // loanAmount is at index 5
      return typeof loanAmountValue === "bigint" ? loanAmountValue : BigInt(String(loanAmountValue ?? 0));
    }
    if (typeof loanData === "object" && loanData !== null && "loanAmount" in loanData) {
      const loanAmountValue = (loanData as any).loanAmount;
      return typeof loanAmountValue === "bigint" ? loanAmountValue : BigInt(String(loanAmountValue ?? 0));
    }
    return null;
  }, [loanData]);

  // Calculate max borrowable: use getApprovedLoanAmount if available, otherwise use approved loan amount
  // All amounts are now in token units (not USD)
  const maxBorrowableFormatted = useMemo(() => {
    if (maxBorrowableAmount) {
      return parseFloat(formatUnits(maxBorrowableAmount, assetDecimals));
    }
    // Fallback to approved loan amount (already in token units)
    if (approvedLoanAmount) {
      return parseFloat(formatUnits(approvedLoanAmount, assetDecimals));
    }
    // Final fallback to maxLoanAmount prop (already in token units)
    return parseFloat(formatUnits(maxLoanAmount, assetDecimals));
  }, [maxBorrowableAmount, approvedLoanAmount, maxLoanAmount, assetDecimals]);

  // Extract loan duration from loan data
  const loanDurationBlocks =
    loanData && typeof loanData === "object" && "loanDurationBlocks" in loanData
      ? (loanData as any).loanDurationBlocks
      : null;

  const loanDurationDisplay = useMemo(() => {
    if (!loanDurationBlocks || !blockTimeSeconds) return null;
    const duration = BigInt(loanDurationBlocks.toString());
    return blocksToHumanReadable(duration, blockTimeSeconds);
  }, [loanDurationBlocks, blockTimeSeconds]);

  const amountWei = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return BigInt(0);
    try {
      return parseUnits(amount, assetDecimals);
    } catch {
      return BigInt(0);
    }
  }, [amount, assetDecimals]);

  const amountFormatted = amount ? parseFloat(amount) : 0;

  // Calculate expected interest (simplified compound interest approximation)
  const expectedInterest = useMemo(() => {
    if (!amountFormatted || !loanDurationBlocks || !borrowerRateBps || !blockTimeSeconds) return 0;

    const rateBps = Number(borrowerRateBps);
    const apr = rateBps / 100; // Convert basis points to percentage

    // Calculate blocks per year
    const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
    const blocksPerYear = SECONDS_PER_YEAR / Number(blockTimeSeconds);

    if (blocksPerYear === 0) return 0;

    // Simplified compound interest: principal * (1 + APR)^(blocks/blocksPerYear) - principal
    // For approximation, we use: principal * APR * (blocks / blocksPerYear)
    // This is a linear approximation that's close for short durations
    const interestRate = apr / 100; // Convert to decimal
    const duration = BigInt(loanDurationBlocks.toString());
    const years = Number(duration) / blocksPerYear;
    const expectedInterestAmount = amountFormatted * interestRate * years;

    return expectedInterestAmount;
  }, [amountFormatted, loanDurationBlocks, borrowerRateBps, blockTimeSeconds]);

  const interestRatePercent = borrowerRateBps ? Number(borrowerRateBps) / 100 : 0;

  const handleBorrow = async () => {
    if (!amount || parseFloat(amount) <= 0 || !approvedLoanId) return;

    try {
      setIsBorrowing(true);
      const loadingToast = notification.loading("Borrowing funds...");

      await writeUnllooAsync({
        functionName: "borrow",
        args: [approvedLoanId, amountWei],
      });

      notification.remove(loadingToast);
      notification.success("Successfully borrowed funds");

      setAmount("");
      onTransactionSuccess?.();
      onClose();
      setIsBorrowing(false);
    } catch (error: any) {
      console.error("Borrow error:", error);
      const errorMessage = error?.shortMessage || error?.message || "Failed to borrow funds";

      // Handle specific error cases
      if (errorMessage.includes("InsufficientLiquidity")) {
        notification.error("Unlloo can not process loan right now. Insufficient liquidity in pool.");
      } else if (errorMessage.includes("HasActiveLoan")) {
        notification.error("You already have an active loan. Please repay your current loan first.");
      } else if (errorMessage.includes("ApprovedLoanExpired")) {
        notification.error("This approved loan has expired. Please submit a new loan request.");
      } else {
        notification.error(errorMessage);
      }
      setIsBorrowing(false);
    }
  };

  const handleMax = () => {
    if (maxBorrowableFormatted > 0) {
      const formatted = maxBorrowableFormatted.toFixed(assetDecimals === 6 ? 6 : 4);
      setAmount(formatted);
    } else {
      console.warn("Max borrowable amount is not available:", {
        maxBorrowableFormatted,
        maxBorrowableAmount,
        approvedLoanAmount,
        maxLoanAmount,
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-base-100 rounded-xl border border-base-300 p-6 max-w-md w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-base-content">Borrow {assetSymbol}</h2>
          <button onClick={onClose} className="text-base-content/60 hover:text-base-content">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-base-content/70 mb-2">Amount ({assetSymbol})</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                step={assetDecimals === 6 ? "0.000001" : "0.0001"}
                min="0"
                max={maxBorrowableFormatted.toString()}
                className="flex-1 input input-bordered w-full"
              />
              <button
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleMax();
                }}
                disabled={maxBorrowableFormatted <= 0}
                className="btn btn-sm btn-outline"
                title={
                  maxBorrowableFormatted > 0
                    ? `Set to maximum borrowable: ${maxBorrowableFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} ${assetSymbol}`
                    : "Maximum borrowable amount not available"
                }
              >
                Max
              </button>
            </div>
            <div className="text-xs text-base-content/60 mt-1">
              Max borrowable: {maxBorrowableFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
            </div>
          </div>

          <div className="bg-base-200 rounded-lg p-4 space-y-3">
            <div className="text-sm font-semibold text-base-content mb-2">Borrow Summary</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-base-content/70">Max Loan Amount (USD):</span>
                <span className="font-medium text-base-content">${Number(maxLoanAmount).toFixed(2)}</span>
              </div>
              {loanDurationDisplay && (
                <div className="flex justify-between">
                  <span className="text-base-content/70">Loan Duration:</span>
                  <span className="font-medium text-base-content">{loanDurationDisplay}</span>
                </div>
              )}
              {interestRatePercent > 0 && (
                <div className="flex justify-between">
                  <span className="text-base-content/70">Interest Rate (APR):</span>
                  <span className="font-medium text-base-content">{interestRatePercent.toFixed(2)}%</span>
                </div>
              )}
              <div className="border-t border-base-300/50 pt-2 mt-1">
                <div className="flex justify-between">
                  <span className="text-base-content/70">Amount to Borrow:</span>
                  <span className="font-bold text-primary">
                    {amountFormatted > 0 ? amountFormatted.toFixed(assetDecimals === 6 ? 6 : 4) : "0.00"} {assetSymbol}
                  </span>
                </div>
                {amountFormatted > 0 && expectedInterest > 0 && (
                  <>
                    <div className="flex justify-between mt-1">
                      <span className="text-base-content/70">Expected Interest:</span>
                      <span className="font-medium text-warning">~${expectedInterest.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-base-content/70 font-semibold">Total to Repay (est.):</span>
                      <span className="font-bold text-primary">
                        ~${(amountFormatted + expectedInterest).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-base-content/60 italic mt-1">
                      * Interest accrues continuously. Early repayment reduces total interest paid.
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
            <p className="text-sm text-warning-content">
              Make sure you have enough balance to repay the loan plus interest. Interest accrues continuously based on
              actual borrowing time.
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline flex-1">
              Cancel
            </button>
            <button
              onClick={handleBorrow}
              disabled={
                !amount ||
                parseFloat(amount) <= 0 ||
                parseFloat(amount) > maxBorrowableFormatted ||
                isBorrowing ||
                !approvedLoanId
              }
              className="btn btn-primary flex-1"
            >
              {isBorrowing ? "Borrowing..." : "Borrow"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
