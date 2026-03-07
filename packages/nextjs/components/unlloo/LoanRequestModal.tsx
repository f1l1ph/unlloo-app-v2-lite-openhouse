"use client";

import React, { useEffect, useMemo, useState } from "react";
import { decodeEventLog } from "viem";
import { Address } from "viem";
import { sepolia } from "viem/chains";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { type SupportedChain, getTokenUsdPrice } from "~~/services/api/exchangeRates.service";
import {
  SOURCE_OF_INCOME_OPTIONS,
  type SourceOfIncome,
  createLoanRequest,
  generateRequestId,
  hashLoanReason,
  updateLoanId,
} from "~~/services/api/loan.service";
import { ReputationService } from "~~/services/api/reputation.service";
import { notification } from "~~/utils/scaffold-eth/notification";
import { useAvailableTokens } from "~~/utils/unlloo";
import { blocksRemainingToHumanReadable, blocksToHumanReadable } from "~~/utils/unlloo/blockTime";
import { DEFAULT_LOAN_REQUEST_RATIO, MIN_LOAN_AMOUNT_USD, SECONDS_PER_YEAR } from "~~/utils/unlloo/loanConfig";

interface LoanRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletReputation: number;
  maxLoanAmount: number; // In USD (no decimals) - will be converted to token units
  maxLoanDurationBlocks: number; // In blocks
  onTransactionSuccess?: (loanId: bigint) => void;
}

/**
 * Modal component for submitting a loan request
 */
export const LoanRequestModal: React.FC<LoanRequestModalProps> = ({
  isOpen,
  onClose,
  walletReputation,
  maxLoanAmount,
  maxLoanDurationBlocks,
  onTransactionSuccess,
}) => {
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber();
  const publicClient = usePublicClient();
  const { data: contractData } = useDeployedContractInfo({ contractName: "Unlloo" });

  // Get available tokens/pools
  const availableTokens = useAvailableTokens();

  // Calculate default values (configurable ratio of max)
  const defaultLoanAmount = useMemo(() => Math.floor(maxLoanAmount * DEFAULT_LOAN_REQUEST_RATIO), [maxLoanAmount]);
  // Initialize with a temporary value, will be updated when effectiveMaxDurationBlocks is calculated
  const initialDefaultDuration = useMemo(
    () => Math.floor(maxLoanDurationBlocks * DEFAULT_LOAN_REQUEST_RATIO),
    [maxLoanDurationBlocks],
  );

  // State for selected token (default to first available token)
  const [selectedToken, setSelectedToken] = useState<Address | undefined>(
    availableTokens.length > 0 ? (availableTokens[0].address as Address) : undefined,
  );

  // Get selected token details
  const selectedTokenInfo = useMemo(() => {
    return availableTokens.find(token => token.address === selectedToken);
  }, [availableTokens, selectedToken]);

  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [tokenUsdPriceE6, setTokenUsdPriceE6] = useState<bigint | null>(null);
  const [tokenUsdPrice, setTokenUsdPrice] = useState<number | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [loanReason, setLoanReason] = useState("");
  const [email, setEmail] = useState("");
  const [telegramHandle, setTelegramHandle] = useState("");
  const [sourceOfIncome, setSourceOfIncome] = useState<SourceOfIncome | "">("");
  const [incomeYearlyUsd, setIncomeYearlyUsd] = useState<string>("");
  const [requestedAmount, setRequestedAmount] = useState<string>(defaultLoanAmount.toString());
  const [requestedDuration, setRequestedDuration] = useState<string>(initialDefaultDuration.toString());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { writeContractAsync: writeUnllooAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });

  // Update selected token when availableTokens changes
  useEffect(() => {
    if (availableTokens.length > 0 && !selectedToken) {
      setSelectedToken(availableTokens[0].address as Address);
    }
  }, [availableTokens, selectedToken]);

  const supportedChainFromChainId = (chainId?: number): SupportedChain | null => {
    switch (chainId) {
      case 11155111:
        return "sepolia"; // @TODO this can be security issue, should be removed
      case 1:
        return "ethereum";
      case 42161:
        return "arbitrum";
      case 8453:
        return "base";
      case 43114:
        return "avalanche";
      case 10:
        return "optimism";
      default:
        return null;
    }
  };

  const selectedTokenAddress = selectedTokenInfo?.address;

  // Fetch token USD price for selected asset (via backend CoinGecko)
  useEffect(() => {
    const loadPrice = async () => {
      if (!selectedTokenAddress) return;
      setIsPriceLoading(true);
      setPriceError(null);

      try {
        const chainId = publicClient?.chain?.id;
        const supportedChain = supportedChainFromChainId(chainId);
        if (!supportedChain) {
          setTokenUsdPriceE6(null);
          setTokenUsdPrice(null);
          setPriceError("Unsupported network for Coingecko pricing (only mainnets supported).");
          return;
        }

        const res = await getTokenUsdPrice({
          chain: supportedChain,
          tokenAddress: selectedTokenAddress,
          chainId,
        });

        if (!res.usdPriceE6 || res.usdPriceE6 <= 0) {
          setTokenUsdPriceE6(null);
          setTokenUsdPrice(null);
          setPriceError("Unable to fetch token USD price.");
          return;
        }

        setTokenUsdPriceE6(BigInt(res.usdPriceE6));
        setTokenUsdPrice(res.usdPrice);
      } catch (e: any) {
        setTokenUsdPriceE6(null);
        setTokenUsdPrice(null);
        setPriceError(e?.message || "Unable to fetch token USD price.");
      } finally {
        setIsPriceLoading(false);
      }
    };

    void loadPrice();
  }, [selectedTokenAddress, publicClient?.chain?.id]);

  // Check if user can submit a request (cooldown, active loans, etc.)
  const { data: canSubmitRequest } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "canSubmitRequest",
    args: address ? [address] : [undefined],
  });

  // Get last request block to check if user has ever submitted
  const { data: lastRequestBlock } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "lastRequestBlock",
    args: address ? [address] : [undefined],
  });

  // Get cooldown end block
  const { data: cooldownEndBlock } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getCooldownEndBlock",
    args: address ? [address] : [undefined],
  });

  // Get block time to calculate time remaining
  const { data: blockTimeSeconds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "blockTimeSeconds",
  });

  // Get borrower interest rate for estimation
  const { data: borrowerRateBps } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "calculateBorrowRate",
    args: [selectedToken],
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

  // Check if network is Sepolia
  const isSepoliaNetwork = useMemo(() => {
    return publicClient?.chain?.id === sepolia.id;
  }, [publicClient?.chain?.id]);

  // Calculate 40 days in blocks for Sepolia (if blockTimeSeconds is available)
  const sepoliaMaxDurationBlocks = useMemo(() => {
    if (!isSepoliaNetwork || !blockTimeSeconds) return null;
    const secondsPerDay = 86400; // 24 * 60 * 60
    const days = 40;
    const totalSeconds = days * secondsPerDay;
    const blockTimeNum = typeof blockTimeSeconds === "bigint" ? Number(blockTimeSeconds) : blockTimeSeconds;
    if (blockTimeNum <= 0) return null;
    return Math.floor(totalSeconds / blockTimeNum);
  }, [isSepoliaNetwork, blockTimeSeconds]);

  // Contract minimums: MIN_LOAN_AMOUNT_USD = 100, MIN_LOAN_DURATION_BLOCKS (varies by chain)
  // On Sepolia, enforce 40-day maximum limit
  const effectiveMaxDurationBlocks = useMemo(() => {
    if (isSepoliaNetwork && sepoliaMaxDurationBlocks !== null) {
      return Math.min(maxLoanDurationBlocks, sepoliaMaxDurationBlocks);
    }
    return maxLoanDurationBlocks;
  }, [isSepoliaNetwork, sepoliaMaxDurationBlocks, maxLoanDurationBlocks]);

  // Calculate default duration using effective max (respects Sepolia limit)
  const defaultLoanDuration = useMemo(
    () => Math.floor(effectiveMaxDurationBlocks * DEFAULT_LOAN_REQUEST_RATIO),
    [effectiveMaxDurationBlocks],
  );

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setRequestedAmount(defaultLoanAmount.toString());
      setRequestedDuration(defaultLoanDuration.toString());
      setLoanReason("");
      setEmail("");
      setTelegramHandle("");
      setSourceOfIncome("");
      setIncomeYearlyUsd("");
    }
  }, [isOpen, defaultLoanAmount, defaultLoanDuration]);

  // Parse and validate requested values
  const requestedAmountNum = useMemo(() => {
    const num = parseFloat(requestedAmount);
    return isNaN(num) || num <= 0 ? 0 : num;
  }, [requestedAmount]);

  const requestedDurationNum = useMemo(() => {
    const num = parseInt(requestedDuration, 10);
    return isNaN(num) || num <= 0 ? 0 : num;
  }, [requestedDuration]);

  const isAmountValid = requestedAmountNum >= MIN_LOAN_AMOUNT_USD && requestedAmountNum <= maxLoanAmount;
  const isDurationValid = requestedDurationNum > 0 && requestedDurationNum <= effectiveMaxDurationBlocks;

  // Calculate expected interest (simplified compound interest approximation)
  const expectedInterest = useMemo(() => {
    if (!requestedAmountNum || !requestedDurationNum || !borrowerRateBps || !blockTimeSeconds) return 0;

    const rateBps = Number(borrowerRateBps);
    const apr = rateBps / 100; // Convert basis points to percentage

    // Calculate blocks per year
    const blocksPerYear = SECONDS_PER_YEAR / Number(blockTimeSeconds);

    if (blocksPerYear === 0) return 0;

    // Simplified compound interest: principal * (1 + APR)^(blocks/blocksPerYear) - principal
    // For approximation, we use: principal * APR * (blocks / blocksPerYear)
    // This is a linear approximation that's close for short durations
    const interestRate = apr / 100; // Convert to decimal
    const years = requestedDurationNum / blocksPerYear;
    const expectedInterestAmount = requestedAmountNum * interestRate * years;

    return expectedInterestAmount;
  }, [requestedAmountNum, requestedDurationNum, borrowerRateBps, blockTimeSeconds]);

  const interestRatePercent = borrowerRateBps ? Number(borrowerRateBps) / 100 : 0;

  const handleSubmit = async () => {
    // Pre-flight check: use canSubmitRequest as source of truth
    // Disable if canSubmitRequest is false or undefined (loading)
    if (canSubmitRequest !== true) {
      // If canSubmitRequest is false, check the specific reason
      if (canSubmitRequest === false && isCooldownActive && cooldownTimeRemaining) {
        notification.error(
          `Cooldown active. Please wait ${cooldownTimeRemaining.humanReadable} before submitting a new request.`,
        );
      } else if (canSubmitRequest === false) {
        notification.error(
          "You cannot submit a loan request at this time. Please check if you have an active loan or unpaid debt.",
        );
      } else {
        // canSubmitRequest is undefined (loading)
        notification.error("Please wait while we check your eligibility...");
      }
      return;
    }

    if (!email.trim()) {
      notification.error("Please provide your email address");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      notification.error("Please provide a valid email address");
      return;
    }

    if (!telegramHandle.trim()) {
      notification.error("Please provide your Telegram handle");
      return;
    }

    // Basic telegram validation (alphanumeric, underscores, optional @)
    const telegramRegex = /^@?[a-zA-Z0-9_]{1,32}$/;
    if (!telegramRegex.test(telegramHandle.trim())) {
      notification.error("Please provide a valid Telegram handle (1-32 characters, alphanumeric and underscores only)");
      return;
    }

    if (!sourceOfIncome) {
      notification.error("Please select your source of income");
      return;
    }

    if (!incomeYearlyUsd || parseFloat(incomeYearlyUsd) <= 0) {
      notification.error("Please provide your yearly income");
      return;
    }

    if (!loanReason.trim()) {
      notification.error("Please provide a loan reason");
      return;
    }

    if (loanReason.trim().length < 50) {
      notification.error("Loan reason must be at least 50 characters");
      return;
    }

    if (!isAmountValid) {
      notification.error(`Loan amount must be between $${MIN_LOAN_AMOUNT_USD} and $${maxLoanAmount.toFixed(2)}`);
      return;
    }

    if (!isDurationValid) {
      const maxDurationHumanReadable = blockTimeSeconds
        ? blocksToHumanReadable(BigInt(effectiveMaxDurationBlocks), blockTimeSeconds)
        : `${effectiveMaxDurationBlocks} blocks`;
      notification.error(`Loan duration must be between 1 block and ${maxDurationHumanReadable}`);
      return;
    }

    try {
      setIsSubmitting(true);
      const loadingToast = notification.loading("Submitting loan request...");

      // Validate token is selected
      if (!selectedToken || !selectedTokenInfo) {
        throw new Error("Please select a token/asset for the loan");
      }

      // Validate wallet address
      if (!address) {
        throw new Error("Wallet address not available");
      }

      // Step 1: Generate request ID and hash reason
      const requestId = generateRequestId();
      const reasonHash = hashLoanReason(loanReason.trim());

      // Step 2: Submit to backend API FIRST (if this fails, we don't proceed with on-chain transaction)
      try {
        notification.remove(loadingToast);
        const apiLoadingToast = notification.loading("Fetching reputation details and storing request...");

        // Fetch reputation details for storage
        const reputationDetails = await ReputationService.getReputationDetails(address);

        await createLoanRequest({
          requestId,
          walletAddress: address,
          email: email.trim().toLowerCase(),
          telegramHandle: telegramHandle.trim().replace(/^@/, ""),
          reason: loanReason.trim(),
          reasonHash,
          walletReputation,
          maxLoanAmount,
          maxLoanDuration: maxLoanDurationBlocks,
          recommendedInterest: interestRatePercent,
          blockNumber: blockNumber ? Number(blockNumber) : 0,
          reputationDetails: {
            thirdPartyServices: reputationDetails.thirdPartyServices,
            blockscoutData: reputationDetails.blockscoutData,
          },
          sourceOfIncome: sourceOfIncome as SourceOfIncome,
          incomeYearlyUsd: parseFloat(incomeYearlyUsd) || 0,
        });

        notification.remove(apiLoadingToast);
      } catch (apiError: any) {
        notification.remove(loadingToast);
        throw new Error(`Failed to store loan request: ${apiError.message || "Unknown error"}`);
      }

      // Step 3: If API call succeeded, proceed with on-chain transaction
      const blockchainLoadingToast = notification.loading("Submitting on-chain transaction...");

      // Convert USD -> token units using backend CoinGecko USD price (micro-USD math)
      if (!selectedTokenInfo) throw new Error("Selected token info missing");
      if (!tokenUsdPriceE6) throw new Error("Token USD price unavailable");
      const tokenDecimals = selectedTokenInfo.decimals;

      const usdAmountE6 = BigInt(Math.round(requestedAmountNum * 1_000_000));
      const scale = 10n ** BigInt(tokenDecimals);
      const requestedAmountTokenUnits = (usdAmountE6 * scale) / tokenUsdPriceE6;

      if (requestedAmountTokenUnits <= 0n) {
        throw new Error("Converted token amount is zero. Check token USD price.");
      }

      // Submit loan request to smart contract
      // Contract signature: submitLoanRequest(uint16 walletReputation, address token, uint256 loanAmount, uint256 loanDurationBlocks)
      const hash = await writeUnllooAsync({
        functionName: "submitLoanRequest",
        args: [
          walletReputation as number, // uint16 walletReputation
          selectedToken as Address, // address token
          requestedAmountTokenUnits, // uint256 loanAmount (in token units)
          BigInt(requestedDurationNum), // uint256 loanDurationBlocks (in blocks)
        ],
      });

      // Wait for transaction receipt
      if (!publicClient || !hash) {
        throw new Error("Public client not available or transaction hash missing");
      }

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Extract loanId from LoanRequestSubmitted event
      let loanId: bigint | null = null;
      try {
        if (!contractData?.abi) {
          throw new Error("Contract ABI not available");
        }
        const contractAbi = contractData.abi;

        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: contractAbi,
              eventName: "LoanRequestSubmitted",
              data: log.data,
              topics: log.topics,
            });
            if (decoded.args.loanId) {
              loanId = decoded.args.loanId as bigint;
              break;
            }
          } catch {
            // Not the event we're looking for, continue
          }
        }
      } catch (error) {
        console.warn("Failed to extract loanId from event:", error);
      }

      notification.remove(blockchainLoadingToast);

      // Step 4: Update backend with loanId if we got it from the event
      if (loanId) {
        try {
          const updateLoadingToast = notification.loading("Updating loan request with on-chain ID...");
          await updateLoanId(requestId, loanId.toString());
          notification.remove(updateLoadingToast);
        } catch (updateError: any) {
          // Log error but don't fail the whole process since on-chain tx succeeded
          console.error("Failed to update loanId in backend:", updateError);
          notification.warning("Loan submitted on-chain, but failed to update backend. Please contact support.");
        }
      }

      notification.success("Loan request submitted successfully");

      // Wait for transaction success handler to complete (invalidates queries and waits for block)
      await onTransactionSuccess?.(loanId || BigInt(0));

      // Wait a bit more for queries to refetch after invalidation
      await new Promise(resolve => setTimeout(resolve, 1000));

      onClose();
      setIsSubmitting(false);
    } catch (error: any) {
      console.error("Loan request error:", error);

      // Try to extract error details
      let errorMessage = error?.shortMessage || error?.message || "Failed to submit loan request";
      let cooldownEndBlockFromError: bigint | null = null;

      // Try to decode custom error from error data
      if (error?.data || error?.cause?.data) {
        const errorData = error?.data || error?.cause?.data;
        // CooldownNotExpired error selector is 0x0dac64f9
        if (typeof errorData === "string" && errorData.startsWith("0x0dac64f9")) {
          try {
            // Extract cooldown end block from error data (last 32 bytes)
            const cooldownEndHex = errorData.slice(-64);
            cooldownEndBlockFromError = BigInt("0x" + cooldownEndHex);
            errorMessage = "CooldownNotExpired";
          } catch (e) {
            console.error("Error decoding cooldown end block:", e);
          }
        }
      }

      // Handle specific error cases
      // Note: CooldownNotExpired means there's ALREADY a cooldown from a previous successful transaction.
      // The failed transaction does NOT set a cooldown - it's checking an existing one.
      if (errorMessage.includes("CooldownNotExpired") || errorMessage.includes("cooldown")) {
        if (cooldownEndBlockFromError && blockNumber && blockTimeSeconds) {
          const blocksRemaining = cooldownEndBlockFromError - BigInt(blockNumber.toString());
          const humanReadable = blocksRemainingToHumanReadable(blocksRemaining, blockTimeSeconds);
          notification.error(
            `You can only submit one loan request every 1 day. Please wait ${humanReadable} before submitting a new request. This cooldown was set by a previous successful loan request.`,
          );
        } else {
          notification.error(
            "You can only submit one loan request every 1 day. Please wait before submitting a new request. This cooldown was set by a previous successful loan request.",
          );
        }
      } else if (errorMessage.includes("HasActiveLoan")) {
        notification.error(
          "You already have an active loan. Please repay your current loan before requesting a new one.",
        );
      } else if (errorMessage.includes("HasUnpaidDebt")) {
        notification.error("You have unpaid debt. Please repay your debt before requesting a new loan.");
      } else if (errorMessage.includes("ExceedsMaxPendingLoans")) {
        notification.error("You already have a pending loan request. Please wait for approval or rejection.");
      } else if (errorMessage.includes("InvalidReputation")) {
        notification.error("Your reputation is too low to submit a loan request.");
      } else if (errorMessage.includes("InvalidAmount")) {
        notification.error(`Loan amount must be between $${MIN_LOAN_AMOUNT_USD} and $${maxLoanAmount.toFixed(2)}`);
      } else if (errorMessage.includes("InvalidDuration")) {
        const maxDurationHumanReadable = blockTimeSeconds
          ? blocksToHumanReadable(BigInt(effectiveMaxDurationBlocks), blockTimeSeconds)
          : `${effectiveMaxDurationBlocks} blocks`;
        notification.error(`Loan duration must be between minimum and ${maxDurationHumanReadable}`);
      } else {
        notification.error(errorMessage);
      }
      setIsSubmitting(false);
    }
  };

  const handleSetMaxAmount = () => {
    setRequestedAmount(maxLoanAmount.toString());
  };

  const handleSetMaxDuration = () => {
    setRequestedDuration(effectiveMaxDurationBlocks.toString());
  };

  const handleSetDefaultAmount = () => {
    setRequestedAmount(defaultLoanAmount.toString());
  };

  const handleSetDefaultDuration = () => {
    setRequestedDuration(defaultLoanDuration.toString());
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-base-100 rounded-xl border border-base-300 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-base-300 shrink-0">
          <h2 className="text-2xl font-bold text-base-content">Submit Loan Request</h2>
          <button
            onClick={onClose}
            className="text-base-content/60 hover:text-base-content transition-colors"
            aria-label="Close modal"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-6">
          <div className="space-y-4">
            {/* Read-only reputation */}
            <div className="bg-base-200 rounded-lg p-4">
              <div className="flex justify-between text-sm">
                <span className="text-base-content/70">Reputation Score:</span>
                <span className="font-medium text-base-content">{walletReputation}</span>
              </div>
            </div>

            {/* Token/Asset Selection */}
            {availableTokens.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-base-content/70 mb-2">Select Asset</label>
                <select
                  value={selectedToken || ""}
                  onChange={e => setSelectedToken(e.target.value as Address)}
                  className="select select-bordered w-full"
                  disabled={isSubmitting}
                >
                  {availableTokens.map(token => (
                    <option key={token.address} value={token.address}>
                      {token.symbol} - {token.name}
                    </option>
                  ))}
                </select>
                {selectedTokenInfo && (
                  <div className="text-xs text-base-content/60 mt-1">
                    Selected: {selectedTokenInfo.symbol} ({selectedTokenInfo.name})
                  </div>
                )}
              </div>
            )}

            {/* Cooldown Warning - Only show if canSubmitRequest is false and cooldown is active */}
            {canSubmitRequest === false && isCooldownActive && cooldownTimeRemaining && (
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                <div className="text-sm font-semibold text-warning mb-2">Cooldown Active</div>
                <div className="text-sm text-base-content/70 mb-2">
                  You can only submit one loan request every 1 day. Please wait before submitting a new request.
                </div>
                <div className="text-xs text-base-content/60">{cooldownTimeRemaining.humanReadable} remaining</div>
              </div>
            )}

            {/* Configurable loan amount */}
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">Requested Loan Amount (USD)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={requestedAmount}
                  onChange={e => setRequestedAmount(e.target.value)}
                  placeholder={defaultLoanAmount.toString()}
                  min={MIN_LOAN_AMOUNT_USD.toString()}
                  max={maxLoanAmount}
                  step="1"
                  className={`flex-1 input input-bordered w-full ${!isAmountValid && requestedAmount ? "input-error" : ""}`}
                />
                <button
                  onClick={handleSetDefaultAmount}
                  className="btn btn-sm btn-outline"
                  title="Set to 60% (default)"
                >
                  60%
                </button>
                <button onClick={handleSetMaxAmount} className="btn btn-sm btn-outline" title="Set to maximum">
                  Max
                </button>
              </div>
              <div className="text-xs text-base-content/60 mt-1">
                {isAmountValid ? (
                  <span>
                    Requesting: ${requestedAmountNum.toFixed(2)} (Max: ${maxLoanAmount.toFixed(2)})
                  </span>
                ) : (
                  <span className="text-error">
                    Amount must be between ${MIN_LOAN_AMOUNT_USD} and ${maxLoanAmount.toFixed(2)}
                  </span>
                )}
              </div>
            </div>

            {/* Configurable loan duration */}
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">
                Requested Loan Duration (blocks)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={requestedDuration}
                  onChange={e => setRequestedDuration(e.target.value)}
                  placeholder={defaultLoanDuration.toString()}
                  min="1"
                  max={effectiveMaxDurationBlocks}
                  step="1"
                  className={`flex-1 input input-bordered w-full ${!isDurationValid && requestedDuration ? "input-error" : ""}`}
                />
                <button
                  onClick={handleSetDefaultDuration}
                  className="btn btn-sm btn-outline"
                  title="Set to 60% (default)"
                >
                  60%
                </button>
                <button onClick={handleSetMaxDuration} className="btn btn-sm btn-outline" title="Set to maximum">
                  Max
                </button>
              </div>
              <div className="text-xs text-base-content/60 mt-1">
                {isDurationValid ? (
                  <span>
                    Requesting:{" "}
                    {blockTimeSeconds
                      ? blocksToHumanReadable(BigInt(requestedDurationNum), blockTimeSeconds)
                      : `${requestedDurationNum} blocks`}{" "}
                    (Max:{" "}
                    {blockTimeSeconds
                      ? blocksToHumanReadable(BigInt(effectiveMaxDurationBlocks), blockTimeSeconds)
                      : `${effectiveMaxDurationBlocks} blocks`}
                    )
                  </span>
                ) : (
                  <span className="text-error">
                    Duration must be between 1 block and{" "}
                    {blockTimeSeconds
                      ? blocksToHumanReadable(BigInt(effectiveMaxDurationBlocks), blockTimeSeconds)
                      : `${effectiveMaxDurationBlocks} blocks`}
                  </span>
                )}
              </div>
            </div>

            {/* Sepolia Network Notice */}
            {isSepoliaNetwork && (
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                <div className="text-sm font-semibold text-warning mb-1">Sepolia Testnet Notice</div>
                <div className="text-sm text-base-content/70">
                  On Sepolia testnet, the maximum loan duration is limited to 40 days.
                  {sepoliaMaxDurationBlocks && blockTimeSeconds && (
                    <span className="block mt-1">
                      Maximum duration: {blocksToHumanReadable(BigInt(sepoliaMaxDurationBlocks), blockTimeSeconds)} (
                      {sepoliaMaxDurationBlocks} blocks)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Email input */}
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">
                Email Address <span className="text-error">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="input input-bordered w-full"
                disabled={isSubmitting}
              />
              <div className="text-xs text-base-content/60 mt-1">
                We&apos;ll use this to contact you about your loan request
              </div>
            </div>

            {/* Telegram handle input */}
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">
                Telegram Handle <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={telegramHandle}
                onChange={e => setTelegramHandle(e.target.value)}
                placeholder="@username or username"
                className="input input-bordered w-full"
                disabled={isSubmitting}
              />
              <div className="text-xs text-base-content/60 mt-1">
                We&apos;ll contact you on Telegram for loan updates
              </div>
            </div>

            {/* Source of Income dropdown */}
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">
                Source of Income <span className="text-error">*</span>
              </label>
              <select
                value={sourceOfIncome}
                onChange={e => setSourceOfIncome(e.target.value as SourceOfIncome)}
                className="select select-bordered w-full"
                disabled={isSubmitting}
              >
                <option value="" disabled>
                  Select your source of income
                </option>
                {SOURCE_OF_INCOME_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <div className="text-xs text-base-content/60 mt-1">
                Select the category that best describes your income
              </div>
            </div>

            {/* Yearly Income input */}
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">
                Yearly Income (USD) <span className="text-error">*</span>
              </label>
              <input
                type="number"
                value={incomeYearlyUsd}
                onChange={e => setIncomeYearlyUsd(e.target.value)}
                placeholder="e.g. 50000"
                className="input input-bordered w-full"
                min="0"
                step="0.01"
                disabled={isSubmitting}
              />
              <div className="text-xs text-base-content/60 mt-1">Your estimated yearly income in USD</div>
            </div>

            {/* Loan reason input */}
            <div>
              <label className="block text-sm font-medium text-base-content/70 mb-2">
                Loan Reason <span className="text-error">*</span>
              </label>
              <textarea
                value={loanReason}
                onChange={e => setLoanReason(e.target.value)}
                placeholder="Please explain why you need this loan..."
                rows={4}
                className="textarea textarea-bordered w-full"
                maxLength={1000}
                disabled={isSubmitting}
              />
              <div className="text-xs text-base-content/60 mt-1">
                {loanReason.length}/1000 characters (minimum 50 characters required)
              </div>
            </div>

            {/* Loan Summary with Interest Information */}
            <div className="bg-info/10 border border-info/20 rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold text-info-content mb-2">Loan Summary</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/70">Requested Amount:</span>
                  <span className="font-bold text-primary">${requestedAmountNum.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Asset Price (USD):</span>
                  <span className="font-medium text-base-content">
                    {isPriceLoading ? "Loading..." : tokenUsdPrice ? `$${tokenUsdPrice.toFixed(4)}` : "N/A"}
                  </span>
                </div>
                {priceError && (
                  <div className="text-xs text-warning pt-1">
                    {priceError} You can still fill the form, but submission is blocked until price is available.
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-base-content/70">Loan Duration:</span>
                  <span className="font-medium text-base-content">
                    {blockTimeSeconds
                      ? blocksToHumanReadable(BigInt(requestedDurationNum), blockTimeSeconds)
                      : `${requestedDurationNum} blocks`}
                  </span>
                </div>
                {interestRatePercent > 0 && (
                  <div className="flex justify-between">
                    <span className="text-base-content/70">Interest Rate (APR):</span>
                    <span className="font-medium text-base-content">{interestRatePercent.toFixed(2)}%</span>
                  </div>
                )}
                {expectedInterest > 0 && (
                  <>
                    <div className="border-t border-info/20 pt-2 mt-1">
                      <div className="flex justify-between">
                        <span className="text-base-content/70">Expected Interest:</span>
                        <span className="font-medium text-warning">~${expectedInterest.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-base-content/70 font-semibold">Total to Repay (est.):</span>
                        <span className="font-bold text-primary">
                          ~${(requestedAmountNum + expectedInterest).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-base-content/60 italic mt-1">
                      * Interest accrues continuously. Early repayment reduces total interest paid.
                    </div>
                  </>
                )}
              </div>
              <div className="text-xs text-info-content/80 pt-2 border-t border-info/20 mt-2">
                Your loan request will be reviewed. Once approved, you&apos;ll be able to borrow the funds.
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-base-300 p-6 shrink-0 bg-base-100">
          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-outline flex-1" disabled={isSubmitting}>
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={
                canSubmitRequest !== true ||
                !email.trim() ||
                !telegramHandle.trim() ||
                !sourceOfIncome ||
                !incomeYearlyUsd ||
                parseFloat(incomeYearlyUsd) <= 0 ||
                !loanReason.trim() ||
                !isAmountValid ||
                !isDurationValid ||
                !tokenUsdPriceE6 ||
                isPriceLoading ||
                isSubmitting
              }
              className="btn btn-primary flex-1"
            >
              {isSubmitting
                ? "Submitting..."
                : canSubmitRequest === false
                  ? "Cannot Submit"
                  : canSubmitRequest === undefined
                    ? "Loading..."
                    : "Submit Request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
