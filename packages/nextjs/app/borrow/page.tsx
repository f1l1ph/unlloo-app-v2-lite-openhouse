"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NextPage } from "next";
import { parseUnits } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { ErrorBoundary } from "~~/components/ErrorBoundary";
import { BorrowModal, LoanCard, LoanRequestModal, RepayModal, ReputationDisplay } from "~~/components/unlloo";
import { AuthGuard } from "~~/components/unlloo/AuthGuard";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useReputationLoan, useReputationLoanDetails, useUnllooLoans } from "~~/hooks/unlloo";
import { useAvailableTokens } from "~~/utils/unlloo";
import {
  blockDifferenceToHumanReadable,
  blocksRemainingToHumanReadable,
  blocksToDays,
  blocksToHumanReadable,
} from "~~/utils/unlloo/blockTime";

// USDC has 6 decimals
const USDC_DECIMALS = 6;

const BorrowPage: NextPage = () => {
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { address: connectedAddress } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { data: blockNumber } = useBlockNumber();
  const [isCalculating, setIsCalculating] = useState(false);
  const [showLoanRequestModal, setShowLoanRequestModal] = useState(false);
  const [showBorrowModal, setShowBorrowModal] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false);
  const [selectedLoanId, setSelectedLoanId] = useState<bigint | undefined>(undefined);
  const [selectedRepayLoanId, setSelectedRepayLoanId] = useState<number | undefined>(undefined);
  const [selectedRepayLoanRemainingBalance, setSelectedRepayLoanRemainingBalance] = useState<bigint | undefined>(
    undefined,
  );

  // Reputation hooks (from API) - only fetch when user is signed in
  // The hooks have multiple safeguards to prevent API calls when address is undefined
  const {
    reputation,
    maxAmount,
    maxLoanDuration,
    recommendedRate,
    lastUpdatedBlockNumber,
    isBlocked,
    calculateReputation,
    data: reputationData,
  } = useReputationLoan(connectedAddress || undefined, {
    enabled: Boolean(connectedAddress), // Explicitly disable if not signed in
  });

  // Detailed reputation data (with metrics and breakdown) - only fetch when user is signed in
  const {
    metrics: reputationMetrics,
    multiChain: multiChainData,
    isLoading: isDetailsLoading,
    refetch: refetchDetails,
    data: reputationDetailsData,
  } = useReputationLoanDetails(connectedAddress || undefined, {
    enabled: Boolean(connectedAddress), // Explicitly disable if not signed in
  });

  // Loans hooks - useUnllooLoans already fetches all loan details for the borrower
  // This avoids duplicate RPC calls from useAllLoans
  const {
    activeLoans,
    pendingLoans: borrowerPendingLoansFromHook,
    approvedLoans: borrowerApprovedLoansFromHook,
  } = useUnllooLoans();

  // Get available tokens
  const availableTokens = useAvailableTokens();

  // Get all loans for this borrower (only used for refetch, not for data since useUnllooLoans provides it)
  const { refetch: refetchLoans } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoansByBorrower",
    args: connectedAddress ? ([connectedAddress] as any) : undefined,
    watch: false,
    query: {
      enabled: false, // Disable automatic fetching since useUnllooLoans handles it
    },
  });

  // Check if user can submit a request (cooldown, active loans, etc.)
  const { data: canSubmitRequest } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "canSubmitRequest",
    args: connectedAddress ? ([connectedAddress] as any) : undefined,
    watch: false,
    query: {
      staleTime: 30000, // Cache for 30 seconds to reduce RPC calls
    },
  });

  // Get last request block to check if user has ever submitted
  const { data: lastRequestBlock } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "lastRequestBlock",
    args: connectedAddress ? ([connectedAddress] as any) : undefined,
    watch: false,
    query: {
      staleTime: 30000, // Cache for 30 seconds to reduce RPC calls
    },
  });

  // Get cooldown end block
  const { data: cooldownEndBlock } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getCooldownEndBlock",
    args: connectedAddress ? ([connectedAddress] as any) : undefined,
    watch: false,
    query: {
      staleTime: 30000, // Cache for 30 seconds to reduce RPC calls
    },
  });

  // Get block time to calculate time remaining (static value, cache for longer)
  const { data: blockTimeSeconds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "blockTimeSeconds",
    watch: false,
    query: {
      staleTime: 300000, // Cache for 5 minutes since this is a constant
    },
  });

  // Calculate time remaining in cooldown
  // Only show cooldown if lastRequestBlock > 0 (user has submitted before)
  const cooldownTimeRemaining = useMemo(() => {
    // If lastRequestBlock is 0, user never submitted, so no cooldown
    if (!lastRequestBlock || BigInt(lastRequestBlock.toString()) === 0n) return null;

    if (!cooldownEndBlock || !blockNumber || !blockTimeSeconds) return null;
    const endBlock = BigInt(cooldownEndBlock.toString());
    const current = BigInt(blockNumber.toString());
    if (current >= endBlock) return null; // Cooldown expired

    const blocksRemaining = endBlock - current;
    const humanReadable = blocksRemainingToHumanReadable(blocksRemaining, blockTimeSeconds);

    return { blocksRemaining: Number(blocksRemaining), humanReadable };
  }, [lastRequestBlock, cooldownEndBlock, blockNumber, blockTimeSeconds]);

  // Determine if cooldown is actually active (user submitted before AND cooldown hasn't expired)
  const isCooldownActive = useMemo(() => {
    if (!lastRequestBlock || BigInt(lastRequestBlock.toString()) === 0n) return false;
    if (!cooldownEndBlock || !blockNumber) return false;
    const endBlock = BigInt(cooldownEndBlock.toString());
    const current = BigInt(blockNumber.toString());
    return current < endBlock;
  }, [lastRequestBlock, cooldownEndBlock, blockNumber]);

  // Get pending loans (status = 0) - only used for refetch, data comes from useUnllooLoans
  const { refetch: refetchPendingLoans } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoansByStatus",
    args: [0 as any, 0n, 100n], // status = Pending (0), offset = 0, limit = 100
    watch: false,
    query: {
      enabled: false, // Disable automatic fetching to reduce RPC calls
    },
  });

  // Get approved loans (status = 1) - only used for refetch, data comes from useUnllooLoans
  const { refetch: refetchApprovedLoans } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoansByStatus",
    args: [1 as any, 0n, 100n], // status = Approved (1), offset = 0, limit = 100
    watch: false,
    query: {
      enabled: false, // Disable automatic fetching to reduce RPC calls
    },
  });

  // Fetch loan events (watch disabled to reduce RPC spam - updates rely on transaction callbacks)
  // Note: Real-time updates happen via transaction success callbacks instead
  // Limit to very recent blocks (last ~5k blocks or ~1.5 days) to prevent timeout errors
  // This is only used to detect events for the connected address, not for full history
  // If events are older than this, they'll be picked up by transaction callbacks anyway
  // DISABLED: These hooks cause too many timeout errors. Transaction callbacks handle all updates.
  // const recentBlockRange = blockNumber && blockNumber > 5000n ? blockNumber - 5000n : 0n;
  // const { data: loanRequestEvents } = useScaffoldEventHistory({
  //   contractName: "Unlloo",
  //   eventName: "LoanRequestSubmitted",
  //   fromBlock: recentBlockRange,
  //   watch: false,
  //   enabled: false, // Disabled to prevent timeout errors - transaction callbacks handle updates
  //   blocksBatchSize: 2000,
  // });

  // const { data: loanApprovedEvents } = useScaffoldEventHistory({
  //   contractName: "Unlloo",
  //   eventName: "LoanRequestApproved",
  //   fromBlock: recentBlockRange,
  //   watch: false,
  //   enabled: false, // Disabled to prevent timeout errors - transaction callbacks handle updates
  //   blocksBatchSize: 2000,
  // });

  // Mock empty arrays since hooks are disabled
  // Wrap in useMemo to prevent dependency changes on every render
  const loanRequestEvents: any[] = useMemo(() => [], []);
  const loanApprovedEvents: any[] = useMemo(() => [], []);

  // Refetch when new loan request events are detected for the connected address
  // This is needed to update canSubmitRequest status immediately after submission
  useEffect(() => {
    if (loanRequestEvents && loanRequestEvents.length > 0 && connectedAddress) {
      const latestEvent = loanRequestEvents[loanRequestEvents.length - 1];
      const walletAddress = latestEvent.args?.borrower as string | undefined;
      if (walletAddress?.toLowerCase() === connectedAddress.toLowerCase()) {
        refetchLoans();
        refetchPendingLoans();
        queryClient.invalidateQueries({
          queryKey: ["readContract", "Unlloo", "getLoansByStatus"],
        });
        queryClient.invalidateQueries({
          queryKey: ["readContract", "Unlloo", "canSubmitRequest"],
        });
      }
    }
  }, [loanRequestEvents, connectedAddress, refetchLoans, refetchPendingLoans, queryClient]);

  // Refetch when loan approval events are detected for the connected address
  useEffect(() => {
    if (loanApprovedEvents && loanApprovedEvents.length > 0 && connectedAddress) {
      const latestEvent = loanApprovedEvents[loanApprovedEvents.length - 1];
      // Check if this event is from the connected address
      const walletAddress = latestEvent.args?.borrower as string | undefined;
      if (walletAddress?.toLowerCase() === connectedAddress.toLowerCase()) {
        // Trigger refetch
        refetchLoans();
        refetchPendingLoans();
        refetchApprovedLoans();
        queryClient.invalidateQueries({
          queryKey: ["readContract", "Unlloo", "getLoansByStatus"],
        });
      }
    }
  }, [loanApprovedEvents, connectedAddress, refetchLoans, refetchPendingLoans, refetchApprovedLoans, queryClient]);

  // Use loan data directly from useUnllooLoans hook (already filtered by borrower and status)
  // This avoids duplicate RPC calls and redundant filtering
  const borrowerPendingLoans = React.useMemo(() => {
    return borrowerPendingLoansFromHook || [];
  }, [borrowerPendingLoansFromHook]);

  const borrowerApprovedLoans = React.useMemo(() => {
    return borrowerApprovedLoansFromHook || [];
  }, [borrowerApprovedLoansFromHook]);

  // Convert USD to token units for BorrowModal (USDC has 6 decimals)
  const maxAmountTokenUnits = useMemo(() => {
    if (maxAmount > 0 && availableTokens.length > 0) {
      return parseUnits(maxAmount.toString(), availableTokens[0].decimals);
    }
    return 0n;
  }, [maxAmount, availableTokens]);

  // Determine if reputation has been calculated (either manually or already exists)
  const hasReputationData = reputation > 0 && reputationData !== undefined;

  // Use real metrics from API if available, otherwise use defaults
  const displayMetrics = reputationMetrics
    ? {
        ...reputationMetrics,
        loanHistory: activeLoans.length, // Combine with on-chain loan data
      }
    : undefined;

  // Debug: Log metrics to see what we're getting
  useEffect(() => {
    if (reputationMetrics) {
      console.log("Reputation Metrics loaded:", reputationMetrics);
    }
  }, [reputationMetrics]);

  const handleCalculateReputation = async () => {
    if (!connectedAddress) return;

    if (isMountedRef.current) setIsCalculating(true);

    try {
      // Calculate basic reputation via API (this triggers backend calculation)
      await calculateReputation();

      // Wait a moment for backend to process the calculation
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Fetch the detailed reputation data with metrics
      const detailsResult = await refetchDetails();

      if (detailsResult.error) {
        console.error("Failed to fetch reputation details:", detailsResult.error);
        // Error notification handled by the hook
      } else {
        console.log("Reputation details fetched:", detailsResult.data);
      }
    } catch (error: any) {
      console.error("Failed to calculate reputation:", error);
      // Still try to fetch details even if basic calculation had issues
      try {
        await refetchDetails();
      } catch (detailsError) {
        console.error("Failed to fetch details:", detailsError);
      }
    } finally {
      if (isMountedRef.current) setIsCalculating(false);
    }
  };

  const handleSubmitLoanRequest = () => {
    setShowLoanRequestModal(true);
  };

  const handleBorrowFromApproved = (loanId: bigint) => {
    setSelectedLoanId(loanId);
    setShowBorrowModal(true);
  };

  const handleRepay = (loanId: number) => {
    // Open modal - it will fetch the current remaining balance using getRemainingBalance
    // which is the most accurate (includes current accrued interest)
    setSelectedRepayLoanId(loanId);
    // Set initial balance to 0n - the modal will fetch the actual balance
    // This ensures we always use the on-chain value which includes current accrued interest
    setSelectedRepayLoanRemainingBalance(0n);
    setShowRepayModal(true);
  };

  // Refetch data after successful transactions
  const handleTransactionSuccess = useCallback(async () => {
    try {
      if (publicClient) {
        const txBlockNumber = await publicClient.getBlockNumber();
        const targetBlock = txBlockNumber + 1n;
        const maxWaitTime = 15000;
        const startTime = Date.now();

        while (true) {
          const latestBlock = await publicClient.getBlockNumber();
          if (latestBlock >= targetBlock) break;
          if (Date.now() - startTime > maxWaitTime) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      if (!isMountedRef.current) return;

      // Invalidate all contract read queries
      queryClient.invalidateQueries({
        queryKey: ["readContract"],
      });

      // Explicitly invalidate specific queries
      queryClient.invalidateQueries({
        queryKey: ["readContract", "Unlloo", "getLoansByBorrower"],
      });

      queryClient.invalidateQueries({
        queryKey: ["readContract", "Unlloo", "getLoansByStatus"],
      });

      queryClient.invalidateQueries({
        queryKey: ["readContract", "Unlloo", "canSubmitRequest"],
      });

      queryClient.invalidateQueries({
        queryKey: ["readContract", "Unlloo", "lastRequestBlock"],
      });

      queryClient.invalidateQueries({
        queryKey: ["readContract", "Unlloo", "getCooldownEndBlock"],
      });

      // Invalidate loan queries
      queryClient.invalidateQueries({
        queryKey: ["loans"],
      });

      // Refetch all loan-related queries
      await Promise.all([refetchLoans(), refetchPendingLoans(), refetchApprovedLoans()]);

      // Wait a bit more for queries to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Error in handleTransactionSuccess:", error);
    }
  }, [publicClient, queryClient, refetchLoans, refetchPendingLoans, refetchApprovedLoans]);

  const currentBlock = blockNumber || 12345678n;

  return (
    <AuthGuard>
      <ErrorBoundary>
        <div className="min-h-screen py-6 md:py-8 bg-base-200">
          <div className="container mx-auto px-4 max-w-7xl">
            {/* Header */}
            <div className="mb-6 md:mb-8">
              <div className="flex items-center gap-3 mb-2">
                <BanknotesIcon className="h-8 w-8 text-primary" />
                <h1 className="text-3xl md:text-4xl font-bold text-base-content">Borrow</h1>
              </div>
              <p className="text-base md:text-lg text-base-content/70">
                Under-collateralized loans powered by reputation
              </p>
            </div>

            {/* Top Row: Reputation Score and Loan Request in 2 columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Reputation Section */}
              <ReputationDisplay
                onCalculate={handleCalculateReputation}
                isCalculating={isCalculating || isDetailsLoading}
                reputation={reputation}
                maxAmount={maxAmount > 0 ? maxAmount.toFixed(2) : undefined}
                maxLoanDuration={
                  maxLoanDuration > 0 && blockTimeSeconds
                    ? `${blocksToDays(maxLoanDuration, blockTimeSeconds)} days`
                    : undefined
                }
                recommendedRate={recommendedRate > 0 ? recommendedRate.toFixed(2) : undefined}
                isBlocked={isBlocked}
                lastUpdated={
                  lastUpdatedBlockNumber > 0 && blockNumber && blockTimeSeconds
                    ? blockDifferenceToHumanReadable(
                        BigInt(lastUpdatedBlockNumber),
                        BigInt(blockNumber.toString()),
                        blockTimeSeconds,
                      ) + " ago"
                    : undefined
                }
                metrics={displayMetrics}
                multiChain={multiChainData}
              />

              {/* Loan Request Section */}
              {hasReputationData && !isBlocked ? (
                <div className="bg-base-100 rounded-xl border border-base-300/50 p-5 md:p-6">
                  <h3 className="text-lg md:text-xl font-bold text-base-content mb-4 md:mb-5">Loan Request</h3>
                  <div className="space-y-4 md:space-y-5">
                    {/* Pending Loan Requests */}
                    {borrowerPendingLoans.length > 0 && (
                      <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 space-y-3">
                        <div className="text-sm font-semibold text-warning mb-2">Pending Loan Request</div>
                        {borrowerPendingLoans.map((loan: any) => {
                          // Use loan data directly from useUnllooLoans (already has all details)
                          // Note: loanAmount is in token units (6 decimals for USDC)
                          const selectedAmountTokenUnits = loan?.loanAmount ? BigInt(loan.loanAmount.toString()) : 0n;
                          const selectedAmountUsd =
                            selectedAmountTokenUnits > 0n ? Number(selectedAmountTokenUnits) / 10 ** USDC_DECIMALS : 0;
                          const selectedDuration = loan?.loanDurationBlocks ? Number(loan.loanDurationBlocks) : 0;
                          // Get pool limits for max values (not from loan)
                          const maxAmountUsd = maxAmount; // Use reputation-based max amount
                          const maxDuration = maxLoanDuration; // Use reputation-based max duration

                          return (
                            <div key={loan.loanId.toString()} className="bg-base-200 rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="font-medium text-base-content">Loan #{loan.loanId.toString()}</div>
                                <div className="badge badge-warning">Pending Approval</div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                  <div className="text-xs text-base-content/60 mb-1">Requested Loan Amount</div>
                                  <div className="font-semibold text-base-content">${selectedAmountUsd.toFixed(2)}</div>
                                  <div className="text-xs text-base-content/50">Max: ${maxAmountUsd.toFixed(2)}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-base-content/60 mb-1">Requested Loan Duration</div>
                                  <div className="font-semibold text-base-content">
                                    {selectedDuration > 0 && blockTimeSeconds
                                      ? blocksToHumanReadable(BigInt(selectedDuration), blockTimeSeconds)
                                      : `${selectedDuration} blocks`}
                                  </div>
                                  <div className="text-xs text-base-content/50">
                                    Max:{" "}
                                    {maxDuration > 0 && blockTimeSeconds
                                      ? blocksToHumanReadable(BigInt(maxDuration), blockTimeSeconds)
                                      : `${maxDuration} blocks`}
                                  </div>
                                </div>
                              </div>
                              <div className="text-xs text-base-content/60 pt-2 border-t border-base-300/50">
                                Waiting for approval. You will be able to borrow once approved.
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Approved Loans */}
                    {borrowerApprovedLoans.length > 0 && (
                      <div className="bg-success/10 border border-success/30 rounded-lg p-4 space-y-3">
                        <div className="text-sm font-semibold text-success mb-2">Approved Loans</div>
                        {borrowerApprovedLoans.map((loan: any) => {
                          // Use loan data directly from useUnllooLoans (already has all details)
                          // Note: loanAmount is in token units (6 decimals for USDC)
                          const selectedAmountTokenUnits = loan?.loanAmount ? BigInt(loan.loanAmount.toString()) : 0n;
                          const selectedAmountUsd =
                            selectedAmountTokenUnits > 0n ? Number(selectedAmountTokenUnits) / 10 ** USDC_DECIMALS : 0;
                          const selectedDuration = loan?.loanDurationBlocks ? Number(loan.loanDurationBlocks) : 0;

                          return (
                            <div key={loan.loanId.toString()} className="bg-base-200 rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="font-medium text-base-content">Loan #{loan.loanId.toString()}</div>
                                <div className="flex items-center gap-2">
                                  <span className="badge badge-success">Approved</span>
                                  <button
                                    onClick={() => handleBorrowFromApproved(loan.loanId)}
                                    className="btn btn-primary btn-sm"
                                  >
                                    Borrow
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                  <div className="text-xs text-base-content/60 mb-1">Approved Loan Amount</div>
                                  <div className="font-semibold text-base-content">${selectedAmountUsd.toFixed(2)}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-base-content/60 mb-1">Approved Loan Duration</div>
                                  <div className="font-semibold text-base-content">
                                    {selectedDuration > 0 && blockTimeSeconds
                                      ? blocksToHumanReadable(BigInt(selectedDuration), blockTimeSeconds)
                                      : `${selectedDuration} blocks`}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Submit New Loan Request Button */}
                    {borrowerPendingLoans.length === 0 && borrowerApprovedLoans.length === 0 && (
                      <>
                        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 md:p-5">
                          <div className="text-xs md:text-sm font-medium text-primary mb-3">
                            Your Borrowing Capacity
                          </div>
                          <div className="grid grid-cols-2 gap-3 md:gap-4">
                            <div>
                              <div className="text-xs text-primary/70 mb-1">Max Amount</div>
                              <div className="text-lg md:text-xl font-bold text-primary">${maxAmount.toFixed(2)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-primary/70 mb-1">Max Duration</div>
                              <div className="text-lg md:text-xl font-bold text-primary">
                                {blockTimeSeconds ? blocksToDays(maxLoanDuration, blockTimeSeconds) : 0} days
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Cooldown Status - Only show if canSubmitRequest is false and cooldown is active */}
                        {canSubmitRequest === false && isCooldownActive && cooldownTimeRemaining && (
                          <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                            <div className="text-sm font-semibold text-warning mb-2">Cooldown Active</div>
                            <div className="text-sm text-base-content/70 mb-2">
                              You can only submit one loan request every 1 day. Please wait before submitting a new
                              request.
                            </div>
                            <div className="text-xs text-base-content/60">
                              {cooldownTimeRemaining.humanReadable} remaining
                            </div>
                          </div>
                        )}

                        <button
                          onClick={handleSubmitLoanRequest}
                          disabled={canSubmitRequest !== true}
                          className="w-full btn btn-primary btn-lg"
                        >
                          {canSubmitRequest === false
                            ? "Cannot Submit"
                            : canSubmitRequest === undefined
                              ? "Loading..."
                              : "Submit Loan Request"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : !hasReputationData ? (
                <div className="bg-base-100 rounded-xl border border-base-300/50 p-5 md:p-6 text-center">
                  <p className="text-base-content/70 mb-4">
                    Calculate your reputation to see available borrowing options.
                  </p>
                </div>
              ) : isBlocked ? (
                <div className="bg-error/10 border border-error/30 rounded-xl p-5 md:p-6">
                  <div className="text-center mb-4">
                    <p className="text-error font-semibold mb-2 text-lg">Your wallet is blocked from borrowing</p>
                    <p className="text-error/70 text-sm mb-4">
                      Your wallet has been flagged for one or more risk factors.
                    </p>
                  </div>

                  {/* Show blocking reasons if available */}
                  {reputationDetailsData && (
                    <div className="bg-base-200 rounded-lg p-4 space-y-2">
                      <p className="text-sm font-semibold text-base-content mb-3">Blocking Reasons:</p>
                      <ul className="space-y-2 text-sm text-base-content/80">
                        {reputationDetailsData.blockscoutData?.customCreditworthiness?.data?.metrics && (
                          <li className="flex items-start gap-2">
                            <span className="text-error">•</span>
                            <span>Reputation score below minimum threshold (200)</span>
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-error/20 text-center">
                    <p className="text-xs text-error/70">
                      To resolve this, please ensure your wallet has a clean transaction history and passes all security
                      checks.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Bottom Row: Active Loans Full Width */}
            <div className="bg-base-100 rounded-xl border border-base-300/50 overflow-hidden">
              <div className="px-4 md:px-5 pt-3 md:pt-3.5 pb-2 md:pb-2.5 border-b border-base-300/50 flex items-center">
                <h3 className="text-lg md:text-xl font-bold text-base-content">Active Loans</h3>
              </div>
              {activeLoans.length === 0 ? (
                <div className="text-center py-8 md:py-10 px-4 md:px-5">
                  <p className="text-sm text-base-content/60">No active loans</p>
                </div>
              ) : (
                <div className="px-3 md:px-3.5 pt-2 md:pt-2.5 pb-3 md:pb-3.5">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeLoans.map((loan: any) => (
                      <LoanCard
                        key={loan.loanId.toString()}
                        loanId={Number(loan.loanId)}
                        assetSymbol="USDC"
                        principal={loan.principal}
                        totalInterest={loan.totalInterest}
                        repaidInterest={loan.repaidInterest}
                        repaidPrincipal={loan.repaidPrincipal}
                        expirationBlock={loan.expirationBlock}
                        currentBlock={currentBlock}
                        isActive={loan.isActive}
                        maxLoanAmount={undefined}
                        onRepay={() => handleRepay(Number(loan.loanId))}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Loan Request Modal */}
            {hasReputationData && !isBlocked && (
              <LoanRequestModal
                isOpen={showLoanRequestModal}
                onClose={() => setShowLoanRequestModal(false)}
                walletReputation={reputation}
                maxLoanAmount={maxAmount}
                maxLoanDurationBlocks={maxLoanDuration}
                onTransactionSuccess={handleTransactionSuccess}
              />
            )}

            {/* Borrow Modal */}
            {selectedLoanId && availableTokens.length > 0 && (
              <BorrowModal
                isOpen={showBorrowModal}
                onClose={() => {
                  setShowBorrowModal(false);
                  setSelectedLoanId(undefined);
                }}
                poolAddress={availableTokens[0].address}
                assetSymbol={availableTokens[0].symbol}
                assetName={availableTokens[0].name}
                assetDecimals={availableTokens[0].decimals}
                maxLoanAmount={maxAmountTokenUnits}
                approvedLoanId={selectedLoanId}
                onTransactionSuccess={handleTransactionSuccess}
              />
            )}

            {/* Repay Modal */}
            {selectedRepayLoanId !== undefined && (
              <RepayModal
                isOpen={showRepayModal}
                onClose={() => {
                  setShowRepayModal(false);
                  setSelectedRepayLoanId(undefined);
                  setSelectedRepayLoanRemainingBalance(undefined);
                }}
                loanId={selectedRepayLoanId}
                assetSymbol="USDC"
                assetDecimals={6}
                remainingBalance={selectedRepayLoanRemainingBalance || 0n}
                onTransactionSuccess={handleTransactionSuccess}
              />
            )}
          </div>
        </div>
      </ErrorBoundary>
    </AuthGuard>
  );
};

export default BorrowPage;
