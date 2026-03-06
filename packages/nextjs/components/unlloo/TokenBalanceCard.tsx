import React from "react";
import Image from "next/image";
import { Address } from "viem";
import { formatEther, formatUnits } from "viem";
import { useAccount, useBalance } from "wagmi";

interface TokenBalanceCardProps {
  tokenAddress?: Address;
  label?: string;
  symbol?: string;
}

/**
 * Component to display token balance (ETH or ERC20)
 * Optimized with loading states, error handling, and automatic refetching
 */
export const TokenBalanceCard: React.FC<TokenBalanceCardProps> = ({ tokenAddress, label, symbol: providedSymbol }) => {
  const { address } = useAccount();

  // Read ETH balance if no token address, otherwise read ERC20 balance
  // Enable automatic refetching for real-time updates
  const {
    data: ethBalance,
    isLoading: isLoadingEth,
    error: ethError,
    refetch: refetchEth,
  } = useBalance({
    address,
    query: {
      refetchInterval: 10000, // Refetch every 10 seconds
      staleTime: 5000, // Consider data stale after 5 seconds
    },
  });

  const {
    data: tokenBalance,
    isLoading: isLoadingToken,
    error: tokenError,
    refetch: refetchToken,
  } = useBalance({
    address,
    token: tokenAddress,
    query: {
      enabled: !!tokenAddress && !!address,
      refetchInterval: 10000, // Refetch every 10 seconds
      staleTime: 5000, // Consider data stale after 5 seconds
    },
  });

  // Determine which balance to use and its loading/error state
  const isLoading = tokenAddress ? isLoadingToken : isLoadingEth;
  const error = tokenAddress ? tokenError : ethError;
  const balanceValue = tokenAddress ? tokenBalance?.value : ethBalance?.value;
  const balanceDecimals = tokenAddress ? 6 : 18; // USDC has 6 decimals, ETH has 18

  const formattedBalance =
    balanceValue !== undefined
      ? balanceDecimals === 6
        ? formatUnits(balanceValue, 6)
        : formatEther(balanceValue)
      : "0";

  const balanceNum = parseFloat(formattedBalance);
  const hasBalance = balanceNum > 0;
  const displaySymbol = providedSymbol || (tokenAddress ? "USDC" : "ETH");
  const displayName = label || displaySymbol;

  return (
    <div
      className={`bg-base-200 rounded-lg p-3 md:p-4 border border-base-300/30 transition-opacity ${
        !hasBalance && !isLoading ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {displaySymbol === "USDC" ? (
            <Image src="/crypto-logos/usdc.svg" alt="USDC" width={32} height={32} className="shrink-0" />
          ) : displaySymbol === "ETH" || displaySymbol === "WETH" ? (
            <Image src="/crypto-logos/weth.svg" alt="ETH" width={32} height={32} className="shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary">{displaySymbol.slice(0, 2)}</span>
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-base-content text-sm md:text-base truncate">{displayName}</div>
            <div className="text-xs text-base-content/60">{displaySymbol}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          {isLoading ? (
            <div className="flex flex-col items-end gap-1">
              <div className="h-5 w-16 bg-base-300/50 rounded animate-pulse" />
              <div className="h-3 w-12 bg-base-300/30 rounded animate-pulse" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-end gap-1">
              <div className="text-xs text-error">Error</div>
              <button
                onClick={() => (tokenAddress ? refetchToken() : refetchEth())}
                className="text-xs text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <div
                className={`text-base md:text-lg font-bold ${
                  hasBalance ? "text-base-content" : "text-base-content/50"
                }`}
              >
                {balanceNum.toLocaleString(undefined, {
                  maximumFractionDigits: balanceDecimals === 6 ? 6 : 4,
                  minimumFractionDigits: 0,
                })}
              </div>
              {!hasBalance && <div className="text-xs text-base-content/40 mt-0.5">No balance</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
