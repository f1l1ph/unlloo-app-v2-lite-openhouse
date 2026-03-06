import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

/**
 * Hook to fetch general protocol statistics for the homepage
 * @returns Protocol stats including TVL, total borrowed, active lenders, average APY, pending loan requests,
 *          repaid loans, total loans, active loans, utilization rate, protocol fees, and success rate
 */
export const useHomepageStats = () => {
  const publicClient = usePublicClient();
  const { data: contractData } = useDeployedContractInfo({ contractName: "Unlloo" });

  // Get default token address
  const { data: defaultToken } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });

  // Get pool data for default token
  const { data: poolData, isLoading: isLoadingPool } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLiquidityPool",
    args: [defaultToken] as readonly [string | undefined],
  });

  // Get borrower rate in basis points
  const { data: borrowerRateBps, isLoading: isLoadingBorrowerRate } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "calculateBorrowRate",
    args: [defaultToken],
  });

  // Get pool rate curve to extract protocol fee
  const { data: rateCurve, isLoading: isLoadingRateCurve } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getPoolRateCurve",
    args: [defaultToken],
  });

  // Calculate lender rate: borrower rate * (1 - protocolFeeBps/10000)
  const lenderRateBps = useMemo(() => {
    if (!borrowerRateBps || !rateCurve) return undefined;

    let protocolFeeBps: bigint;
    if (Array.isArray(rateCurve)) {
      protocolFeeBps = typeof rateCurve[4] === "bigint" ? rateCurve[4] : BigInt(String(rateCurve[4] ?? 2500));
    } else if (typeof rateCurve === "object" && rateCurve !== null && "protocolFeeBps" in rateCurve) {
      const fee = (rateCurve as any).protocolFeeBps;
      protocolFeeBps = typeof fee === "bigint" ? fee : BigInt(String(fee ?? 2500));
    } else {
      protocolFeeBps = 2500n;
    }

    const borrowerRate = typeof borrowerRateBps === "bigint" ? borrowerRateBps : BigInt(String(borrowerRateBps));
    return (borrowerRate * (10000n - protocolFeeBps)) / 10000n;
  }, [borrowerRateBps, rateCurve]);

  const isLoadingLenderRate = isLoadingBorrowerRate || isLoadingRateCurve;

  // Get active lender count from contract
  const { data: activeLenderCount, isLoading: isLoadingActiveLenders } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getActiveLenderCount",
    args: defaultToken ? [defaultToken] : undefined,
  } as any);

  // Get pending loans array (status 0)
  const { data: pendingLoans, isLoading: isLoadingPendingLoans } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "loansByStatus",
    args: [0],
  } as any);

  // Get active loans array (status 2)
  const { data: activeLoans, isLoading: isLoadingActiveLoans } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "loansByStatus",
    args: [2],
  } as any);

  // Get repaid loans array (status 5)
  const { data: repaidLoansIds, isLoading: isLoadingRepaidLoans } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "loansByStatus",
    args: [5],
  } as any);

  // Get unpaid debt loans array (status 3)
  const { data: unpaidDebtLoans, isLoading: isLoadingUnpaidDebt } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "loansByStatus",
    args: [3],
  } as any);

  // Get total loans created (loanCounter)
  const { data: loanCounter, isLoading: isLoadingLoanCounter } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "loanCounter",
  });

  // Get protocol fees
  const { data: protocolFeesRaw, isLoading: isLoadingProtocolFees } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getProtocolFees",
    args: [defaultToken],
  } as any);

  // Fetch total amount repaid by summing amountRepaid from all repaid loans
  const serializedRepaidIds = repaidLoansIds
    ? Array.isArray(repaidLoansIds)
      ? repaidLoansIds.map((id: bigint) => id.toString())
      : []
    : [];

  const { data: totalAmountRepaid, isLoading: isLoadingTotalRepaid } = useQuery({
    queryKey: ["totalAmountRepaid", serializedRepaidIds],
    queryFn: async () => {
      const repaidIds = repaidLoansIds as bigint[] | undefined;
      if (!repaidIds || repaidIds.length === 0) {
        return 0n;
      }
      if (!publicClient || !contractData) {
        return 0n;
      }

      let total = 0n;
      for (const loanId of repaidIds) {
        try {
          const loanData = await publicClient.readContract({
            address: contractData.address,
            abi: contractData.abi,
            functionName: "getLoan",
            args: [loanId],
          });
          const loan = loanData as any;
          const amountRepaid = loan?.amountRepaid ?? loan?.[11] ?? 0n;
          total += typeof amountRepaid === "bigint" ? amountRepaid : BigInt(String(amountRepaid));
        } catch {
          // Skip failed loan fetches
        }
      }
      return total;
    },
    enabled: !!repaidLoansIds && !!publicClient && !!contractData,
    staleTime: 30000,
  });

  // Calculate statistics
  const stats = useMemo(() => {
    const hasPoolData = poolData && typeof poolData === "object" && "totalLiquidity" in poolData;

    // Total Value Locked (TVL) - USDC has 6 decimals
    const totalValueLockedRaw = hasPoolData
      ? parseFloat(formatUnits((poolData as { totalLiquidity: bigint }).totalLiquidity || BigInt(0), 6))
      : 0;

    // Total Borrowed - USDC has 6 decimals
    const totalBorrowedRaw = hasPoolData
      ? parseFloat(formatUnits((poolData as { borrowedAmount: bigint }).borrowedAmount || BigInt(0), 6))
      : 0;

    // Active lenders count
    const activeLenders = activeLenderCount ? Number(activeLenderCount) : 0;

    // Average APY - convert basis points to percentage
    const averageAPY = lenderRateBps ? Number(lenderRateBps) / 100 : 0;

    // Pending loan requests count
    const pendingLoanRequests = pendingLoans && Array.isArray(pendingLoans) ? pendingLoans.length : 0;

    // Active loans count
    const activeLoansCount = activeLoans && Array.isArray(activeLoans) ? activeLoans.length : 0;

    // Repaid loans count
    const repaidLoansCount = repaidLoansIds && Array.isArray(repaidLoansIds) ? repaidLoansIds.length : 0;

    // Unpaid debt loans count
    const unpaidDebtCount = unpaidDebtLoans && Array.isArray(unpaidDebtLoans) ? unpaidDebtLoans.length : 0;

    // Total loans ever created
    const totalLoansCreated = loanCounter ? Number(loanCounter) : 0;

    // Total amount repaid - USDC has 6 decimals
    const totalRepaidRaw = totalAmountRepaid ? parseFloat(formatUnits(totalAmountRepaid, 6)) : 0;

    // Protocol fees earned - USDC has 6 decimals
    const protocolFeesEarned = protocolFeesRaw ? parseFloat(formatUnits(BigInt(String(protocolFeesRaw)), 6)) : 0;

    // Utilization rate (borrowed / TVL * 100)
    const utilizationRate = totalValueLockedRaw > 0 ? (totalBorrowedRaw / totalValueLockedRaw) * 100 : 0;

    // Success rate (repaid / (repaid + unpaidDebt) * 100)
    const totalCompleted = repaidLoansCount + unpaidDebtCount;
    const successRate = totalCompleted > 0 ? (repaidLoansCount / totalCompleted) * 100 : 100;

    const isLoading =
      isLoadingPool ||
      isLoadingLenderRate ||
      isLoadingActiveLenders ||
      isLoadingPendingLoans ||
      isLoadingActiveLoans ||
      isLoadingRepaidLoans ||
      isLoadingUnpaidDebt ||
      isLoadingLoanCounter ||
      isLoadingProtocolFees ||
      isLoadingTotalRepaid ||
      defaultToken === undefined;

    return {
      // Liquidity stats
      totalValueLocked: totalValueLockedRaw.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
      totalValueLockedRaw,
      totalBorrowed: totalBorrowedRaw.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
      totalBorrowedRaw,
      utilizationRate: utilizationRate.toFixed(1),
      utilizationRateRaw: utilizationRate,

      // Lender stats
      activeLenders,
      averageAPY: averageAPY.toFixed(2),

      // Loan activity stats
      pendingLoanRequests,
      activeLoansCount,
      totalLoansCreated,

      // Repayment stats
      repaidLoansCount,
      totalAmountRepaid: totalRepaidRaw.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
      totalAmountRepaidRaw: totalRepaidRaw,

      // Health stats
      unpaidDebtCount,
      successRate: successRate.toFixed(1),
      successRateRaw: successRate,

      // Protocol stats
      protocolFeesEarned: protocolFeesEarned.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      protocolFeesEarnedRaw: protocolFeesEarned,

      isLoading,
    };
  }, [
    poolData,
    lenderRateBps,
    activeLenderCount,
    pendingLoans,
    activeLoans,
    repaidLoansIds,
    unpaidDebtLoans,
    loanCounter,
    totalAmountRepaid,
    protocolFeesRaw,
    isLoadingPool,
    isLoadingLenderRate,
    isLoadingActiveLenders,
    isLoadingPendingLoans,
    isLoadingActiveLoans,
    isLoadingRepaidLoans,
    isLoadingUnpaidDebt,
    isLoadingLoanCounter,
    isLoadingProtocolFees,
    isLoadingTotalRepaid,
    defaultToken,
  ]);

  return stats;
};
