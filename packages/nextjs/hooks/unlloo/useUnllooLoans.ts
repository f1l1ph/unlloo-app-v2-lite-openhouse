import { useQuery } from "@tanstack/react-query";
import { Address } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

interface Loan {
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
  isActive: boolean;
  totalInterest: bigint;
  repaidInterest: bigint;
  repaidPrincipal: bigint;
  expirationBlock: bigint;
}

/**
 * Hook to fetch all loans for the connected user
 */
export const useUnllooLoans = () => {
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber();
  const publicClient = usePublicClient();
  const { data: contractData } = useDeployedContractInfo({ contractName: "Unlloo" });

  // Get all loan IDs for the borrower
  const { data: loanIds } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLoansByBorrower",
    args: address ? [address] : [undefined],
  });

  // Serialize loanIds for query key (BigInt can't be serialized by JSON.stringify)
  const serializedLoanIds = loanIds ? (Array.isArray(loanIds) ? loanIds.map((id: bigint) => id.toString()) : []) : [];
  const serializedBlockNumber = blockNumber ? blockNumber.toString() : null;

  // Fetch each loan's data
  const loans = useQuery({
    queryKey: ["userLoans", address, serializedLoanIds, serializedBlockNumber],
    queryFn: async () => {
      if (!address || !loanIds || !Array.isArray(loanIds) || loanIds.length === 0) {
        return [] as Loan[];
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

          // Viem returns structs as objects
          const loan = loanData as any;
          const isObject = typeof loan === "object" && loan !== null && !Array.isArray(loan) && "loanId" in loan;

          let loanInfo: Loan;
          if (isObject) {
            loanInfo = {
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
              isActive: Number(loan.status) === 2, // Active status
              totalInterest: 0n, // Use getAccruedInterest() to get actual interest
              repaidInterest: 0n, // This would need to be calculated from repayments
              repaidPrincipal: 0n, // This would need to be calculated from repayments
              expirationBlock:
                loan.startBlock > 0n && loan.loanDurationBlocks > 0n ? loan.startBlock + loan.loanDurationBlocks : 0n,
            };
          } else {
            // Fallback: access as array
            const arr = Array.isArray(loan) ? loan : [];
            loanInfo = {
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
              isActive: Number(arr[2]) === 2,
              totalInterest: 0n, // Use getAccruedInterest() to get actual interest
              repaidInterest: 0n,
              repaidPrincipal: 0n,
              expirationBlock: arr[13] > 0n && arr[5] > 0n ? arr[13] + arr[5] : 0n,
            };
          }

          return loanInfo;
        } catch (error) {
          console.error(`Error fetching loan ${loanId}:`, error);
          throw error;
        }
      });

      return await Promise.all(loanPromises);
    },
    enabled: !!address && !!loanIds && Array.isArray(loanIds) && loanIds.length > 0 && !!publicClient && !!contractData,
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchInterval: 120000, // Refetch every 2 minutes instead of 30 seconds to reduce RPC spam
  });

  // NOTE: Event watchers removed - they were dead code (watching without reacting)
  // The borrow page handles event-driven refetching with proper query invalidation
  // This hook relies on refetchInterval for updates instead

  // Categorize loans by status
  const allLoans = loans.data || [];
  const activeLoans = allLoans.filter(loan => loan.status === 2); // Active
  const pendingLoans = allLoans.filter(loan => loan.status === 0); // Pending
  const approvedLoans = allLoans.filter(loan => loan.status === 1); // Approved
  const unpaidDebt = allLoans.filter(loan => loan.status === 3); // UnpaidDebt

  return {
    activeLoans,
    pendingLoans,
    approvedLoans,
    unpaidDebt,
    isLoading: loans.isLoading,
    error: loans.error,
  };
};
