import { useQuery } from "@tanstack/react-query";
import { Address } from "viem";
import { ReputationService } from "~~/services/api/reputation.service";

interface UseReputationLoanDetailsOptions {
  enabled?: boolean;
}

/**
 * Hook to fetch detailed reputation data including metrics and breakdown
 */
export const useReputationLoanDetails = (
  address: Address | undefined,
  options: UseReputationLoanDetailsOptions = {},
) => {
  // Determine if we should enable the query - be very strict
  const shouldEnable = Boolean(
    address &&
    typeof address === "string" &&
    address.length > 0 &&
    address.startsWith("0x") &&
    options.enabled !== false,
  );

  // Only create query key with address if it exists, otherwise use a placeholder
  // This prevents React Query from initializing queries with undefined keys
  const queryKey = shouldEnable && address ? ["reputation", address, "details"] : ["reputation", "disabled", "details"];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      // CRITICAL: Get address from query key to avoid closure issues
      // React Query might call this even when enabled is false, so we check the key itself
      const queryAddress = queryKey[1];

      // CRITICAL: Recompute enabled state from query key (not closure) to avoid stale values
      // This is the FIRST and MOST IMPORTANT check
      const isQueryEnabled =
        queryAddress !== "disabled" &&
        queryAddress &&
        typeof queryAddress === "string" &&
        queryAddress.startsWith("0x") &&
        queryAddress.length >= 10;

      if (!isQueryEnabled) {
        console.warn("useReputationLoanDetails: Query disabled based on query key, throwing immediately", {
          queryAddress,
          queryKey,
          address,
          shouldEnable,
        });
        throw new Error("Query disabled - user not signed in");
      }

      // CRITICAL: Synchronous check BEFORE any async operations
      // This must be the FIRST check to prevent any API calls
      // Check if queryAddress is "disabled" or invalid - this is the most important check
      if (queryAddress === "disabled") {
        console.warn("useReputationLoanDetails: Query disabled - user not signed in", { queryKey });
        throw new Error("Query disabled - user not signed in");
      }

      if (
        !queryAddress ||
        typeof queryAddress !== "string" ||
        !queryAddress.startsWith("0x") ||
        queryAddress.length < 10
      ) {
        console.warn("useReputationLoanDetails: Invalid address in query key, skipping API call", {
          queryAddress,
          queryKey,
          address,
        });
        // Throw immediately - this prevents ReputationService from being called
        throw new Error("Invalid address - user not signed in");
      }

      // Double check the address parameter as well
      if (!address || typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
        console.warn("useReputationLoanDetails: Invalid address parameter, skipping API call", { address });
        throw new Error("Invalid address - user not signed in");
      }

      // Final check: ensure queryAddress matches address parameter
      if (queryAddress !== address) {
        console.warn("useReputationLoanDetails: Address mismatch, skipping API call", {
          queryAddress,
          address,
        });
        throw new Error("Address mismatch - query disabled");
      }

      // Make API call only when all checks pass
      return await ReputationService.getReputationDetails(queryAddress as Address);
    },
    // Only enable if all conditions are met
    enabled: shouldEnable,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Disable retry to prevent multiple calls
    // Disable all automatic refetching
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Extract metrics from blockscout data
  const metrics = data?.blockscoutData?.customCreditworthiness?.data?.metrics
    ? {
        totalTransactions: data.blockscoutData.customCreditworthiness.data.metrics.totalTransactions || 0,
        totalTokenTransfers: data.blockscoutData.customCreditworthiness.data.metrics.totalTokenTransfers || 0,
        uniqueTokens: data.blockscoutData.customCreditworthiness.data.metrics.uniqueTokensCount || 0,
        portfolioValue: data.blockscoutData.customCreditworthiness.data.metrics.totalBalanceUSD || 0,
        defiActivity: data.blockscoutData.customCreditworthiness.data.metrics.protocolInteractions?.length || 0,
        walletAgeMonths: data.blockscoutData.customCreditworthiness.data.walletAgeMonths || 0,
        loanHistory: 0, // Will be populated from on-chain data
      }
    : undefined;

  // Extract multi-chain data if available
  const multiChain = data?.blockscoutData
    ? {
        walletAgeMonths: data.blockscoutData.customCreditworthiness.data.walletAgeMonths || 0,
        totalTransactions: data.blockscoutData.customCreditworthiness.data.metrics.totalTransactions || 0,
        portfolioValue: data.blockscoutData.customCreditworthiness.data.metrics.totalBalanceUSD || 0,
      }
    : undefined;

  return {
    metrics,
    multiChain,
    isLoading,
    error,
    data,
    refetch,
  };
};
