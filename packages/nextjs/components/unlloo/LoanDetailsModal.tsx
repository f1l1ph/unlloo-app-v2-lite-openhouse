"use client";

import React, { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { formatUnits } from "viem";
import { useBlockNumber, useReadContract } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { type LoanData } from "~~/hooks/unlloo/useAllLoans";
import { type LoanDetails, getLoanDetails } from "~~/services/api/loan.service";
import { blockDifferenceToHumanReadable, blocksToHumanReadable } from "~~/utils/unlloo/blockTime";
import { STATUS_COLORS, STATUS_LABELS } from "~~/utils/unlloo/loanStatus";

// Component to fetch and display token symbol
const TokenSymbolDisplay: React.FC<{ tokenAddress: string }> = ({ tokenAddress }) => {
  const { data: symbol } = useReadContract({
    address: tokenAddress as `0x${string}`,
    abi: [
      {
        inputs: [],
        name: "symbol",
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
      },
    ],
    functionName: "symbol",
    query: {
      enabled: !!tokenAddress && tokenAddress !== "0x0000000000000000000000000000000000000000",
    },
  });

  if (!symbol) {
    return <span className="text-base-content/50">—</span>;
  }

  return <span className="text-sm text-base-content/70">{symbol}</span>;
};

interface LoanDetailsModalProps {
  loan: LoanData;
  isOpen: boolean;
  onClose: () => void;
}

export const LoanDetailsModal: React.FC<LoanDetailsModalProps> = ({ loan, isOpen, onClose }) => {
  const { data: blockNumber } = useBlockNumber();
  const [loanDetails, setLoanDetails] = useState<LoanDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Get block time for human-readable format
  const { data: blockTimeSeconds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "BLOCK_TIME_SECONDS",
  });

  // Fetch loan details from Supabase when modal opens
  useEffect(() => {
    if (isOpen && loan.loanId) {
      setIsLoadingDetails(true);
      setDetailsError(null);
      getLoanDetails(loan.loanId)
        .then(details => {
          setLoanDetails(details);
        })
        .catch(error => {
          console.error("Failed to fetch loan details:", error);
          setDetailsError(error.message || "Failed to load loan details");
        })
        .finally(() => {
          setIsLoadingDetails(false);
        });
    }
  }, [isOpen, loan.loanId]);

  if (!isOpen) return null;

  // Check if loan has been borrowed (principal > 0)
  const hasBorrowed = loan.principal !== undefined && loan.principal > 0n;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <button className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={onClose}>
          <XMarkIcon className="h-4 w-4" />
        </button>

        <h3 className="font-bold text-lg mb-4">Loan Details #{loan.loanId?.toString()}</h3>

        <div className="space-y-4">
          {/* Status & Basic Info */}
          <div className="bg-base-200 rounded-lg p-4">
            <h4 className="font-semibold text-base mb-3">Basic Information</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-base-content/70">Status:</span>
                <span className={`badge ${STATUS_COLORS[loan.status] || "badge-ghost"}`}>
                  {STATUS_LABELS[loan.status] || "Unknown"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-base-content/70">Loan ID:</span>
                <span className="font-mono font-semibold">#{loan.loanId?.toString()}</span>
              </div>
              <div className="flex justify-between col-span-2">
                <span className="text-base-content/70">Borrower:</span>
                <Address address={loan.borrower} size="sm" />
              </div>
              <div className="flex justify-between">
                <span className="text-base-content/70">Reputation:</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{loan.walletReputation ?? 0}</span>
                  <span
                    className={`badge badge-sm ${
                      (loan.walletReputation ?? 0) >= 400
                        ? "badge-success"
                        : (loan.walletReputation ?? 0) >= 200
                          ? "badge-warning"
                          : "badge-error"
                    }`}
                  >
                    {(loan.walletReputation ?? 0) >= 400
                      ? "High"
                      : (loan.walletReputation ?? 0) >= 200
                        ? "Medium"
                        : "Low"}
                  </span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-base-content/70">Chain ID:</span>
                <span className="font-mono">{loan.chainId?.toString() || "—"}</span>
              </div>
            </div>
          </div>

          {/* Loan Request Details */}
          <div className="bg-base-200 rounded-lg p-4">
            <h4 className="font-semibold text-base mb-3">Loan Request</h4>
            {isLoadingDetails ? (
              <div className="flex justify-center py-4">
                <span className="loading loading-spinner loading-sm"></span>
              </div>
            ) : detailsError ? (
              <div className="text-error text-sm">{detailsError}</div>
            ) : (
              <div className="space-y-3">
                {/* Contact Information */}
                {loanDetails && (
                  <div className="grid grid-cols-2 gap-3 text-sm pb-3 border-b border-base-300">
                    <div className="flex justify-between col-span-2">
                      <span className="text-base-content/70">Email:</span>
                      <span className="font-mono text-xs">{loanDetails.email || "—"}</span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span className="text-base-content/70">Telegram:</span>
                      <span className="font-mono text-xs">{loanDetails.telegramHandle || "—"}</span>
                    </div>
                    <div className="col-span-2">
                      <div className="text-base-content/70 text-sm mb-2">Loan Reason:</div>
                      <div className="text-sm bg-base-300 rounded p-3 max-h-30 overflow-y-auto whitespace-pre-wrap wrap-break-word">
                        {loanDetails.reason || "—"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Financial Information */}
                {loanDetails && (
                  <div className="grid grid-cols-2 gap-3 text-sm pb-3 border-b border-base-300">
                    <div className="flex justify-between">
                      <span className="text-base-content/70">Source of Income:</span>
                      <span className="font-semibold">{loanDetails.sourceOfIncome || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/70">Yearly Income:</span>
                      <span className="font-semibold">
                        {loanDetails.incomeYearlyUsd ? `$${Number(loanDetails.incomeYearlyUsd).toLocaleString()}` : "—"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Blockchain Request Details */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-base-content/70">Requested Amount:</span>
                    <span className="font-semibold">
                      {loan.loanAmount ? `${(Number(loan.loanAmount) / 10 ** 6).toFixed(2)} USDC` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base-content/70">Requested Duration:</span>
                    <span className="font-mono">
                      {loan.loanDurationBlocks && blockTimeSeconds
                        ? blocksToHumanReadable(loan.loanDurationBlocks, blockTimeSeconds)
                        : loan.loanDurationBlocks
                          ? `${loan.loanDurationBlocks.toString()} blocks`
                          : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base-content/70">Request Block:</span>
                    <span className="font-mono">{loan.requestBlock?.toString() || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base-content/70">Time Since Request:</span>
                    <span className="text-sm">
                      {loan.requestBlock && blockNumber && blockTimeSeconds
                        ? blockDifferenceToHumanReadable(
                            loan.requestBlock,
                            BigInt(blockNumber.toString()),
                            blockTimeSeconds,
                          )
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Active Loan Details (if borrowed) */}
          {hasBorrowed && (
            <div className="bg-base-200 rounded-lg p-4">
              <h4 className="font-semibold text-base mb-3">Active Loan Details</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/70">Principal Borrowed:</span>
                  <span className="font-semibold">{formatUnits(loan.principal, 6)} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Amount Repaid:</span>
                  <span className="font-semibold">
                    {loan.amountRepaid ? formatUnits(loan.amountRepaid, 6) : "0"} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Protocol Fee:</span>
                  <span className="font-mono">{loan.protocolFee ? formatUnits(loan.protocolFee, 6) : "0"} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Fee Rate at Borrow:</span>
                  <span className="font-mono">
                    {loan.protocolFeePercentageAtBorrow
                      ? `${(Number(loan.protocolFeePercentageAtBorrow) / 100).toFixed(2)}%`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Start Block:</span>
                  <span className="font-mono">{loan.startBlock?.toString() || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Deadline Block:</span>
                  <span className="font-mono">{loan.deadlineBlock?.toString() || "—"}</span>
                </div>
                {loan.approvalBlock && loan.approvalBlock > 0n && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-base-content/70">Approval Block:</span>
                      <span className="font-mono">{loan.approvalBlock.toString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/70">Time Since Approval:</span>
                      <span className="text-sm">
                        {blockNumber && blockTimeSeconds
                          ? blockDifferenceToHumanReadable(
                              loan.approvalBlock,
                              BigInt(blockNumber.toString()),
                              blockTimeSeconds,
                            )
                          : "—"}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Token Info */}
          <div className="bg-base-200 rounded-lg p-4">
            <h4 className="font-semibold text-base mb-3">Token Information</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between col-span-2">
                <span className="text-base-content/70">Token Address:</span>
                {loan.token ? <Address address={loan.token} size="sm" /> : <span>—</span>}
              </div>
              <div className="flex justify-between">
                <span className="text-base-content/70">Token Symbol:</span>
                {loan.token ? <TokenSymbolDisplay tokenAddress={loan.token} /> : <span>—</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
};
