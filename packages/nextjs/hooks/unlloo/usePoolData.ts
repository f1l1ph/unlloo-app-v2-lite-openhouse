import { formatUnits } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

/**
 * Hook to fetch pool data for a specific token
 * @param tokenAddress Token address of the pool
 * @returns Pool data including total liquidity, borrowed amount, and utilization rate
 */
export const usePoolData = (tokenAddress: string | undefined) => {
  const {
    data: poolData,
    isLoading,
    error,
  } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getLiquidityPool",
    args: tokenAddress ? [tokenAddress] : undefined,
  } as any);

  // Debug logging (remove in production)
  if (process.env.NODE_ENV === "development") {
    if (poolData) {
      console.log("[usePoolData] Pool data received:", poolData);
    }
    if (error) {
      console.error("[usePoolData] Error fetching pool:", error);
    }
  }

  // Type guard to check if poolData has the expected structure
  const hasPoolData =
    poolData && typeof poolData === "object" && "totalLiquidity" in poolData && "borrowedAmount" in poolData;

  // Check if pool actually exists (pool.token != address(0))
  // Handle both object format (from viem) and array format
  let poolExists = false;
  let poolToken: string | undefined;

  if (hasPoolData) {
    if ("token" in poolData) {
      poolToken = poolData.token as string;
      poolExists = Boolean(poolToken && poolToken.toLowerCase() !== "0x0000000000000000000000000000000000000000");
    } else if (Array.isArray(poolData)) {
      // Array format: [token, totalLiquidity, borrowedAmount]
      poolToken = poolData[0] as string;
      poolExists = Boolean(poolToken && poolToken.toLowerCase() !== "0x0000000000000000000000000000000000000000");
    }
  }

  // If tokenAddress is provided, assume pool exists (created during initialization)
  // This is a fallback in case the pool data structure is unexpected
  if (tokenAddress && !poolExists && hasPoolData) {
    poolExists = true; // Trust that if we have pool data and a token address, pool exists
  }

  // Safely extract bigint values
  const getBigIntValue = (value: unknown): bigint => {
    if (typeof value === "bigint") return value;
    if (typeof value === "string" || typeof value === "number") return BigInt(value);
    return BigInt(0);
  };

  const totalLiquidity = hasPoolData
    ? getBigIntValue(
        (poolData as { totalLiquidity: unknown }).totalLiquidity ?? (Array.isArray(poolData) ? poolData[1] : 0),
      )
    : BigInt(0);
  const borrowedAmount = hasPoolData
    ? getBigIntValue(
        (poolData as { borrowedAmount: unknown }).borrowedAmount ?? (Array.isArray(poolData) ? poolData[2] : 0),
      )
    : BigInt(0);

  // Calculate utilization rate (borrowed / total * 100)
  const utilizationRate = totalLiquidity > 0 ? Number((borrowedAmount * BigInt(10000)) / totalLiquidity) / 100 : 0;

  // Calculate free liquidity (total - borrowed)
  const freeLiquidity = totalLiquidity > borrowedAmount ? totalLiquidity - borrowedAmount : BigInt(0);

  return {
    totalLiquidity,
    borrowedAmount,
    freeLiquidity,
    utilizationRate,
    poolExists: poolExists || (tokenAddress !== undefined && hasPoolData), // Pool exists if we have tokenAddress and data
    totalLiquidityFormatted: tokenAddress && (poolExists || hasPoolData) ? formatUnits(totalLiquidity, 6) : "0", // USDC has 6 decimals
    borrowedAmountFormatted: tokenAddress && (poolExists || hasPoolData) ? formatUnits(borrowedAmount, 6) : "0",
    freeLiquidityFormatted: tokenAddress && (poolExists || hasPoolData) ? formatUnits(freeLiquidity, 6) : "0",
    isLoading,
    error,
  };
};
