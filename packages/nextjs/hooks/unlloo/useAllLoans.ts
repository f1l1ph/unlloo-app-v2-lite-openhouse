import { useQuery } from "@tanstack/react-query";
import { Address } from "viem";
import { useBlockNumber, usePublicClient } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

export interface LoanData {
  loanId: bigint;
  borrower: Address;
  status: number; // 0: Pending, 1: Approved, 2: Active, 3: UnpaidDebt, 4: Rejected, 5: Repaid
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

interface UseAllLoansOptions {
  status?: number; // Optional status filter (0-5)
  limit?: number;
  enabled?: boolean;
}

/**
 * Hook to fetch all loans by status with full details
 */
export const useAllLoans = (options: UseAllLoansOptions = {}) => {
  const { status, limit = 100, enabled = true } = options;
  const { data: blockNumber } = useBlockNumber();
  const publicClient = usePublicClient();
  const { data: contractData } = useDeployedContractInfo({ contractName: "Unlloo" });

  // Get loan IDs by status (or all if status not specified)
  const statusToFetch = status !== undefined ? status : 0; // Default to pending if not specified
  const { data: loanIds, refetch: refetchIds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoansByStatus",
    args: [statusToFetch as any, 0n, BigInt(limit)],
    query: {
      enabled,
    },
  });

  // Serialize loanIds for query key
  const serializedLoanIds = loanIds ? (Array.isArray(loanIds) ? loanIds.map((id: bigint) => id.toString()) : []) : [];

  const serializedBlockNumber = blockNumber ? blockNumber.toString() : null;

  const {
    data: loans,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["allLoans", statusToFetch, serializedLoanIds, serializedBlockNumber],
    queryFn: async () => {
      if (!loanIds || !Array.isArray(loanIds) || loanIds.length === 0) {
        return [] as LoanData[];
      }

      if (!publicClient || !contractData) {
        throw new Error("Public client or contract not available");
      }

      // Fetch all loan details in parallel
      const loanPromises = loanIds.map(async (loanId: bigint) => {
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
            } as LoanData;
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
            } as LoanData;
          }
        } catch (error) {
          console.error(`Error fetching loan ${loanId}:`, error);
          throw error;
        }
      });

      return await Promise.all(loanPromises);
    },
    enabled: enabled && !!loanIds && Array.isArray(loanIds) && loanIds.length > 0 && !!publicClient && !!contractData,
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchInterval: 120000, // Refetch every 2 minutes instead of 30 seconds to reduce RPC spam
  });

  return {
    loans: loans || [],
    loanIds: loanIds || [],
    isLoading,
    error,
    refetch: () => {
      refetchIds();
      refetch();
    },
  };
};
