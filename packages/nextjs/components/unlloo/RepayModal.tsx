"use client";

import React, { useMemo, useState } from "react";
import { Address, formatUnits, maxUint256, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useBalance } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth/notification";

interface RepayModalProps {
  isOpen: boolean;
  onClose: () => void;
  loanId: number;
  assetSymbol: string;
  assetDecimals: number;
  remainingBalance: bigint;
  onTransactionSuccess?: () => void;
}

/**
 * Modal component for repaying a loan (partial or full)
 */
export const RepayModal: React.FC<RepayModalProps> = ({
  isOpen,
  onClose,
  loanId,
  assetSymbol,
  assetDecimals,
  remainingBalance,
  onTransactionSuccess,
}) => {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [isRepaying, setIsRepaying] = useState(false);
  const { writeContractAsync: writeUnllooAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });
  const { writeContractAsync: writeTokenAsync } = useWriteContract();

  // Get loan data to find the token address
  const { data: loanData } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoan",
    args: [BigInt(loanId)],
  });

  // Extract token address from loan data
  const tokenAddress = useMemo(() => {
    if (!loanData) return undefined;
    // loanData is a struct, token is at index 11 (0-indexed)
    // Struct order: loanId(0), borrower(1), status(2), walletReputation(3),
    // maxLoanAmount(4), loanAmount(5), maxLoanDurationBlocks(6), loanDurationBlocks(7),
    // chainId(8), requestBlock(9), approvalBlock(10), token(11), ...
    if (Array.isArray(loanData)) {
      return loanData[11] as Address | undefined;
    }
    // If it's an object (viem format)
    if (typeof loanData === "object" && loanData !== null && "token" in loanData) {
      return (loanData as any).token as Address | undefined;
    }
    return undefined;
  }, [loanData]);

  // Get token balance
  const { data: tokenBalance } = useBalance({
    address,
    token: tokenAddress,
  });

  // Get Unlloo contract address for approval
  const { data: deployedContract } = useDeployedContractInfo({ contractName: "Unlloo" });
  const unllooAddress = deployedContract?.address;

  // Read allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress,
    abi: [
      {
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
      {
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ],
    functionName: "allowance",
    args: address && unllooAddress ? [address, unllooAddress as Address] : undefined,
    query: {
      enabled: !!address && !!unllooAddress && !!tokenAddress,
    },
  });

  // Get current remaining balance (may have changed due to interest accrual)
  const { data: currentRemainingBalance, refetch: refetchRemainingBalance } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getRemainingBalance",
    args: [BigInt(loanId)],
  });

  // Get accrued interest for breakdown
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

  // Extract principal from loan data
  const principal = useMemo(() => {
    if (!loanData) return 0n;
    if (Array.isArray(loanData)) {
      const principalValue = loanData[12]; // principal is at index 12
      return typeof principalValue === "bigint" ? principalValue : BigInt(String(principalValue ?? 0));
    }
    if (typeof loanData === "object" && loanData !== null && "principal" in loanData) {
      const principalValue = (loanData as any).principal;
      return typeof principalValue === "bigint" ? principalValue : BigInt(String(principalValue ?? 0));
    }
    return 0n;
  }, [loanData]);

  const effectiveRemainingBalance = currentRemainingBalance ?? remainingBalance;

  // Calculate interest breakdown
  const principalFormatted = parseFloat(formatUnits(principal, assetDecimals));
  const accruedInterestFormatted = parseFloat(formatUnits(accruedInterest || 0n, assetDecimals));
  const interestRatePercent = borrowerRateBps ? Number(borrowerRateBps) / 100 : 0; // Convert basis points to percentage

  const balance = tokenBalance ? parseFloat(formatUnits(tokenBalance.value, assetDecimals)) : 0;
  const remainingBalanceFormatted = parseFloat(formatUnits(effectiveRemainingBalance, assetDecimals));
  const isFullyRepaid = effectiveRemainingBalance === 0n || remainingBalanceFormatted <= 0;

  const amountWei = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return BigInt(0);
    try {
      return parseUnits(amount, assetDecimals);
    } catch {
      return BigInt(0);
    }
  }, [amount, assetDecimals]);

  const needsApproval = allowance !== undefined && amountWei > 0 && allowance < amountWei;
  const isAmountValid = amountWei > 0 && amountWei <= effectiveRemainingBalance;
  const isBalanceSufficient = amountWei <= (tokenBalance?.value ?? 0n);

  // Reset form when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setAmount("");
      refetchRemainingBalance();
    }
  }, [isOpen, refetchRemainingBalance]);

  const handleApprove = async () => {
    if (!address || !unllooAddress || !tokenAddress) return;

    try {
      setIsApproving(true);
      await writeTokenAsync({
        address: tokenAddress,
        abi: [
          {
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            name: "approve",
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "approve",
        args: [unllooAddress as Address, maxUint256],
      });
      await refetchAllowance();
      setIsApproving(false);
      notification.success("Token approval successful");
    } catch (error: any) {
      console.error("Approval error:", error);
      notification.error(error?.shortMessage || error?.message || "Failed to approve token");
      setIsApproving(false);
    }
  };

  const handleRepay = async () => {
    if (!amount || parseFloat(amount) <= 0 || !address || !isAmountValid) return;

    try {
      setIsRepaying(true);
      const loadingToast = notification.loading("Processing repayment...");

      // CRITICAL: Refetch balance right before transaction to get latest interest accrual
      // This handles the race condition where interest accrues between reading balance and executing transaction
      await refetchRemainingBalance();
      const latestBalance = currentRemainingBalance ?? remainingBalance;

      // Recalculate amountWei with the latest balance
      // If user clicked "max" and balance increased, update to latest balance
      let finalAmountWei = amountWei;

      // Check if the amount matches the old remaining balance (user likely clicked "max")
      // If so, and the balance has increased, update to the latest balance
      if (amountWei === effectiveRemainingBalance && latestBalance > effectiveRemainingBalance) {
        // User intended to repay full amount, use latest balance
        const userBalanceWei = tokenBalance?.value ?? 0n;
        finalAmountWei = latestBalance < userBalanceWei ? latestBalance : userBalanceWei;

        // Update the input field to reflect the new amount
        setAmount(formatUnits(finalAmountWei, assetDecimals));
      } else if (amountWei > latestBalance) {
        // Amount exceeds latest balance, cap it to latest balance
        finalAmountWei = latestBalance;
        setAmount(formatUnits(finalAmountWei, assetDecimals));
      }

      // Check if approval is needed with the final amount
      const needsApprovalFinal = allowance !== undefined && finalAmountWei > 0 && allowance < finalAmountWei;

      if (needsApprovalFinal) {
        // Call handleApprove which handles its own errors
        await handleApprove();

        // Wait a bit for the transaction to be mined and state to update
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Refetch allowance to verify approval succeeded
        const allowanceResult = await refetchAllowance();
        const updatedAllowance = allowanceResult.data;

        // Check if approval was successful
        if (updatedAllowance === undefined || updatedAllowance < finalAmountWei) {
          notification.remove(loadingToast);
          setIsRepaying(false);
          notification.error("Token approval failed or insufficient. Please approve the token first.");
          return;
        }
      }

      // Repay with the latest amount (contract will cap at totalDue if needed)
      await writeUnllooAsync({
        functionName: "repay",
        args: [BigInt(loanId), finalAmountWei],
      });

      notification.remove(loadingToast);
      notification.success("Repayment successful");

      setAmount("");
      onTransactionSuccess?.();
      onClose();
      setIsRepaying(false);
    } catch (error: any) {
      console.error("Repay error:", error);
      const errorMessage = error?.shortMessage || error?.message || "Failed to repay loan";

      // Handle specific error cases
      if (errorMessage.includes("InvalidLoanStatus")) {
        notification.error("This loan is not in a valid state for repayment. It may have already been repaid.");
      } else if (errorMessage.includes("InvalidAmount")) {
        notification.error("Invalid repayment amount. Please check the amount and try again.");
      } else if (errorMessage.includes("InsufficientBalance") || errorMessage.includes("insufficient")) {
        notification.error("Insufficient token balance. Please ensure you have enough tokens to repay.");
      } else if (errorMessage.includes("onlyBorrower")) {
        notification.error("Only the borrower can repay this loan.");
      } else {
        notification.error(errorMessage);
      }
      setIsRepaying(false);
    }
  };

  const handleMax = async () => {
    // CRITICAL: Refetch balance first to get latest interest accrual
    // This handles the race condition where interest accrues between reading and executing
    await refetchRemainingBalance();
    const latestBalance = currentRemainingBalance ?? remainingBalance;

    // Use bigint values directly to avoid precision loss from float conversion
    // Calculate max repayable amount (minimum of remaining balance and user balance)
    const userBalanceWei = tokenBalance?.value ?? 0n;
    const maxAmountWei = latestBalance < userBalanceWei ? latestBalance : userBalanceWei;

    if (maxAmountWei > 0n) {
      // Use formatUnits to convert bigint to string with exact precision
      // This avoids rounding errors from toFixed()
      const maxAmountFormatted = formatUnits(maxAmountWei, assetDecimals);
      setAmount(maxAmountFormatted);
    }
  };

  if (!isOpen) return null;

  const amountFormatted = amount ? parseFloat(amount) : 0;
  const isFullRepayment = amountFormatted > 0 && Math.abs(amountFormatted - remainingBalanceFormatted) < 0.01;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-base-100 rounded-xl border border-base-300 p-6 max-w-md w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-base-content">Repay Loan #{loanId}</h2>
          <button onClick={onClose} className="text-base-content/60 hover:text-base-content">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Loan Summary */}
          <div className="bg-base-200 rounded-lg p-4 space-y-2">
            {isFullyRepaid ? (
              <div className="bg-success/10 border border-success/20 rounded-lg p-3">
                <div className="text-sm font-semibold text-success mb-1">Loan Fully Repaid</div>
                <div className="text-xs text-success/70">This loan has been fully repaid.</div>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-base-content/70">Remaining Balance:</span>
                  <span className="font-bold text-primary">
                    {remainingBalanceFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
                  </span>
                </div>
                <div className="border-t border-base-300/50 pt-2 mt-2 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-base-content/60">Principal:</span>
                    <span className="font-medium text-base-content">
                      {principalFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-base-content/60">Accrued Interest:</span>
                    <span className="font-medium text-warning">
                      {accruedInterestFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
                    </span>
                  </div>
                  {interestRatePercent > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-base-content/60">Interest Rate (APR):</span>
                      <span className="font-medium text-base-content">{interestRatePercent.toFixed(2)}%</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-base-300/50">
                  <span className="text-base-content/70">Your Balance:</span>
                  <span className="font-medium text-base-content">
                    {balance.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Amount Input */}
          {!isFullyRepaid && (
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">
                Repayment Amount ({assetSymbol})
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  step={assetDecimals === 6 ? "0.000001" : "0.0001"}
                  min="0"
                  max={Math.min(remainingBalanceFormatted, balance).toString()}
                  className={`flex-1 input input-bordered w-full ${!isAmountValid && amount ? "input-error" : ""}`}
                />
                <button onClick={handleMax} className="btn btn-sm btn-outline" title="Set to maximum repayable amount">
                  Full
                </button>
              </div>
              <div className="text-xs text-base-content/60 mt-1">
                {amount ? (
                  <>
                    {isAmountValid ? (
                      <span>
                        Repaying: {amountFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
                        {isFullRepayment && " (Full repayment)"}
                      </span>
                    ) : (
                      <span className="text-error">
                        Amount must be between 0 and {remainingBalanceFormatted.toFixed(assetDecimals === 6 ? 6 : 4)}{" "}
                        {assetSymbol}
                      </span>
                    )}
                  </>
                ) : (
                  <span>Enter amount to repay</span>
                )}
              </div>
            </div>
          )}

          {/* Repayment Summary */}
          {!isFullyRepaid && amountFormatted > 0 && isAmountValid && (
            <div className="bg-info/10 border border-info/20 rounded-lg p-3 space-y-2">
              <div className="text-sm font-semibold text-info-content mb-2">Repayment Summary</div>
              <div className="flex justify-between text-sm">
                <span className="text-base-content/70">Amount to Repay:</span>
                <span className="font-bold text-primary">
                  {amountFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
                </span>
              </div>
              {/* Interest breakdown for repayment */}
              {accruedInterestFormatted > 0 && (
                <div className="border-t border-info/20 pt-2 mt-1 space-y-1">
                  <div className="text-xs text-base-content/60 mb-1">Payment Breakdown:</div>
                  <div className="flex justify-between text-xs">
                    <span className="text-base-content/60">Interest portion (est.):</span>
                    <span className="font-medium text-warning">
                      {Math.min(amountFormatted, accruedInterestFormatted).toFixed(assetDecimals === 6 ? 6 : 4)}{" "}
                      {assetSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-base-content/60">Principal portion (est.):</span>
                    <span className="font-medium text-base-content">
                      {Math.max(0, amountFormatted - accruedInterestFormatted).toFixed(assetDecimals === 6 ? 6 : 4)}{" "}
                      {assetSymbol}
                    </span>
                  </div>
                  <div className="text-xs text-base-content/50 italic mt-1">
                    Note: Interest is paid first, then principal
                  </div>
                </div>
              )}
              {!isFullRepayment && (
                <div className="flex justify-between text-sm pt-1 border-t border-info/20">
                  <span className="text-base-content/70">Remaining After Repayment:</span>
                  <span className="font-medium text-base-content">
                    {(remainingBalanceFormatted - amountFormatted).toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
                  </span>
                </div>
              )}
              {isFullRepayment && <div className="text-xs text-success mt-1">✓ This will fully repay your loan</div>}
            </div>
          )}

          {/* Warnings */}
          {!isFullyRepaid && !isBalanceSufficient && amountFormatted > 0 && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3">
              <p className="text-sm text-error">
                Insufficient balance. You need {amountFormatted.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol} but
                only have {balance.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}.
              </p>
            </div>
          )}

          {!isFullyRepaid && needsApproval && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-sm text-warning-content">
                You need to approve {assetSymbol} before repaying. Click `Approve` first, then `Repay`.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline flex-1" disabled={isRepaying || isApproving}>
              {isFullyRepaid ? "Close" : "Cancel"}
            </button>
            {!isFullyRepaid && (
              <>
                {needsApproval ? (
                  <button
                    onClick={handleApprove}
                    disabled={
                      isApproving ||
                      !amount ||
                      parseFloat(amount) <= 0 ||
                      !isAmountValid ||
                      !isBalanceSufficient ||
                      isRepaying
                    }
                    className="btn btn-warning flex-1"
                  >
                    {isApproving ? "Approving..." : "Approve"}
                  </button>
                ) : (
                  <button
                    onClick={handleRepay}
                    disabled={
                      !amount ||
                      parseFloat(amount) <= 0 ||
                      !isAmountValid ||
                      !isBalanceSufficient ||
                      isRepaying ||
                      !tokenAddress
                    }
                    className="btn btn-primary flex-1"
                  >
                    {isRepaying ? "Repaying..." : isFullRepayment ? "Repay Full Amount" : "Repay"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
