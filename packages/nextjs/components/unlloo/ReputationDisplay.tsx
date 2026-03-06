"use client";

import React, { useMemo } from "react";
import { Address } from "viem";
import { ArrowPathIcon, ChartBarIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface ReputationMetrics {
  totalTransactions?: number;
  totalTokenTransfers?: number;
  uniqueTokens?: number;
  portfolioValue?: number;
  defiActivity?: number;
  walletAgeMonths?: number;
  loanHistory?: number;
}

interface MultiChainData {
  walletAgeMonths?: number;
  totalTransactions?: number;
  portfolioValue?: number;
}

interface ReputationDisplayProps {
  address?: Address; // Optional, not used in component
  onCalculate: () => void;
  isCalculating: boolean;
  reputation: number;
  maxAmount?: string;
  maxLoanDuration?: string;
  recommendedRate?: string;
  isBlocked: boolean;
  lastUpdated?: string;
  metrics?: ReputationMetrics;
  multiChain?: MultiChainData;
}

/**
 * Component to display reputation information for borrowing
 */
export const ReputationDisplay: React.FC<ReputationDisplayProps> = ({
  onCalculate,
  isCalculating,
  reputation,
  maxAmount,
  maxLoanDuration,
  isBlocked,
  lastUpdated,
}) => {
  // Get default token from contract
  const { data: defaultToken } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });

  // Get borrower interest rate from contract (same pattern as ReputationDashboard)
  const { data: borrowerRateBps } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "calculateBorrowRate",
    args: defaultToken ? [defaultToken] : (undefined as any),
  });

  // Calculate interest rate percentage from basis points
  const contractInterestRate = useMemo(() => {
    if (!borrowerRateBps) return null;
    return Number(borrowerRateBps) / 100; // Convert from basis points to percentage
  }, [borrowerRateBps]);
  const getReputationColor = (score: number) => {
    if (score >= 800) return "text-success";
    if (score >= 600) return "text-primary";
    if (score >= 400) return "text-warning";
    return "text-error";
  };

  const getReputationLabel = (score: number) => {
    if (score >= 800) return "Excellent";
    if (score >= 600) return "Good";
    if (score >= 400) return "Fair";
    return "Poor";
  };

  return (
    <div className="bg-base-100 rounded-xl border border-base-300/50 overflow-hidden">
      <div className="p-5 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg md:text-xl font-bold text-base-content">Reputation Score</h3>
          <button
            onClick={onCalculate}
            disabled={isCalculating}
            className="btn btn-sm btn-outline"
            aria-label="Calculate reputation"
          >
            <ArrowPathIcon className={`h-4 w-4 ${isCalculating ? "animate-spin" : ""}`} />
            {isCalculating ? "Calculating..." : "Calculate"}
          </button>
        </div>

        {reputation > 0 ? (
          <div className="space-y-4">
            {/* Main Score Display */}
            <div className="flex items-center gap-4">
              <div className={`text-5xl font-bold ${getReputationColor(reputation)}`}>{reputation}</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-base-content/60 mb-1">Reputation Level</div>
                <div className={`text-lg font-semibold ${getReputationColor(reputation)}`}>
                  {getReputationLabel(reputation)}
                </div>
                {lastUpdated && <div className="text-xs text-base-content/50 mt-1">Updated: {lastUpdated}</div>}
              </div>
            </div>

            {/* Borrowing Parameters */}
            {!isBlocked && (maxAmount || maxLoanDuration || contractInterestRate !== null) && (
              <div className="bg-base-200 rounded-lg p-4 space-y-3">
                <div className="text-sm font-semibold text-base-content/70 mb-2">Borrowing Parameters</div>
                {maxAmount && (
                  <div className="flex justify-between text-sm">
                    <span className="text-base-content/70">Max Loan Amount:</span>
                    <span className="font-bold text-primary">${maxAmount}</span>
                  </div>
                )}
                {maxLoanDuration && (
                  <div className="flex justify-between text-sm">
                    <span className="text-base-content/70">Max Loan Duration:</span>
                    <span className="font-medium text-base-content">{maxLoanDuration}</span>
                  </div>
                )}
                {contractInterestRate !== null ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-base-content/70">Interest Rate:</span>
                    <span className="font-medium text-base-content">{contractInterestRate.toFixed(2)}% APY</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-sm">
                    <span className="text-base-content/70">Interest Rate:</span>
                    <span className="font-medium text-base-content/50">Loading...</span>
                  </div>
                )}
              </div>
            )}

            {/* Blocked Status */}
            {isBlocked && (
              <div className="bg-error/10 border border-error/30 rounded-lg p-4">
                <div className="text-error font-semibold mb-2">Wallet Blocked</div>
                <div className="text-sm text-error/70">
                  Your reputation is below the minimum required threshold. You cannot borrow at this time.
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <ChartBarIcon className="h-12 w-12 text-base-content/30 mx-auto mb-3" />
            <p className="text-base-content/60 mb-4">No reputation data available</p>
            <button onClick={onCalculate} disabled={isCalculating} className="btn btn-primary btn-sm">
              {isCalculating ? "Calculating..." : "Calculate Reputation"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
