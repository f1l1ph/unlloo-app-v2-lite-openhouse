"use client";

import React, { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import type { NextPage } from "next";
import { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { CurrencyDollarIcon } from "@heroicons/react/24/outline";
import { DepositModal, TokenBalanceCard, WithdrawModal } from "~~/components/unlloo";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useLenderPosition, usePoolData } from "~~/hooks/unlloo";

/**
 * Component to display a single pool row in the table
 */
const PoolRow: React.FC<{
  tokenAddress: Address;
  onDeposit: (address: Address) => void;
  onWithdraw: (address: Address) => void;
}> = ({ tokenAddress, onDeposit, onWithdraw }) => {
  const { address } = useAccount();
  const poolData = usePoolData(tokenAddress);
  const lenderPosition = useLenderPosition(address ? tokenAddress : undefined);

  // Get borrower rate in basis points
  const { data: borrowerRateBps } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "calculateBorrowRate",
    args: [tokenAddress],
  });

  // Get pool rate curve to extract protocol fee
  const { data: rateCurve } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getPoolRateCurve",
    args: [tokenAddress],
  });

  // Calculate lender rate: borrower rate * (1 - protocolFeeBps/10000)
  const lenderRateBps = useMemo(() => {
    if (!borrowerRateBps || !rateCurve) return undefined;

    // Extract protocolFeeBps from rateCurve
    let protocolFeeBps: bigint;
    if (Array.isArray(rateCurve)) {
      protocolFeeBps = typeof rateCurve[4] === "bigint" ? rateCurve[4] : BigInt(String(rateCurve[4] ?? 2500));
    } else if (typeof rateCurve === "object" && rateCurve !== null && "protocolFeeBps" in rateCurve) {
      const fee = (rateCurve as any).protocolFeeBps;
      protocolFeeBps = typeof fee === "bigint" ? fee : BigInt(String(fee ?? 2500));
    } else {
      protocolFeeBps = 2500n; // Default 25% if not found
    }

    const borrowerRate = typeof borrowerRateBps === "bigint" ? borrowerRateBps : BigInt(String(borrowerRateBps));

    // Lender rate = borrower rate * (1 - protocolFeeBps/10000)
    return (borrowerRate * (10000n - protocolFeeBps)) / 10000n;
  }, [borrowerRateBps, rateCurve]);

  const apy = lenderRateBps ? Number(lenderRateBps) / 100 : 0;

  // Show loading only if we're still loading AND don't have any data yet
  if (poolData.isLoading && !poolData.totalLiquidityFormatted && !poolData.error) {
    return (
      <tr className="border-b border-base-300/30">
        <td colSpan={6} className="py-4 text-center text-base-content/60">
          <div className="flex items-center justify-center gap-2">
            <span className="loading loading-spinner loading-sm"></span>
            <span>Loading pool data...</span>
          </div>
        </td>
      </tr>
    );
  }

  // Show error if there's an error and no data
  if (poolData.error && !poolData.totalLiquidityFormatted) {
    return (
      <tr className="border-b border-base-300/30">
        <td colSpan={6} className="py-4 text-center text-base-content/60">
          <div className="text-error">Error loading pool data. Please refresh.</div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-base-300/30 hover:bg-base-200/30 transition-colors">
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <Image src="/crypto-logos/usdc.svg" alt="USDC" width={40} height={40} />
          <div>
            <div className="font-semibold text-base-content">USDC</div>
            <div className="text-sm text-base-content/60">USD Coin</div>
          </div>
        </div>
      </td>
      <td className="text-right py-4 px-4">
        <div className="font-medium text-base-content">
          ${parseFloat(poolData.totalLiquidityFormatted || "0").toFixed(2)}
        </div>
        <div className="text-sm text-base-content/60">{poolData.utilizationRate.toFixed(2)}% utilized</div>
      </td>
      <td className="text-right py-4 px-4">
        <div className="font-bold text-success text-lg">{apy.toFixed(2)}%</div>
      </td>
      <td className="text-right py-4 px-4 hidden md:table-cell">
        <div className="font-semibold text-base-content">
          ${parseFloat(lenderPosition.depositedAmountFormatted || "0").toFixed(2)}
        </div>
        <div className="text-sm text-base-content/60">USDC</div>
      </td>
      <td className="text-right py-4 px-4 hidden md:table-cell">
        <div className="font-semibold text-success">
          +${parseFloat(lenderPosition.accruedInterestFormatted || "0").toFixed(2)}
        </div>
        <div className="text-sm text-base-content/60">USDC</div>
      </td>
      <td className="text-right py-4 px-4">
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onDeposit(tokenAddress)}
            className="px-4 py-2 bg-primary text-primary-content rounded text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Deposit
          </button>
          <button
            onClick={() => onWithdraw(tokenAddress)}
            disabled={parseFloat(lenderPosition.depositedAmountFormatted || "0") === 0}
            className="px-4 py-2 border border-primary text-primary rounded text-sm font-semibold hover:bg-primary hover:text-primary-content transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Withdraw
          </button>
        </div>
      </td>
    </tr>
  );
};

const LendPage: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedPool, setSelectedPool] = useState<Address | null>(null);

  // Get default token address (USDC pool)
  const { data: defaultToken, isLoading: isLoadingDefaultToken } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });

  // Get pool data to verify pool exists
  // const poolData = usePoolData(defaultToken ? (defaultToken as string) : undefined);

  // Get pool data and lender position for stats
  const lenderPosition = useLenderPosition(connectedAddress && defaultToken ? (defaultToken as string) : undefined);

  // Get borrower rate in basis points
  const { data: borrowerRateBps } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "calculateBorrowRate",
    args: [defaultToken],
  });

  // Get pool rate curve to extract protocol fee
  const { data: rateCurve } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getPoolRateCurve",
    args: [defaultToken],
  });

  // Calculate lender rate: borrower rate * (1 - protocolFeeBps/10000)
  const lenderRateBps = useMemo(() => {
    if (!borrowerRateBps || !rateCurve) return undefined;

    // Extract protocolFeeBps from rateCurve
    let protocolFeeBps: bigint;
    if (Array.isArray(rateCurve)) {
      protocolFeeBps = typeof rateCurve[4] === "bigint" ? rateCurve[4] : BigInt(String(rateCurve[4] ?? 2500));
    } else if (typeof rateCurve === "object" && rateCurve !== null && "protocolFeeBps" in rateCurve) {
      const fee = (rateCurve as any).protocolFeeBps;
      protocolFeeBps = typeof fee === "bigint" ? fee : BigInt(String(fee ?? 2500));
    } else {
      protocolFeeBps = 2500n; // Default 25% if not found
    }

    const borrowerRate = typeof borrowerRateBps === "bigint" ? borrowerRateBps : BigInt(String(borrowerRateBps));

    // Lender rate = borrower rate * (1 - protocolFeeBps/10000)
    return (borrowerRate * (10000n - protocolFeeBps)) / 10000n;
  }, [borrowerRateBps, rateCurve]);

  // Calculate statistics
  const stats = useMemo(() => {
    const deposited = parseFloat(lenderPosition.depositedAmountFormatted);
    const earned = parseFloat(lenderPosition.accruedInterestFormatted);
    const apy = lenderRateBps ? Number(lenderRateBps) / 100 : 0;
    const projectedAnnualYield = deposited * (apy / 100);

    return {
      totalDeposited: deposited,
      totalEarned: earned,
      avgApy: apy,
      projectedAnnualYield,
    };
  }, [lenderPosition.depositedAmountFormatted, lenderPosition.accruedInterestFormatted, lenderRateBps]);

  const handleDeposit = (address: Address) => {
    setSelectedPool(address);
    setShowDepositModal(true);
  };

  const handleWithdraw = (address: Address) => {
    setSelectedPool(address);
    setShowWithdrawModal(true);
  };

  // Refetch data after successful transactions
  const handleTransactionSuccess = useCallback(async () => {
    try {
      if (publicClient) {
        const txBlockNumber = await publicClient.getBlockNumber();
        const targetBlock = txBlockNumber + 1n;
        const maxWaitTime = 15000;
        const startTime = Date.now();

        while (true) {
          const latestBlock = await publicClient.getBlockNumber();
          if (latestBlock >= targetBlock) break;
          if (Date.now() - startTime > maxWaitTime) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Invalidate contract queries
      queryClient.invalidateQueries({
        queryKey: ["readContract"],
      });

      // Invalidate balance queries to refetch token balances
      queryClient.invalidateQueries({
        queryKey: ["balance"],
      });
    } catch (error) {
      console.error("Error in handleTransactionSuccess:", error);
    }
  }, [publicClient, queryClient]);

  if (!connectedAddress) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="bg-base-100 rounded-xl border border-base-300/50 p-8 max-w-md mx-auto text-center">
          <h2 className="text-xl font-bold text-base-content mb-2">Connect Your Wallet</h2>
          <p className="text-sm text-base-content/70">
            Please connect your wallet to view and interact with lending pools
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-6 md:py-8 bg-base-200">
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <div className="flex items-center gap-3 mb-2">
            <CurrencyDollarIcon className="h-8 w-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold text-base-content">Lend</h1>
          </div>
          <p className="text-base md:text-lg text-base-content/70">
            Deposit assets to earn dynamic interest on your holdings
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
          <div className="bg-base-100 rounded-lg md:rounded-xl border border-base-300/50 p-3 md:p-4">
            <div className="text-xs md:text-sm text-base-content/70 font-medium mb-1 md:mb-2">Total Deposited</div>
            <div className="text-xl md:text-3xl font-bold text-base-content">${stats.totalDeposited.toFixed(2)}</div>
          </div>
          <div className="bg-base-100 rounded-lg md:rounded-xl border border-base-300/50 p-3 md:p-4">
            <div className="text-xs md:text-sm text-base-content/70 font-medium mb-1 md:mb-2">Total Earned</div>
            <div className="text-xl md:text-3xl font-bold text-success">${stats.totalEarned.toFixed(2)}</div>
          </div>
          <div className="bg-base-100 rounded-lg md:rounded-xl border border-base-300/50 p-3 md:p-4">
            <div className="text-xs md:text-sm text-base-content/70 font-medium mb-1 md:mb-2">Avg APY</div>
            <div className="text-xl md:text-3xl font-bold text-success">~{stats.avgApy.toFixed(2)}%</div>
          </div>
          <div className="bg-base-100 rounded-lg md:rounded-xl border border-base-300/50 p-3 md:p-4">
            <div className="text-xs md:text-sm text-base-content/70 font-medium mb-1 md:mb-2">
              1-Year Projected Yield
            </div>
            <div className="text-xl md:text-3xl font-bold text-success">~${stats.projectedAnnualYield.toFixed(2)}</div>
          </div>
        </div>

        {/* Token Balances */}
        {connectedAddress && defaultToken && (
          <div className="bg-base-100 rounded-xl border border-base-300/50 p-4 md:p-6 mb-6 md:mb-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 md:mb-5 gap-2">
              <h3 className="text-lg md:text-xl font-bold text-base-content">Your Token Balances</h3>
              <div className="text-xs text-base-content/60">
                <span className="hidden md:inline">Address: </span>
                <span className="font-mono">
                  {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <TokenBalanceCard label="ETH" symbol="ETH" />
              <TokenBalanceCard tokenAddress={defaultToken as Address} />
            </div>
          </div>
        )}

        {/* Pools Table */}
        <div className="bg-base-100 rounded-xl border border-base-300/50 overflow-hidden">
          <div className="px-4 md:px-6 pt-3 md:pt-3.5 pb-2 md:pb-2.5 border-b border-base-300/50 flex items-center justify-between">
            <h3 className="text-lg md:text-xl font-bold text-base-content">All Pools</h3>
            <div className="text-xs md:text-sm text-base-content/60">
              {isLoadingDefaultToken ? "Loading..." : defaultToken ? "1 pool" : "No pools available"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-b border-base-300/50">
                  <th className="font-semibold text-base-content/60 bg-base-200/50 p-2 md:p-3 text-left">Asset</th>
                  <th className="font-semibold text-base-content/60 bg-base-200/50 p-2 md:p-3 text-right">TVL</th>
                  <th className="font-semibold text-base-content/60 bg-base-200/50 p-2 md:p-3 text-right">APY</th>
                  <th className="font-semibold text-base-content/60 bg-base-200/50 p-2 md:p-3 text-right hidden md:table-cell">
                    Deposited
                  </th>
                  <th className="font-semibold text-base-content/60 bg-base-200/50 p-2 md:p-3 text-right hidden md:table-cell">
                    Earnings
                  </th>
                  <th className="font-semibold text-base-content/60 bg-base-200/50 p-2 md:p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingDefaultToken ? (
                  <tr>
                    <td colSpan={6} className="py-6 md:py-8 text-center text-base-content/60">
                      <div className="flex items-center justify-center gap-2">
                        <span className="loading loading-spinner loading-sm"></span>
                        <span>Loading pool data...</span>
                      </div>
                    </td>
                  </tr>
                ) : !defaultToken ? (
                  <tr>
                    <td colSpan={6} className="py-6 md:py-8 text-center text-base-content/60">
                      <div className="space-y-1">
                        <p>No pools available.</p>
                        <p className="text-xs">
                          Pools will appear here once deployed.
                          <br />
                          Run <code className="bg-base-200 px-1 rounded text-xs font-mono">yarn deploy</code>
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <PoolRow
                    tokenAddress={defaultToken as Address}
                    onDeposit={handleDeposit}
                    onWithdraw={handleWithdraw}
                  />
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modals */}
        {selectedPool && (
          <>
            <DepositModal
              isOpen={showDepositModal}
              onClose={() => {
                setShowDepositModal(false);
                setSelectedPool(null);
              }}
              poolAddress={selectedPool}
              assetSymbol="USDC"
              assetName="USD Coin"
              onTransactionSuccess={handleTransactionSuccess}
            />
            <WithdrawModal
              isOpen={showWithdrawModal}
              onClose={() => {
                setShowWithdrawModal(false);
                setSelectedPool(null);
              }}
              poolAddress={selectedPool}
              assetSymbol="USDC"
              assetName="USD Coin"
              assetDecimals={6}
              depositedAmount={lenderPosition.depositedAmountFormatted}
              totalWithdrawable={lenderPosition.totalWithdrawableFormatted}
              onTransactionSuccess={handleTransactionSuccess}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default LendPage;
