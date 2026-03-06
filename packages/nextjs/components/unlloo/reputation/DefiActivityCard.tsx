"use client";

import React, { useMemo, useState } from "react";
import { ChartBarIcon, ChevronDownIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { GrowthepieProjectInteraction } from "~~/services/api/reputation.service";

interface DefiActivityCardProps {
  projects: GrowthepieProjectInteraction[];
  projectCount: number;
  weightedScore: number;
  chainsQueried: string[];
  normalizedScore: number;
  isLoading?: boolean;
}

interface GroupedProtocol {
  name: string;
  chains: string[];
  totalTxCount: number;
  totalGasUsed: number;
  totalWeightedScore: number;
  maxWeight: number;
}

const INITIAL_DISPLAY_COUNT = 5;
const MAX_DISPLAY_COUNT = 15;
const MAX_CHAINS_DISPLAY = 5;

/** Classify a project by its weight into a tier */
const getProjectTier = (weight: number): { label: string; color: string } => {
  if (weight >= 10) return { label: "High", color: "badge-success" };
  if (weight >= 5) return { label: "Medium", color: "badge-warning" };
  return { label: "Standard", color: "badge-ghost" };
};

/** Format chain key for display with short name for badges */
const formatChainName = (chain: string, short = false): string => {
  const names: Record<string, { full: string; short: string }> = {
    ethereum: { full: "Ethereum", short: "ETH" },
    optimism: { full: "Optimism", short: "OP" },
    arbitrum: { full: "Arbitrum", short: "ARB" },
    base: { full: "Base", short: "BASE" },
    polygon_zkevm: { full: "Polygon zkEVM", short: "zkEVM" },
    zksync_era: { full: "zkSync Era", short: "zkSync" },
    avalanche: { full: "Avalanche", short: "AVAX" },
  };
  const chainData = names[chain] || {
    full: chain.charAt(0).toUpperCase() + chain.slice(1),
    short: chain.toUpperCase(),
  };
  return short ? chainData.short : chainData.full;
};

/** Group projects by protocol name across chains */
const groupProtocolsByName = (projects: GrowthepieProjectInteraction[]): GroupedProtocol[] => {
  const grouped = new Map<string, GroupedProtocol>();

  projects.forEach(project => {
    const existing = grouped.get(project.owner_project);

    if (existing) {
      existing.chains.push(project.chain);
      existing.totalTxCount += project.tx_count;
      existing.totalGasUsed += project.total_gas_used;
      existing.totalWeightedScore += project.weighted_score;
      existing.maxWeight = Math.max(existing.maxWeight, project.weight);
    } else {
      grouped.set(project.owner_project, {
        name: project.owner_project,
        chains: [project.chain],
        totalTxCount: project.tx_count,
        totalGasUsed: project.total_gas_used,
        totalWeightedScore: project.weighted_score,
        maxWeight: project.weight,
      });
    }
  });

  return Array.from(grouped.values()).sort((a, b) => b.totalWeightedScore - a.totalWeightedScore);
};

export const DefiActivityCard: React.FC<DefiActivityCardProps> = ({
  projects,
  weightedScore,
  chainsQueried,
  isLoading = false,
}) => {
  const [showAll, setShowAll] = useState(false);

  const groupedProtocols = useMemo(() => groupProtocolsByName(projects), [projects]);

  const displayedProtocols = useMemo(() => {
    const count = showAll ? MAX_DISPLAY_COUNT : INITIAL_DISPLAY_COUNT;
    return groupedProtocols.slice(0, count);
  }, [groupedProtocols, showAll]);

  const canShowMore = groupedProtocols.length > INITIAL_DISPLAY_COUNT;
  const hasMore = groupedProtocols.length > displayedProtocols.length;

  if (isLoading) {
    return (
      <div className="card-unlloo animate-slide-up [animation-delay:0.3s] hover:scale-100!">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 bg-base-300 rounded-full animate-pulse" />
          <div>
            <div className="h-6 bg-base-300 rounded w-40 animate-pulse mb-1" />
            <div className="h-4 bg-base-300 rounded w-60 animate-pulse" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-base-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="card-unlloo animate-slide-up [animation-delay:0.3s] hover:scale-100!">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <ChartBarIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-base-content">DeFi Activity</h2>
            <p className="text-sm text-base-content/60">Protocol interactions</p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-base-200 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-base-content">{groupedProtocols.length}</div>
          <div className="text-xs text-base-content/60">Unique Protocols</div>
        </div>
        <div className="bg-base-200 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-base-content">{chainsQueried.length}</div>
          <div className="text-xs text-base-content/60">Chains</div>
        </div>
        <div className="bg-base-200 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-base-content">{Math.round(weightedScore)}</div>
          <div className="text-xs text-base-content/60">Weighted Score</div>
        </div>
      </div>

      {/* Chain Badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {chainsQueried.map(chain => (
          <span key={chain} className="badge badge-sm badge-outline">
            {formatChainName(chain)}
          </span>
        ))}
      </div>

      {/* Top Protocols Table */}
      <div>
        <table className="table table-sm w-full">
          <thead>
            <tr className="text-base-content/60 text-xs">
              <th>Protocol</th>
              <th>Chains</th>
              <th className="text-center">Txns</th>
              <th className="text-center">Tier</th>
              <th className="text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {displayedProtocols.map(protocol => {
              const tier = getProjectTier(protocol.maxWeight);
              const displayChains = protocol.chains.slice(0, MAX_CHAINS_DISPLAY);
              const remainingChains = protocol.chains.length - MAX_CHAINS_DISPLAY;

              return (
                <tr key={protocol.name} className="hover:bg-base-200/50 transition-colors duration-150">
                  <td className="font-medium text-base-content capitalize">{protocol.name}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {displayChains.map(chain => (
                        <span key={chain} className="badge badge-xs badge-ghost">
                          {formatChainName(chain, true)}
                        </span>
                      ))}
                      {remainingChains > 0 && (
                        <span
                          className="tooltip tooltip-top cursor-default"
                          data-tip={`Also on: ${protocol.chains
                            .slice(MAX_CHAINS_DISPLAY)
                            .map(c => formatChainName(c))
                            .join(", ")}`}
                        >
                          <InformationCircleIcon className="h-3.5 w-3.5 text-base-content/40 hover:text-base-content/70 transition-colors" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-center text-base-content/80 tabular-nums">
                    {protocol.totalTxCount.toLocaleString()}
                  </td>
                  <td className="text-center">
                    <span className={`badge badge-xs ${tier.color}`}>{tier.label}</span>
                  </td>
                  <td className="text-right font-mono text-sm text-base-content/80 tabular-nums">
                    {Math.round(protocol.totalWeightedScore)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Load More Button */}
      {canShowMore && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => setShowAll(!showAll)}
            className="btn btn-ghost btn-sm gap-2 hover:bg-base-200 transition-all duration-200"
            aria-label={showAll ? "Show less protocols" : "Show more protocols"}
          >
            <span className="text-sm text-base-content/70">
              {showAll
                ? "Show Less"
                : `Show More ${hasMore ? `(${Math.min(groupedProtocols.length - INITIAL_DISPLAY_COUNT, MAX_DISPLAY_COUNT - INITIAL_DISPLAY_COUNT)} more)` : ""}`}
            </span>
            <ChevronDownIcon
              className={`h-4 w-4 text-base-content/50 transition-transform duration-300 ${showAll ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      )}

      {/* Show count of remaining protocols beyond max display */}
      {groupedProtocols.length > MAX_DISPLAY_COUNT && showAll && (
        <div className="text-center mt-2">
          <span className="text-xs text-base-content/40">
            + {groupedProtocols.length - MAX_DISPLAY_COUNT} more protocol
            {groupedProtocols.length - MAX_DISPLAY_COUNT > 1 ? "s" : ""} not shown
          </span>
        </div>
      )}

      {/* Info footer */}
      <div className="flex items-start gap-2 mt-4 p-3 bg-base-200/50 rounded-lg">
        <InformationCircleIcon className="h-4 w-4 text-base-content/40 shrink-0 mt-0.5" />
        <p className="text-xs text-base-content/50">
          Protocols are grouped across chains. High-tier protocols (Uniswap, Aave, etc.) contribute more to the score.
          Each protocol is capped at 100 points to encourage diversity.
        </p>
      </div>
    </div>
  );
};
