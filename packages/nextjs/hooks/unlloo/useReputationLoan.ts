import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Address } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { ReputationService } from "~~/services/api/reputation.service";
import { notification } from "~~/utils/scaffold-eth/notification";

interface UseReputationLoanOptions {
  enabled?: boolean;
}

/**
 * Hook to fetch and manage reputation data for loan purposes
 */
export const useReputationLoan = (address: Address | undefined, options: UseReputationLoanOptions = {}) => {
  const queryClient = useQueryClient();

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
  const queryKey = shouldEnable && address ? ["reputation", address] : ["reputation", "disabled"];

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
        console.warn("useReputationLoan: Query disabled based on query key, throwing immediately", {
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
        console.warn("useReputationLoan: Query disabled - user not signed in", { queryKey });
        throw new Error("Query disabled - user not signed in");
      }

      if (
        !queryAddress ||
        typeof queryAddress !== "string" ||
        !queryAddress.startsWith("0x") ||
        queryAddress.length < 10
      ) {
        console.warn("useReputationLoan: Invalid address in query key, skipping API call", {
          queryAddress,
          queryKey,
          address,
        });
        // Throw immediately - this prevents ReputationService from being called
        throw new Error("Invalid address - user not signed in");
      }

      // Double check the address parameter as well
      if (!address || typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
        console.warn("useReputationLoan: Invalid address parameter, skipping API call", { address });
        throw new Error("Invalid address - user not signed in");
      }

      // Final check: ensure queryAddress matches address parameter
      if (queryAddress !== address) {
        console.warn("useReputationLoan: Address mismatch, skipping API call", {
          queryAddress,
          address,
        });
        throw new Error("Address mismatch - query disabled");
      }

      // Make API call only when all checks pass
      return await ReputationService.getReputation(queryAddress as Address);
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

  const calculateReputation = useMutation({
    mutationFn: async () => {
      // Ensure address exists before making API call
      if (!address) {
        throw new Error("Address is required. Please connect your wallet.");
      }
      const loadingToast = notification.loading("Calculating reputation...");
      try {
        const result = await ReputationService.getReputation(address);
        notification.remove(loadingToast);
        notification.success("Reputation calculated successfully");
        return result;
      } catch (error) {
        notification.remove(loadingToast);
        const errorMessage = error instanceof Error ? error.message : "Failed to calculate reputation";
        notification.error(errorMessage);
        throw error;
      }
    },
    onSuccess: data => {
      if (address) {
        queryClient.setQueryData(["reputation", address], data);
        queryClient.invalidateQueries({ queryKey: ["reputation", address, "details"] });
      }
    },
  });

  // Read minReputation from contract
  const { data: minReputation } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "minReputation",
  });

  const reputation = data?.walletReputation || 0;
  const maxAmount = data?.maxLoanAmount || 0;
  const maxLoanDuration = data?.maxLoanDuration || 0;
  const recommendedRate = data?.recommendedInterest || 0;
  const lastUpdatedBlockNumber = data?.blockNumber || 0;
  const isBlocked = reputation < (Number(minReputation) || 200);

  return {
    reputation,
    maxAmount,
    maxLoanDuration,
    recommendedRate,
    lastUpdatedBlockNumber,
    isBlocked,
    calculateReputation: calculateReputation.mutate,
    isLoading: isLoading || calculateReputation.isPending,
    error,
    data,
    refetch,
  };
};
