import React from "react";
import { InformationCircleIcon } from "@heroicons/react/24/outline";

const MORALIS_PORTFOLIO_CHAINS = [
  "eth",
  "polygon",
  "bsc",
  "avalanche",
  "fantom",
  "cronos",
  "arbitrum",
  "chiliz",
  "gnosis",
  "base",
  "optimism",
  "linea",
  "moonbeam",
  "flow",
  "ronin",
  "lisk",
  "pulse",
  "sei",
  "monad",
] as const;

interface ReputationFactorsProps {
  walletAgeMonths: number;
  totalTransactions: number;
  avgTxValue: number;
  defiActivity: number;
  defiProjectCount?: number;
  uniqueTokens: number;
  portfolioValue: number | null;
  isLoading?: boolean;
}

interface FactorCardProps {
  label: string;
  value: string | number;
  maxValue: number;
  currentValue: number;
  tooltip?: string;
  isLoading?: boolean;
  comingSoon?: boolean;
}

const FactorCard: React.FC<FactorCardProps> = ({
  label,
  value,
  maxValue,
  currentValue,
  tooltip,
  isLoading,
  comingSoon,
}) => {
  const percentage = Math.min((currentValue / maxValue) * 100, 100);

  const getColor = (percentage: number) => {
    if (percentage >= 70) return "bg-success";
    if (percentage >= 40) return "bg-warning";
    return "bg-error";
  };

  if (isLoading) {
    return (
      <div className="bg-base-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-4 bg-base-300 rounded w-24 animate-pulse"></div>
        </div>
        <div className="h-8 bg-base-300 rounded w-20 mb-3 animate-pulse"></div>
        <div className="h-2 bg-base-300 rounded w-full animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="bg-base-200 rounded-xl p-4 transition-all duration-200 hover:shadow-md">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-base-content/60 font-medium">{label}</span>
        {tooltip && (
          <div className="tooltip tooltip-top" data-tip={tooltip}>
            <InformationCircleIcon className="h-4 w-4 text-base-content/40" />
          </div>
        )}
      </div>
      {comingSoon ? (
        <div className="mb-3">
          <div className="text-sm font-medium text-base-content/50 mb-1">Used in calculation</div>
          <div className="text-xs text-base-content/40 italic">Details coming soon</div>
        </div>
      ) : (
        <div className="text-2xl font-bold text-base-content mb-3">{value}</div>
      )}
      <div className="w-full bg-base-300 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getColor(percentage)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export const ReputationFactors: React.FC<ReputationFactorsProps> = ({
  walletAgeMonths,
  totalTransactions,
  //avgTxValue,
  defiProjectCount,
  uniqueTokens,
  portfolioValue,
  isLoading = false,
}) => {
  // Wallet age display: show months if >= 3 months, otherwise show days
  const walletAgeDays = Math.round(walletAgeMonths * 30.44);
  const displayWalletAge = walletAgeMonths >= 3 ? `${Math.round(walletAgeMonths)} months` : `${walletAgeDays} days`;

  // Use months for benchmark if showing months, otherwise days
  const walletAgeValue = walletAgeMonths >= 3 ? walletAgeMonths : walletAgeDays;
  const maxWalletAge = walletAgeMonths >= 3 ? 12 : 90; // 1 year or 90 days

  // Calculate max values for percentage bars (these are reasonable benchmarks)
  const maxTransactions = 1000;
  const maxAvgTxValue = 1000;
  const maxDefiActivity = 20;
  const maxUniqueTokens = 50;
  const maxPortfolioValue = 10000;

  return (
    <div className="card-unlloo animate-slide-up [animation-delay:0.1s]">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
          <span className="text-2xl">🛡️</span>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-base-content">Reputation Factors</h2>
          <p className="text-sm text-base-content/60">On-chain activity breakdown</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FactorCard
          label="Wallet Age"
          value={displayWalletAge}
          maxValue={maxWalletAge}
          currentValue={walletAgeValue}
          tooltip="Time since first transaction. Older wallets indicate established history."
          isLoading={isLoading}
        />

        <FactorCard
          label="Transactions"
          value={totalTransactions.toLocaleString()}
          maxValue={maxTransactions}
          currentValue={totalTransactions}
          tooltip="Total number of transactions executed across all chains"
          isLoading={isLoading}
        />

        <FactorCard
          label="Avg Transfer Value"
          value="Coming Soon"
          maxValue={maxAvgTxValue}
          currentValue={0}
          tooltip="Average USD value per token transfer (total value transferred / token transfers)"
          isLoading={isLoading}
          comingSoon={true}
        />

        <FactorCard
          label="DeFi Activity"
          value={defiProjectCount != null && defiProjectCount > 0 ? `${defiProjectCount} protocols` : "Coming Soon"}
          maxValue={maxDefiActivity}
          currentValue={defiProjectCount ?? 0}
          tooltip="Number of unique DeFi protocols interacted with (via growthepie)"
          isLoading={isLoading}
          comingSoon={defiProjectCount == null || defiProjectCount === 0}
        />

        <FactorCard
          label="Token Diversity"
          value={uniqueTokens}
          maxValue={maxUniqueTokens}
          currentValue={uniqueTokens}
          tooltip="Number of unique tokens held (indicates portfolio diversification)"
          isLoading={isLoading}
        />

        <FactorCard
          label="Portfolio Value"
          value={
            portfolioValue !== null
              ? `$${portfolioValue >= 1000 ? (portfolioValue / 1000).toFixed(1) + "K" : portfolioValue.toFixed(0)}`
              : "Unavailable"
          }
          maxValue={maxPortfolioValue}
          currentValue={portfolioValue ?? 0}
          tooltip={`Total value of all token holdings in USD (via Moralis, EVM chains only, HyperEVM excluded). Chains: ${MORALIS_PORTFOLIO_CHAINS.join(
            ", ",
          )}`}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};
