"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DefiActivityCard } from "./DefiActivityCard";
import { MultiChainActivity } from "./MultiChainActivity";
import { ProviderScoreCard } from "./ProviderScoreCard";
import { RefreshDataModal } from "./RefreshDataModal";
import { ReputationFactors } from "./ReputationFactors";
import { useAccount } from "wagmi";
import { ArrowPathIcon, ChartBarIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { ReputationDetails, ReputationService, ServiceError, hasError } from "~~/services/api/reputation.service";
import type { GrowthepieData } from "~~/services/api/reputation.service";
import { blocksToDays } from "~~/utils/unlloo/blockTime";

/**
 * Helper function to normalize provider scores to 0-1000 scale
 * @param service - Service data object (may contain error)
 * @param providerName - Name of the provider for normalization logic
 * @returns Normalized score (0-1000)
 */
const normalizeProviderScore = (
  service: { score?: number } | ServiceError | null | undefined,
  providerName: string,
): number => {
  if (!service || hasError(service)) return 0;

  const score = service.score || 0;

  switch (providerName) {
    case "humanPassport":
      // Human Passport: backend already returns normalized score (0-1000)
      return Math.min(score, 1000);

    case "talentProtocol":
      // Talent Protocol: score is already 0-1000 range from API
      return Math.min(score, 1000);

    case "webacy":
      // Webacy: assume 0-100 scale, normalize to 0-1000
      return Math.min(score * 10, 1000);

    case "ethosNetwork":
      // Ethos Network: assume 0-1000 scale already
      return Math.min(score, 1000);

    case "growthepie":
      // Growthepie: score is already 0-1000 range
      return Math.min(score, 1000);

    default:
      return Math.min(score, 1000);
  }
};

export const ReputationDashboard: React.FC = () => {
  const { address: connectedAddress } = useAccount();
  const [reputationData, setReputationData] = useState<ReputationDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshModalOpen, setIsRefreshModalOpen] = useState(false);

  // Get block time from contract
  const { data: blockTimeSecondsData } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "blockTimeSeconds",
  });
  const blockTimeSeconds = blockTimeSecondsData ? Number(blockTimeSecondsData) : 2;

  // Get default token from contract
  const { data: defaultToken } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });

  // Get borrower interest rate from contract (same pattern as LoanRequestModal)
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

  const loadReputation = useCallback(
    async (address: string, bypassCache = false) => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await ReputationService.getReputationDetails(address, bypassCache);
        setReputationData(data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to load reputation";
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [], // No dependencies - function is stable
  );

  const handleRefreshClick = useCallback(() => {
    setIsRefreshModalOpen(true);
  }, []);

  const handleRefreshConfirm = useCallback(() => {
    if (connectedAddress) {
      loadReputation(connectedAddress, true);
    }
    setIsRefreshModalOpen(false);
  }, [connectedAddress, loadReputation]);

  const handleRefreshCancel = useCallback(() => {
    setIsRefreshModalOpen(false);
  }, []);

  // Load reputation when wallet address changes
  // Note: AuthGuard already ensures wallet connection and authentication match
  useEffect(() => {
    if (connectedAddress) {
      loadReputation(connectedAddress);
    } else {
      setReputationData(null);
      setError(null);
    }
  }, [connectedAddress, loadReputation]);

  const reputation = reputationData?.finalReputation;
  const services = reputationData?.thirdPartyServices;

  // Calculate normalized scores for each provider (0-1000 scale)
  // Must be called before any early returns (React Hooks rules)
  const webacyScore = useMemo(
    () => (services?.webacy && !hasError(services.webacy) ? normalizeProviderScore(services.webacy, "webacy") : 0),
    [services?.webacy],
  );
  const ethosScore = useMemo(
    () =>
      services?.ethosNetwork && !hasError(services.ethosNetwork)
        ? normalizeProviderScore(services.ethosNetwork, "ethosNetwork")
        : 0,
    [services?.ethosNetwork],
  );
  const gitcoinScore = useMemo(
    () =>
      services?.humanPassport && !hasError(services.humanPassport)
        ? normalizeProviderScore(services.humanPassport, "humanPassport")
        : 0,
    [services?.humanPassport],
  );
  const talentScore = useMemo(
    () =>
      services?.talentProtocol && !hasError(services.talentProtocol)
        ? normalizeProviderScore(services.talentProtocol, "talentProtocol")
        : 0,
    [services?.talentProtocol],
  );
  const growthepieScore = useMemo(
    () =>
      services?.growthepie && !hasError(services.growthepie)
        ? normalizeProviderScore(services.growthepie, "growthepie")
        : 0,
    [services?.growthepie],
  );

  // Use API score directly (already 0-1000 scale), cap at 1000
  const displayScore = useMemo(() => (reputation ? Math.min(reputation.walletReputation, 1000) : 0), [reputation]);

  const getReputationColor = (score?: number) => {
    if (!score) return "text-base-content/40";
    if (score >= 800) return "score-excellent";
    if (score >= 600) return "score-good";
    if (score >= 400) return "score-fair";
    return "score-poor";
  };

  const getReputationLabel = (score?: number) => {
    if (!score) return "Not Calculated";
    if (score >= 800) return "Excellent";
    if (score >= 600) return "Good";
    if (score >= 400) return "Fair";
    return "Poor";
  };

  if (!connectedAddress) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center px-4">
        <div className="max-w-lg w-full">
          <div className="bg-base-100 border border-base-300 rounded-xl shadow-sm p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-6">
              <ChartBarIcon className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-base-content mb-2">Welcome to Unlloo</h1>
            <p className="text-base-content/60 mb-6">
              Under-collateralized borrowing powered by your on-chain reputation
            </p>

            <div className="inline-flex items-center gap-2 px-4 py-3 bg-primary/5 rounded-lg border border-primary/20 mb-8">
              <InformationCircleIcon className="h-5 w-5 text-primary shrink-0" />
              <p className="text-sm text-base-content/80">Connect your wallet to view your reputation score</p>
            </div>

            <div className="text-left space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-base-content text-sm">Multi-Provider Analysis</p>
                  <p className="text-sm text-base-content/60">
                    Aggregated scores from Webacy, Ethos Network, Human Passport, and Talent Protocol
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-base-content text-sm">Transparent Scoring</p>
                  <p className="text-sm text-base-content/60">
                    Complete breakdown of how each provider contributes to your reputation
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-base-content text-sm">Instant Results</p>
                  <p className="text-sm text-base-content/60">Get your borrowing power calculation in seconds</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-base-100">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-md mx-auto mt-20">
            <div className="bg-base-100 border border-error/20 rounded-xl shadow-sm p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-error/10 mb-4">
                <InformationCircleIcon className="h-8 w-8 text-error" />
              </div>
              <h2 className="text-xl font-semibold text-base-content mb-2">Error Loading Reputation</h2>
              <p className="text-sm text-base-content/60 mb-6">{error}</p>
              <button
                onClick={() => connectedAddress && loadReputation(connectedAddress)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-content rounded-lg font-medium hover:bg-primary/90 transition-colors"
                aria-label="Retry loading reputation data"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-base-content mb-2">Reputation Dashboard</h1>
          <p className="text-base text-base-content/60">
            Your on-chain reputation score calculated from multiple trusted providers
          </p>
        </div>

        {/* Main Content: Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Left Column: Overall Reputation */}
          <div className="bg-base-100 border border-base-300 rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="text-center py-16">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent mb-4"></div>
                <p className="text-sm text-base-content/60">Calculating your reputation...</p>
              </div>
            ) : reputation ? (
              <div className="bg-linear-to-br from-primary/5 to-primary/10 p-8 flex flex-col items-center justify-center min-h-100">
                <div className="text-sm font-medium text-base-content/50 uppercase tracking-wide mb-3">
                  Reputation Score
                </div>
                <div className={`text-7xl font-bold mb-2 ${getReputationColor(displayScore)}`}>{displayScore}</div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-base-100/50 border border-base-300">
                  <div className={`w-2 h-2 rounded-full ${getReputationColor(displayScore)}`}></div>
                  <span className="text-sm font-medium text-base-content/80">{getReputationLabel(displayScore)}</span>
                </div>
                <div className="mt-6 text-center">
                  <div className="text-3xl font-semibold text-base-content/60">
                    {((displayScore / 1000) * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-base-content/50 mt-1">of maximum score</div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right Column: Borrowing Power Details */}
          <div className="bg-base-100 border border-base-300 rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="text-center py-16">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent mb-4"></div>
                <p className="text-sm text-base-content/60">Calculating borrowing power...</p>
              </div>
            ) : reputation ? (
              <div className="p-8 space-y-6 min-h-100 flex flex-col justify-center">
                <h3 className="text-lg font-semibold text-base-content mb-6">Borrowing Power</h3>

                <div className="space-y-4">
                  <div className="py-3 border-b border-base-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left Column: Max Loan Amount */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <span className="text-lg">💰</span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-base-content/60">Max Loan Amount</div>
                          <div className="text-2xl font-bold text-primary">${reputation.maxLoanAmount}</div>
                        </div>
                      </div>
                      {/* Right Column: Testing Notice */}
                      <div className="inline-flex items-start gap-2 px-3 py-2 bg-warning/10 border border-warning/20 rounded-lg">
                        <InformationCircleIcon className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                        <div className="text-[9px] text-base-content/70 leading-tight">
                          <p>
                            We are still improving our creditworthiness algorithm. Loan amounts currently range from
                            $100 to $1,000.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-3 border-b border-base-200">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-base-200 flex items-center justify-center">
                        <span className="text-lg">📅</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-base-content/60">Max Loan Duration</div>
                        <div className="text-xl font-semibold text-base-content">
                          {blockTimeSeconds ? blocksToDays(reputation.maxLoanDuration, blockTimeSeconds) : 0} days
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-base-200 flex items-center justify-center">
                        <span className="text-lg">📊</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-base-content/60">Interest Rate</div>
                        <div className="text-xl font-semibold text-base-content">
                          {contractInterestRate !== null ? (
                            `${contractInterestRate.toFixed(2)}% APY`
                          ) : (
                            <span className="text-base-content/50">Loading...</span>
                          )}
                        </div>
                        {contractInterestRate !== null && (
                          <div className="text-xs text-base-content/50 mt-1">Current rate from smart contract</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Reputation Factors */}
        {!isLoading &&
          reputationData?.blockscoutData &&
          (() => {
            const metrics = reputationData.blockscoutData.customCreditworthiness.data.metrics;
            const totalTx = metrics.totalTransactions || 0;
            const totalTokenTx = metrics.totalTokenTransfers || 0;

            // Calculate average transaction value
            // Use totalValueTransferredUSD divided by token transfers (not total transactions)
            const avgTxValue = (() => {
              if (
                metrics.totalValueTransferredUSD != null &&
                metrics.totalValueTransferredUSD > 0 &&
                totalTokenTx > 0
              ) {
                // Correct: total value / token transfer count
                return metrics.totalValueTransferredUSD / totalTokenTx;
              }
              return 0;
            })();

            // Portfolio value: use Moralis data only, show unavailable if not present
            const portfolioValue = reputationData?.moralisPortfolio?.totalValueUsd ?? null;

            // Growthepie project count for DeFi Activity factor
            const growthepieProjectCount =
              services?.growthepie && !hasError(services.growthepie)
                ? (services.growthepie as { score: number; data: { projectCount: number } }).data.projectCount
                : undefined;

            return (
              <ReputationFactors
                walletAgeMonths={reputationData.blockscoutData.customCreditworthiness.data.walletAgeMonths || 0}
                totalTransactions={totalTx}
                avgTxValue={avgTxValue}
                defiActivity={metrics.protocolInteractions?.length || 0}
                defiProjectCount={growthepieProjectCount}
                uniqueTokens={metrics.uniqueTokensCount || 0}
                portfolioValue={portfolioValue}
                isLoading={isLoading}
              />
            );
          })()}

        {/* Multi-Chain Activity */}
        {!isLoading && reputationData?.blockscoutData?.customCreditworthiness?.data?.metrics?.chainActivity && (
          <div className="mt-6">
            <MultiChainActivity
              chainActivity={reputationData.blockscoutData.customCreditworthiness.data.metrics.chainActivity}
              isLoading={isLoading}
            />
          </div>
        )}

        {/* DeFi Activity Breakdown (Growthepie) */}
        {!isLoading &&
          services?.growthepie &&
          !hasError(services.growthepie) &&
          (() => {
            const gtp = services.growthepie as GrowthepieData;
            return (
              <div className="mt-6">
                <DefiActivityCard
                  projects={gtp.data.projects}
                  projectCount={gtp.data.projectCount}
                  weightedScore={gtp.data.weightedScore}
                  chainsQueried={gtp.data.chainsQueried}
                  normalizedScore={gtp.score}
                  isLoading={isLoading}
                />
              </div>
            );
          })()}

        {/* Provider Scores */}
        {!isLoading && services && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold text-base-content mb-4">Provider Breakdown</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ProviderScoreCard
                name="Webacy"
                description="Used for security risk and threat detection analysis"
                score={webacyScore}
                maxScore={1000}
                icon="shield"
                logo="/logos/webacy-logo.png"
                websiteUrl="https://www.webacy.com"
                isLoading={isLoading}
                error={services?.webacy && hasError(services.webacy) ? services.webacy.error : undefined}
              />

              <ProviderScoreCard
                name="Ethos Network"
                description="Used for social reputation and credibility score"
                score={ethosScore}
                maxScore={1000}
                icon="check"
                logo="/logos/ethos-logo.png"
                websiteUrl="https://www.ethos.network"
                isLoading={isLoading}
                error={
                  services?.ethosNetwork && hasError(services.ethosNetwork) ? services.ethosNetwork.error : undefined
                }
              />

              <ProviderScoreCard
                name="Human Passport"
                description="Used for proof of humanity and identity verification"
                score={gitcoinScore}
                maxScore={1000}
                icon="sparkles"
                logo="/logos/humanpassport-logo.png"
                websiteUrl="https://passport.xyz"
                isLoading={isLoading}
                error={
                  services?.humanPassport && hasError(services.humanPassport) ? services.humanPassport.error : undefined
                }
              />

              <ProviderScoreCard
                name="Talent Protocol"
                description="Used for builder score based on GitHub and on-chain contributions"
                score={talentScore}
                maxScore={1000}
                icon="trophy"
                logo="/logos/talen-logo.ico"
                websiteUrl="https://www.talentprotocol.com"
                isLoading={isLoading}
                error={
                  services?.talentProtocol && hasError(services.talentProtocol)
                    ? services.talentProtocol.error
                    : undefined
                }
              />

              <ProviderScoreCard
                name="growthepie"
                description="Used for on-chain DeFi protocol engagement across multiple chains"
                score={growthepieScore}
                maxScore={1000}
                logo="/logos/growthepie-logo.svg"
                websiteUrl="https://www.growthepie.xyz"
                isLoading={isLoading}
                error={services?.growthepie && hasError(services.growthepie) ? services.growthepie.error : undefined}
              />

              <ProviderScoreCard
                name="Zeru Z-Pass"
                description="Used for (coming soon)"
                score={0}
                maxScore={1000}
                icon="sparkles"
                logo="/logos/zeru-logo.png"
                websiteUrl="https://zpass.ai"
                isLoading={false}
                comingSoon={true}
              />
            </div>
          </div>
        )}

        {/* Refresh Button */}
        {!isLoading && reputation && (
          <div className="flex justify-center mt-6">
            <button
              onClick={handleRefreshClick}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-base-content/70 hover:text-base-content hover:bg-base-200 rounded-lg transition-colors"
              aria-label="Refresh reputation data"
              disabled={isLoading}
            >
              <ArrowPathIcon className="h-4 w-4" />
              Refresh Data
            </button>
          </div>
        )}
      </div>

      {/* Refresh Confirmation Modal */}
      <RefreshDataModal isOpen={isRefreshModalOpen} onConfirm={handleRefreshConfirm} onCancel={handleRefreshCancel} />
    </div>
  );
};
