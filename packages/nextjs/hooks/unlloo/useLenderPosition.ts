import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

/**
 * Hook to fetch lender position data for a specific token pool
 * @param tokenAddress Token address of the pool
 * @returns Lender position data including deposited amount, accrued interest, and total withdrawable
 */
export const useLenderPosition = (tokenAddress: string | undefined) => {
  const { address } = useAccount();

  const { data: positionData, isLoading } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLenderPosition",
    args: address && tokenAddress ? [address, tokenAddress] : undefined,
  } as any);

  // Safely extract and convert to bigint
  const getBigIntValue = (value: unknown): bigint => {
    if (typeof value === "bigint") return value;
    if (typeof value === "string" || typeof value === "number") return BigInt(value);
    return BigInt(0);
  };

  const depositedAmount = positionData && Array.isArray(positionData) ? getBigIntValue(positionData[0]) : BigInt(0);
  const accruedInterest = positionData && Array.isArray(positionData) ? getBigIntValue(positionData[1]) : BigInt(0);
  const totalWithdrawable = positionData && Array.isArray(positionData) ? getBigIntValue(positionData[2]) : BigInt(0);

  return {
    depositedAmount,
    accruedInterest,
    totalWithdrawable,
    depositedAmountFormatted: tokenAddress ? formatUnits(depositedAmount, 6) : "0", // USDC has 6 decimals
    accruedInterestFormatted: tokenAddress ? formatUnits(accruedInterest, 6) : "0",
    totalWithdrawableFormatted: tokenAddress ? formatUnits(totalWithdrawable, 6) : "0",
    isLoading,
  };
};
