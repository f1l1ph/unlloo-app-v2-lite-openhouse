import { useQuery } from "@tanstack/react-query";
import { Address } from "viem";
import { useBlockNumber, usePublicClient } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

export interface LoanRequest {
  loanId: bigint;
  borrower: Address;
  status: number; // 0: Pending
  walletReputation: number;
  loanAmount: bigint;
  loanDurationBlocks: bigint;
  chainId: bigint;
  requestBlock: bigint;
  approvalBlock: bigint;
  token: Address;
  principal: bigint;
  amountRepaid: bigint;
  startBlock: bigint;
  deadlineBlock: bigint;
  protocolFee: bigint;
  protocolFeePercentageAtBorrow: bigint;
}

interface UsePendingLoanRequestsOptions {
  limit?: number;
  enabled?: boolean;
}

/**
 * Hook for admins to fetch all pending loan requests with full details
 * @param options Configuration options
 * @returns Pending loan requests with complete loan data
 */
export const usePendingLoanRequests = (options: UsePendingLoanRequestsOptions = {}) => {
  const { limit = 100, enabled = true } = options;
  const { data: blockNumber } = useBlockNumber();
  const publicClient = usePublicClient();
  const { data: contractData } = useDeployedContractInfo({ contractName: "Unlloo" });

  // Step 1: Get all pending loan IDs (status = 0 = Pending)
  const { data: pendingLoanIds, refetch: refetchIds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoansByStatus",
    args: [0, 0n, BigInt(limit)], // status = 0 (Pending), offset = 0, limit
    query: {
      enabled,
    },
  });

  // Step 2: Fetch full loan details for each pending loan ID
  // Convert BigInt array to string array for query key serialization
  const serializedLoanIds = pendingLoanIds
    ? Array.isArray(pendingLoanIds)
      ? pendingLoanIds.map((id: bigint) => id.toString())
      : []
    : [];

  // Convert blockNumber (BigInt) to string for query key serialization
  const serializedBlockNumber = blockNumber ? blockNumber.toString() : null;

  const {
    data: loanRequests,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pendingLoanRequests", serializedLoanIds, serializedBlockNumber],
    queryFn: async () => {
      if (!pendingLoanIds || !Array.isArray(pendingLoanIds) || pendingLoanIds.length === 0) {
        return [] as LoanRequest[];
      }

      if (!publicClient || !contractData) {
        throw new Error("Public client or contract not available");
      }

      // Fetch all loan details in parallel
      const loanPromises = pendingLoanIds.map(async (loanId: bigint) => {
        try {
          const loanData = await publicClient.readContract({
            address: contractData.address,
            abi: contractData.abi,
            functionName: "getLoan",
            args: [loanId],
          });

          // getLoan returns a struct as an object with named properties in viem
          // The struct has these fields in order:
          // loanId, borrower, status, walletReputation, loanAmount, loanDurationBlocks,
          // chainId, requestBlock, approvalBlock, token, principal,
          // amountRepaid, startBlock, deadlineBlock, protocolFee, protocolFeePercentageAtBorrow

          // Viem returns structs as objects, but handle both object and array formats for safety
          const loan = loanData as any;

          // Check if it's an object with named properties (preferred) or array
          const isObject = typeof loan === "object" && loan !== null && !Array.isArray(loan) && "loanId" in loan;

          if (isObject) {
            // Access as object (viem's default behavior for structs)
            return {
              loanId: loan.loanId ?? 0n,
              borrower: (loan.borrower ?? "0x0000000000000000000000000000000000000000") as Address,
              status: Number(loan.status ?? 0),
              walletReputation: Number(loan.walletReputation ?? 0),
              loanAmount: loan.loanAmount ?? 0n,
              loanDurationBlocks: loan.loanDurationBlocks ?? 0n,
              chainId: loan.chainId ?? 0n,
              requestBlock: loan.requestBlock ?? 0n,
              approvalBlock: loan.approvalBlock ?? 0n,
              token: (loan.token ?? "0x0000000000000000000000000000000000000000") as Address,
              principal: loan.principal ?? 0n,
              amountRepaid: loan.amountRepaid ?? 0n,
              startBlock: loan.startBlock ?? 0n,
              deadlineBlock: loan.deadlineBlock ?? 0n,
              protocolFee: loan.protocolFee ?? 0n,
              protocolFeePercentageAtBorrow: loan.protocolFeePercentageAtBorrow ?? 0n,
            } as LoanRequest;
          } else {
            // Fallback: access as array (for compatibility)
            const arr = Array.isArray(loan) ? loan : [];
            return {
              loanId: arr[0] ?? 0n,
              borrower: (arr[1] ?? "0x0000000000000000000000000000000000000000") as Address,
              status: Number(arr[2] ?? 0),
              walletReputation: Number(arr[3] ?? 0),
              loanAmount: arr[4] ?? 0n,
              loanDurationBlocks: arr[5] ?? 0n,
              chainId: arr[6] ?? 0n,
              requestBlock: arr[7] ?? 0n,
              approvalBlock: arr[8] ?? 0n,
              token: (arr[9] ?? "0x0000000000000000000000000000000000000000") as Address,
              principal: arr[10] ?? 0n,
              amountRepaid: arr[11] ?? 0n,
              startBlock: arr[12] ?? 0n,
              deadlineBlock: arr[13] ?? 0n,
              protocolFee: arr[14] ?? 0n,
              protocolFeePercentageAtBorrow: arr[15] ?? 0n,
            } as LoanRequest;
          }
        } catch (error) {
          console.error(`Error fetching loan ${loanId}:`, error);
          throw error;
        }
      });

      return await Promise.all(loanPromises);
    },
    enabled:
      enabled &&
      !!pendingLoanIds &&
      Array.isArray(pendingLoanIds) &&
      pendingLoanIds.length > 0 &&
      !!publicClient &&
      !!contractData,
    staleTime: 10000, // 10 seconds
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  return {
    loanRequests: loanRequests || [],
    loanIds: pendingLoanIds || [],
    isLoading,
    error,
    refetch: () => {
      refetchIds();
      refetch();
    },
  };
};
