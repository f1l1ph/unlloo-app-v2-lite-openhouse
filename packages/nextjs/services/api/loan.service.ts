import { apiClient } from "./client";
import type { BlockscoutData, ThirdPartyServices } from "./reputation.service";
import axios from "axios";
import { keccak256, toHex } from "viem";

// Source of income options matching the backend
export const SOURCE_OF_INCOME_OPTIONS = [
  "Full-time Worker",
  "Student",
  "Investor",
  "Self-employed",
  "Business Owner",
  "Other",
] as const;

export type SourceOfIncome = (typeof SOURCE_OF_INCOME_OPTIONS)[number];

/**
 * Reputation details subset sent to backend when creating a loan request
 * Only includes thirdPartyServices and blockscoutData (excludes finalReputation)
 */
export interface LoanRequestReputationDetails {
  thirdPartyServices: ThirdPartyServices;
  blockscoutData: BlockscoutData;
}

export interface CreateLoanRequestPayload {
  requestId: string;
  walletAddress: string;
  email: string;
  telegramHandle: string;
  reason: string;
  reasonHash: string;
  walletReputation: number;
  maxLoanAmount: number;
  maxLoanDuration: number;
  recommendedInterest: number;
  blockNumber: number;
  reputationDetails: LoanRequestReputationDetails;
  sourceOfIncome: SourceOfIncome;
  incomeYearlyUsd: number;
}

export interface UpdateLoanIdPayload {
  loanId: string;
}

/**
 * Create a loan request with contact information (called BEFORE on-chain transaction)
 *
 * @param payload - Loan request data including contact info, reputation, and loan parameters
 * @returns Promise resolving to requestId and success message
 * @throws {Error} If API call fails or validation errors occur
 */
export async function createLoanRequest(
  payload: CreateLoanRequestPayload,
): Promise<{ requestId: string; message: string }> {
  try {
    const { data } = await apiClient.post<{ requestId: string; message: string }>("/loans", payload);
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message || `Failed to create loan request: ${error.message}`;
      throw new Error(errorMessage);
    }
    throw error instanceof Error ? error : new Error("Failed to create loan request");
  }
}

/**
 * Update loan request with on-chain loanId (called AFTER successful on-chain transaction)
 *
 * @param requestId - Unique request ID from createLoanRequest
 * @param loanId - On-chain loan ID from smart contract transaction
 * @returns Promise resolving to requestId, loanId, and success message
 * @throws {Error} If API call fails or validation errors occur
 */
export async function updateLoanId(
  requestId: string,
  loanId: string,
): Promise<{ requestId: string; loanId: string; message: string }> {
  try {
    const { data } = await apiClient.patch<{ requestId: string; loanId: string; message: string }>(
      `/loans/${requestId}/loan-id`,
      { loanId },
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message || `Failed to update loan ID: ${error.message}`;
      throw new Error(errorMessage);
    }
    throw error instanceof Error ? error : new Error("Failed to update loan ID");
  }
}

/**
 * Loan details returned from the API
 */
export interface LoanDetails {
  loanId: number;
  email: string;
  telegramHandle: string;
  reason: string;
  sourceOfIncome: string | null;
  incomeYearlyUsd: number | null;
  walletAddress: string;
  createdAt: string;
}

/**
 * Get loan details by loanId
 *
 * @param loanId - Loan ID (can be number or bigint)
 * @returns Promise resolving to loan details
 * @throws {Error} If API call fails or loan not found
 */
export async function getLoanDetails(loanId: number | bigint): Promise<LoanDetails> {
  const loanIdStr = typeof loanId === "bigint" ? loanId.toString() : String(loanId);

  try {
    const { data } = await apiClient.get<LoanDetails>(`/loans/${loanIdStr}`);
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message || `Failed to fetch loan details: ${error.message}`;
      throw new Error(errorMessage);
    }
    throw error instanceof Error ? error : new Error("Failed to fetch loan details");
  }
}

/**
 * Generate a unique request ID (UUID v4)
 * Uses browser crypto API when available, falls back to Math.random-based UUID.
 *
 * @returns UUID v4 string
 */
export function generateRequestId(): string {
  // Prefer crypto.randomUUID() for better randomness (available in modern browsers and Node.js 14.17+)
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback for environments without crypto.randomUUID (e.g., older browsers)
  // This implements UUID v4 spec: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where x is any hexadecimal digit and y is one of 8, 9, A, or B
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8; // For 'y', ensure it's 8, 9, A, or B
    return v.toString(16);
  });
}

/**
 * Generate hash of loan reason for verification
 * Uses Keccak-256 (same as Ethereum's keccak256) to hash the reason string.
 *
 * @param reason - Loan reason text to hash
 * @returns Keccak-256 hash as hex string (0x-prefixed)
 */
export function hashLoanReason(reason: string): string {
  if (!reason || reason.trim().length === 0) {
    throw new Error("Loan reason cannot be empty");
  }
  return keccak256(toHex(reason));
}
