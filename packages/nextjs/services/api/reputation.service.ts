import { apiClient } from "./client";
import axios from "axios";

// API Response Interfaces matching actual backend structure
export interface ReputationResponse {
  wallet: string;
  walletReputation: number;
  maxLoanAmount: number;
  maxLoanDuration: number;
  recommendedInterest: number;
  blockNumber: number;
}

export interface HumanPassportData {
  score: number;
  data: {
    address: string;
    score: string;
    status: string;
    last_score_timestamp: string;
    expiration_date: string | null;
    evidence?: {
      type: string;
      success: boolean;
      rawScore: number;
      threshold: number;
    };
    error: string | null;
    stamp_scores: any;
    // Legacy fields for backward compatibility
    passing_score?: boolean;
    expiration_timestamp?: string | null;
    threshold?: string;
    stamps?: any;
    points_data?: any;
    possible_points_data?: any;
  };
}

export interface TalentProtocolData {
  score: number;
  data: {
    builderScore: number;
    raw: {
      score: {
        last_calculated_at: string;
        points: number;
        rank_position: number | null;
        slug: string;
      };
    };
  };
}

export interface GrowthepieProjectInteraction {
  owner_project: string;
  tx_count: number;
  total_gas_used: number;
  weight: number;
  weighted_score: number;
  chain: string;
}

export interface GrowthepieData {
  score: number;
  data: {
    projectCount: number;
    weightedScore: number;
    projects: GrowthepieProjectInteraction[];
    chainsQueried: string[];
    raw: Record<string, any>;
  };
}

export interface ServiceError {
  error: string;
}

export type SupportedChain = "ethereum" | "arbitrum" | "base" | "avalanche" | "optimism";

export interface ChainActivity {
  chain: SupportedChain;
  transactionCount: number;
  tokenTransferCount: number;
  uniqueTokensCount: number;
  hasActivity: boolean;
}

export interface ThirdPartyServices {
  humanPassport?: HumanPassportData | ServiceError;
  zPass?: ServiceError;
  webacy?: ServiceError;
  ethosNetwork?: ServiceError;
  talentProtocol?: TalentProtocolData | ServiceError;
  growthepie?: GrowthepieData | ServiceError;
}

export interface BlockscoutData {
  customCreditworthiness: {
    score: number;
    data: {
      scores: {
        activityScore: number;
        financialScore: number;
        reliabilityScore: number;
        defiEngagementScore: number;
      };
      walletAgeMonths: number;
      metrics: {
        totalTransactions: number;
        totalTokenTransfers: number;
        uniqueTokensCount: number;
        totalBalanceUSD: number;
        totalPortfolioValueUSD: number;
        totalValueTransferredUSD?: number | null;
        protocolInteractions: string[];
        chainActivity?: ChainActivity[];
      };
    };
  };
}

export interface MoralisPortfolioChain {
  chain: string;
  nativeBalanceUsd: number;
  tokenBalanceUsd: number;
  totalValueUsd: number;
}

export interface MoralisPortfolioData {
  totalValueUsd?: number;
  nativeBalanceUsd?: number;
  tokenBalanceUsd?: number;
  chains?: MoralisPortfolioChain[];
  error?: string;
}

export interface ReputationDetails {
  wallet: string;
  thirdPartyServices: ThirdPartyServices;
  blockscoutData: BlockscoutData;
  moralisPortfolio?: MoralisPortfolioData;
  finalReputation: ReputationResponse;
}

/**
 * Type guard to check if a service response has an error
 * @param service - Service response object (may be data or error)
 * @returns true if service has an error property
 */
export const hasError = (service: unknown): service is ServiceError => {
  return service !== null && typeof service === "object" && "error" in service;
};

/**
 * Get normalized score from a service response
 * Returns 0 if service has an error or no score property
 * @param service - Service response object (may be data or error)
 * @returns Normalized score (0 if error or no score)
 */
export const getNormalizedScore = (service: unknown): number => {
  if (hasError(service)) return 0;
  if (service !== null && typeof service === "object" && "score" in service) {
    const score = (service as { score?: number }).score;
    return typeof score === "number" ? score : 0;
  }
  return 0;
};

export class ReputationService {
  /**
   * Get reputation summary for a wallet
   * Returns reputation score and loan parameters (max amount, duration, interest rate)
   *
   * @param walletAddress - Ethereum wallet address (0x-prefixed)
   * @returns Promise resolving to reputation response with score and loan parameters
   * @throws {Error} If API call fails or validation errors occur
   */
  static async getReputation(walletAddress: string): Promise<ReputationResponse> {
    try {
      const { data } = await apiClient.get<ReputationResponse>(`/reputation/${walletAddress}`);
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.message || `Failed to fetch reputation: ${error.message}`;
        throw new Error(errorMessage);
      }
      throw error instanceof Error ? error : new Error("Failed to fetch reputation");
    }
  }

  /**
   * Get detailed reputation breakdown with all providers
   * Includes third-party service scores, Blockscout data, and final reputation calculation
   *
   * @param walletAddress - Ethereum wallet address (0x-prefixed)
   * @param bypassCache - If true, bypass cache and fetch fresh data (default: false)
   * @returns Promise resolving to detailed reputation breakdown
   * @throws {Error} If API call fails or validation errors occur
   */
  static async getReputationDetails(walletAddress: string, bypassCache = false): Promise<ReputationDetails> {
    try {
      const params = bypassCache ? { bypassCache: "true" } : {};
      const { data } = await apiClient.get<ReputationDetails>(`/reputation/${walletAddress}/details`, {
        params,
      });
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.message || `Failed to fetch reputation details: ${error.message}`;
        throw new Error(errorMessage);
      }
      throw error instanceof Error ? error : new Error("Failed to fetch reputation details");
    }
  }
}
