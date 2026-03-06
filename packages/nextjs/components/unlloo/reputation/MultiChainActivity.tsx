import React from "react";
import { ChainActivity } from "~~/services/api/reputation.service";

interface MultiChainActivityProps {
  chainActivity: ChainActivity[];
  isLoading?: boolean;
}

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  base: "Base",
  avalanche: "Avalanche",
  optimism: "Optimism",
};

export const MultiChainActivity: React.FC<MultiChainActivityProps> = ({ chainActivity, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-base-100 border border-base-300 rounded-xl shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-base-300 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-base-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // If no chainActivity data from API, return null for now
  // Once API is updated and restarted, this will show real data
  if (!chainActivity || chainActivity.length === 0) {
    return null;
  }

  const activeChains = chainActivity.filter(c => c.hasActivity);
  const totalChains = chainActivity.length;
  const activeChainCount = activeChains.length;

  return (
    <div className="bg-base-100 border border-base-300 rounded-xl shadow-sm overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-base-content">Multi-Chain Activity</h3>
            <p className="text-sm text-base-content/60 mt-1">
              Activity across {totalChains} supported chains · Active on {activeChainCount}{" "}
              {activeChainCount === 1 ? "chain" : "chains"}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {chainActivity.map(chain => {
            const displayName = CHAIN_DISPLAY_NAMES[chain.chain] || chain.chain;
            const hasActivity = chain.hasActivity;

            return (
              <div
                key={chain.chain}
                className={`p-4 rounded-lg border transition-colors ${
                  hasActivity ? "bg-base-200/50 border-base-300" : "bg-base-100 border-base-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${hasActivity ? "bg-success" : "bg-base-300"}`}></div>
                    <span className="font-medium text-base-content">{displayName}</span>
                  </div>

                  {hasActivity ? (
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-base-content/70">
                        <span className="font-semibold text-base-content">{chain.transactionCount}</span> tx
                      </span>
                      <span className="text-base-content/70">
                        <span className="font-semibold text-base-content">{chain.tokenTransferCount}</span> transfers
                      </span>
                      <span className="text-base-content/70">
                        <span className="font-semibold text-base-content">{chain.uniqueTokensCount}</span> tokens
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-base-content/40">No activity</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
