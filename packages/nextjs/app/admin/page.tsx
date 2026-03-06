"use client";

import React, { useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount, useBlockNumber, useReadContract } from "wagmi";
import {
  CheckBadgeIcon,
  CheckCircleIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { LoanDetailsModal } from "~~/components/unlloo/LoanDetailsModal";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { usePendingLoanRequests } from "~~/hooks/unlloo";
import { type LoanData, useAllLoans } from "~~/hooks/unlloo/useAllLoans";
import { notification } from "~~/utils/scaffold-eth/notification";
import { blocksToHumanReadable } from "~~/utils/unlloo/blockTime";
import { STATUS_COLORS, STATUS_LABELS } from "~~/utils/unlloo/loanStatus";

type LoanStatusFilter = "all" | 0 | 1 | 2 | 3 | 4 | 5;

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

const AdminPage: NextPage = () => {
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber();
  const [statusFilter, setStatusFilter] = useState<LoanStatusFilter>("all");
  const [processingLoanId, setProcessingLoanId] = useState<bigint | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<LoanData | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  // Check if connected wallet is admin (owner)
  const { data: contractOwner, isLoading: isLoadingOwner } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "owner",
  });

  const isAdmin = address && contractOwner && address.toLowerCase() === contractOwner.toLowerCase();
  const isCheckingAdmin = isLoadingOwner || !address;

  // Get pending loans
  const {
    loanRequests: pendingLoans,
    isLoading: isLoadingPending,
    refetch: refetchPending,
  } = usePendingLoanRequests({
    limit: 100,
    enabled: true,
  });

  // Get all loans by status
  const {
    loans: approvedLoans,
    isLoading: isLoadingApproved,
    refetch: refetchApproved,
  } = useAllLoans({
    status: 1,
    limit: 100,
    enabled: statusFilter === "all" || statusFilter === 1,
  });

  const { loans: activeLoans, isLoading: isLoadingActive } = useAllLoans({
    status: 2,
    limit: 100,
    enabled: statusFilter === "all" || statusFilter === 2,
  });

  const { loans: unpaidDebtLoans, isLoading: isLoadingUnpaid } = useAllLoans({
    status: 3,
    limit: 100,
    enabled: statusFilter === "all" || statusFilter === 3,
  });

  const {
    loans: rejectedLoans,
    isLoading: isLoadingRejected,
    refetch: refetchRejected,
  } = useAllLoans({
    status: 4,
    limit: 100,
    enabled: statusFilter === "all" || statusFilter === 4,
  });

  const { loans: repaidLoans, isLoading: isLoadingRepaid } = useAllLoans({
    status: 5,
    limit: 100,
    enabled: statusFilter === "all" || statusFilter === 5,
  });

  // Get protocol statistics
  const { data: loanCounter } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "loanCounter",
  });

  // Get block time for human-readable format
  const { data: blockTimeSeconds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "BLOCK_TIME_SECONDS",
  });

  const { writeContractAsync: writeUnllooAsync, isPending: isTransactionPending } = useScaffoldWriteContract({
    contractName: "Unlloo",
  });

  // Calculate statistics
  const stats = useMemo(() => {
    const totalPending = pendingLoans.length;
    const totalApproved = approvedLoans.length;
    const totalActive = activeLoans.length;
    const totalUnpaidDebt = unpaidDebtLoans.length;
    const totalRejected = rejectedLoans.length;
    const totalRepaid = repaidLoans.length;
    const totalLoans = totalPending + totalApproved + totalActive + totalUnpaidDebt + totalRejected + totalRepaid;

    // Calculate total borrowed amount (from active loans)
    // Principal is in token units (6 decimals for USDC)
    const totalBorrowed = activeLoans.reduce((sum, loan) => {
      if (loan.principal) {
        return sum + parseFloat(formatUnits(loan.principal, 6));
      }
      return sum;
    }, 0);

    // Calculate total repaid amount
    // amountRepaid is in token units (6 decimals for USDC)
    const totalRepaidAmount = repaidLoans.reduce((sum, loan) => {
      if (loan.amountRepaid) {
        return sum + parseFloat(formatUnits(loan.amountRepaid, 6));
      }
      return sum;
    }, 0);

    return {
      totalLoans,
      totalPending,
      totalApproved,
      totalActive,
      totalUnpaidDebt,
      totalRejected,
      totalRepaid,
      totalBorrowed,
      totalRepaidAmount,
    };
  }, [pendingLoans, approvedLoans, activeLoans, unpaidDebtLoans, rejectedLoans, repaidLoans]);

  // Get filtered loans based on status filter
  const filteredLoans = useMemo(() => {
    if (statusFilter === "all") {
      return [
        ...pendingLoans.map(l => ({ ...l, status: 0 })),
        ...approvedLoans,
        ...activeLoans,
        ...unpaidDebtLoans,
        ...repaidLoans,
      ];
    }
    switch (statusFilter) {
      case 0:
        return pendingLoans.map(l => ({ ...l, status: 0 }));
      case 1:
        return approvedLoans;
      case 2:
        return activeLoans;
      case 3:
        return unpaidDebtLoans;
      case 4:
        return rejectedLoans;
      case 5:
        return repaidLoans;
      default:
        return [];
    }
  }, [statusFilter, pendingLoans, approvedLoans, activeLoans, unpaidDebtLoans, rejectedLoans, repaidLoans]);

  const isLoading =
    isLoadingPending || isLoadingApproved || isLoadingActive || isLoadingUnpaid || isLoadingRejected || isLoadingRepaid;

  const handleApprove = async (loanId: bigint) => {
    try {
      setProcessingLoanId(loanId);
      const loadingToast = notification.loading("Approving loan request...");
      await writeUnllooAsync({
        functionName: "approveLoanRequest",
        args: [loanId],
      });
      notification.remove(loadingToast);
      notification.success("Loan request approved successfully");
      // Refetch all relevant data
      refetchPending();
      refetchApproved();
      // Invalidate queries to refresh the table
      setTimeout(() => {
        refetchPending();
        refetchApproved();
      }, 2000);
    } catch (error: any) {
      console.error("Failed to approve loan:", error);
      const errorMessage = error?.shortMessage || error?.message || "Failed to approve loan request";
      notification.error(errorMessage);
    } finally {
      setProcessingLoanId(null);
    }
  };

  const handleReject = async (loanId: bigint) => {
    try {
      setProcessingLoanId(loanId);
      const loadingToast = notification.loading("Rejecting loan request...");
      await writeUnllooAsync({
        functionName: "rejectLoanRequest",
        args: [loanId],
      });
      notification.remove(loadingToast);
      notification.success("Loan request rejected");
      // Refetch all relevant data
      refetchPending();
      refetchRejected();
      // Invalidate queries to refresh the table
      setTimeout(() => {
        refetchPending();
        refetchRejected();
      }, 2000);
    } catch (error: any) {
      console.error("Failed to reject loan:", error);
      const errorMessage = error?.shortMessage || error?.message || "Failed to reject loan request";
      notification.error(errorMessage);
    } finally {
      setProcessingLoanId(null);
    }
  };

  // Calculate blocks since request and convert to human-readable
  const getBlocksSince = (requestBlock: bigint): string => {
    if (!blockNumber || !requestBlock || !blockTimeSeconds) return "0 blocks";
    const current = BigInt(blockNumber.toString());
    const request = BigInt(requestBlock.toString());
    const blocks = current - request;
    if (blocks <= 0n) return "0 blocks";
    return blocksToHumanReadable(blocks, blockTimeSeconds);
  };

  // Show loading while checking admin status
  if (isCheckingAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // Show access denied if not admin
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-md w-full mx-4">
          <div className="bg-base-200 rounded-lg border border-base-300/50 p-8 text-center">
            <ExclamationTriangleIcon className="h-16 w-16 text-warning mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-4">Access Denied</h1>
            <p className="text-base-content/70 mb-4">This page is restricted to administrators only.</p>
            {address ? (
              <div className="mt-4">
                <p className="text-sm text-base-content/60 mb-2">Connected wallet:</p>
                <Address address={address} size="sm" />
                <p className="text-sm text-base-content/50 mt-4">
                  Please connect with an administrator wallet to access this page.
                </p>
              </div>
            ) : (
              <p className="text-sm text-base-content/50 mt-4">Please connect your wallet to continue.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen">
      {/* Header */}
      <div className="px-4 py-6 border-b border-base-300/50 bg-base-100">
        <h1 className="text-4xl font-bold mb-2">Admin Dashboard</h1>
        <p className="text-base-content/70">Manage all loan requests and monitor protocol statistics</p>
      </div>

      {/* Statistics Cards */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-base-200 rounded-lg border border-base-300/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-base-content/70 mb-1">Total Loans</p>
                <p className="text-2xl font-bold">{loanCounter?.toString() || "0"}</p>
              </div>
              <CurrencyDollarIcon className="h-8 w-8 text-primary" />
            </div>
          </div>

          <div className="bg-base-200 rounded-lg border border-base-300/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-base-content/70 mb-1">Pending Requests</p>
                <p className="text-2xl font-bold">{stats.totalPending}</p>
              </div>
              <ClockIcon className="h-8 w-8 text-warning" />
            </div>
          </div>

          <div className="bg-base-200 rounded-lg border border-base-300/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-base-content/70 mb-1">Active Loans</p>
                <p className="text-2xl font-bold">{stats.totalActive}</p>
              </div>
              <CheckBadgeIcon className="h-8 w-8 text-success" />
            </div>
          </div>

          <div className="bg-base-200 rounded-lg border border-base-300/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-base-content/70 mb-1">Unpaid Debt</p>
                <p className="text-2xl font-bold">{stats.totalUnpaidDebt}</p>
              </div>
              <ExclamationTriangleIcon className="h-8 w-8 text-error" />
            </div>
          </div>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="px-4 mb-4">
        <div className="bg-base-200 rounded-lg border border-base-300/50 p-4">
          <div className="flex flex-wrap gap-2">
            <button
              className={`btn btn-sm ${statusFilter === "all" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setStatusFilter("all")}
            >
              All ({stats.totalLoans})
            </button>
            <button
              className={`btn btn-sm ${statusFilter === 0 ? "btn-warning" : "btn-ghost"}`}
              onClick={() => setStatusFilter(0)}
            >
              Pending ({stats.totalPending})
            </button>
            <button
              className={`btn btn-sm ${statusFilter === 1 ? "btn-info" : "btn-ghost"}`}
              onClick={() => setStatusFilter(1)}
            >
              Approved ({stats.totalApproved})
            </button>
            <button
              className={`btn btn-sm ${statusFilter === 2 ? "btn-success" : "btn-ghost"}`}
              onClick={() => setStatusFilter(2)}
            >
              Active ({stats.totalActive})
            </button>
            <button
              className={`btn btn-sm ${statusFilter === 3 ? "btn-error" : "btn-ghost"}`}
              onClick={() => setStatusFilter(3)}
            >
              Unpaid Debt ({stats.totalUnpaidDebt})
            </button>
            <button
              className={`btn btn-sm ${statusFilter === 4 ? "btn-ghost" : "btn-ghost"}`}
              onClick={() => setStatusFilter(4)}
            >
              Rejected ({stats.totalRejected})
            </button>
            <button
              className={`btn btn-sm ${statusFilter === 5 ? "btn-success" : "btn-ghost"}`}
              onClick={() => setStatusFilter(5)}
            >
              Repaid ({stats.totalRepaid})
            </button>
          </div>
        </div>
      </div>

      {/* Loans Table */}
      <div className="w-full h-[calc(100vh-300px)] flex flex-col">
        <div className="px-4 py-4 bg-base-100 border-b border-base-300/50">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">
              {statusFilter === "all" ? "All Loans" : STATUS_LABELS[statusFilter as number]} ({filteredLoans.length})
            </h2>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {filteredLoans.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-base-content/60 text-lg">No loans found</p>
                <p className="text-base-content/40 text-sm mt-2">
                  {statusFilter === "all"
                    ? "No loans in the system"
                    : `No ${STATUS_LABELS[statusFilter as number]} loans`}
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="table w-full table-pin-rows">
                <thead>
                  <tr>
                    <th>Loan ID</th>
                    <th>Status</th>
                    <th>Borrower</th>
                    <th>Reputation</th>
                    <th>Requested Amount</th>
                    <th>Requested Duration</th>
                    <th>Borrowed</th>
                    <th>Repaid</th>
                    <th>Request Block</th>
                    <th>Time Since</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLoans.map(loan => {
                    const isProcessing = processingLoanId === loan.loanId || isTransactionPending;
                    const loanId = loan.loanId?.toString() || "N/A";
                    // loanAmount is in token units (6 decimals for USDC)
                    const selectedAmountTokenUnits = loan.loanAmount ? BigInt(loan.loanAmount.toString()) : 0n;
                    const selectedAssetAmount =
                      selectedAmountTokenUnits > 0n ? Number(selectedAmountTokenUnits) / 10 ** 6 : 0;
                    const selectedDuration = loan.loanDurationBlocks ? Number(loan.loanDurationBlocks) : 0;
                    // Principal and amountRepaid are in token units (6 decimals for USDC)
                    const principalFormatted = loan.principal ? parseFloat(formatUnits(loan.principal, 6)) : 0;
                    const amountRepaidFormatted = loan.amountRepaid ? parseFloat(formatUnits(loan.amountRepaid, 6)) : 0;
                    const requestBlock = loan.requestBlock?.toString() || "0";
                    const blocksSince = getBlocksSince(loan.requestBlock || 0n);
                    const status = loan.status ?? 0;

                    return (
                      <tr key={loanId} className="hover:bg-base-300/30">
                        <td>
                          <div className="font-mono font-semibold">#{loanId}</div>
                        </td>
                        <td>
                          <div className={`badge ${STATUS_COLORS[status] || "badge-ghost"}`}>
                            {STATUS_LABELS[status] || "Unknown"}
                          </div>
                        </td>
                        <td>
                          <Address address={loan.borrower} size="sm" />
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{loan.walletReputation ?? 0}</span>
                            <div
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
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">
                              {selectedAssetAmount > 0 ? (
                                `${selectedAssetAmount.toFixed(2)}`
                              ) : (
                                <span className="text-base-content/50">—</span>
                              )}
                            </span>
                            {loan.token && <TokenSymbolDisplay tokenAddress={loan.token} />}
                          </div>
                        </td>
                        <td>
                          <div className="font-mono text-xs">
                            {selectedDuration > 0 && blockTimeSeconds ? (
                              blocksToHumanReadable(BigInt(selectedDuration), blockTimeSeconds)
                            ) : selectedDuration > 0 ? (
                              `${selectedDuration} blocks`
                            ) : (
                              <span className="text-base-content/50">—</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="font-semibold">
                            {principalFormatted > 0 ? (
                              `${principalFormatted.toFixed(2)}`
                            ) : (
                              <span className="text-base-content/50">—</span>
                            )}
                          </span>
                        </td>
                        <td>
                          <span className="font-mono">
                            {amountRepaidFormatted > 0 ? (
                              `${amountRepaidFormatted.toFixed(2)}`
                            ) : (
                              <span className="text-base-content/50">—</span>
                            )}
                          </span>
                        </td>
                        <td>
                          <span className="font-mono text-sm">{requestBlock}</span>
                        </td>
                        <td>
                          <span className="text-sm">{blocksSince}</span>
                        </td>
                        <td>
                          <div className="flex gap-2">
                            <button
                              className="btn btn-info btn-sm"
                              onClick={() => {
                                setSelectedLoan(loan as LoanData);
                                setIsDetailsModalOpen(true);
                              }}
                            >
                              <InformationCircleIcon className="h-4 w-4" />
                              Details
                            </button>
                            {loan.status === 0 && (
                              <>
                                <button
                                  className="btn btn-success btn-sm"
                                  onClick={() => handleApprove(loan.loanId)}
                                  disabled={isProcessing || isTransactionPending}
                                >
                                  {isProcessing && processingLoanId === loan.loanId ? (
                                    <span className="loading loading-spinner loading-xs"></span>
                                  ) : (
                                    <CheckCircleIcon className="h-4 w-4" />
                                  )}
                                  Approve
                                </button>
                                <button
                                  className="btn btn-error btn-sm"
                                  onClick={() => handleReject(loan.loanId)}
                                  disabled={isProcessing || isTransactionPending}
                                >
                                  {isProcessing && processingLoanId === loan.loanId ? (
                                    <span className="loading loading-spinner loading-xs"></span>
                                  ) : (
                                    <XMarkIcon className="h-4 w-4" />
                                  )}
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Loan Details Modal */}
      {selectedLoan && (
        <LoanDetailsModal
          loan={selectedLoan}
          isOpen={isDetailsModalOpen}
          onClose={() => {
            setIsDetailsModalOpen(false);
            setSelectedLoan(null);
          }}
        />
      )}
    </div>
  );
};

export default AdminPage;
