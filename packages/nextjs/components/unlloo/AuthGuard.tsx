"use client";

import { ReactNode, useMemo } from "react";
import { Web3AuthButton } from "./Web3AuthButton";
import { useAccount } from "wagmi";
import { useSupabaseAuth } from "~~/hooks/useSupabaseAuth";

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * AuthGuard component that protects routes requiring Web3 wallet connection and Supabase authentication.
 *
 * Ensures:
 * - Wallet is connected
 * - User is authenticated with Supabase (JWT token)
 * - Connected wallet matches authenticated wallet (prevents wallet mismatch errors)
 *
 * @param children - Content to render when authenticated
 * @param fallback - Optional custom fallback UI (overrides default authentication prompt)
 */
export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { isConnected, address } = useAccount();
  const { isAuthenticated, loading, session } = useSupabaseAuth();

  // Memoize wallet mismatch check to avoid unnecessary recalculations
  const hasWalletMismatch = useMemo(() => {
    if (!isAuthenticated || !session || !address) return false;

    const authenticatedWallet = session.user?.user_metadata?.wallet_address?.toLowerCase();
    const currentWallet = address.toLowerCase();

    return authenticatedWallet !== undefined && authenticatedWallet !== currentWallet;
  }, [isAuthenticated, session, address]);

  // Determine authentication state for better error messages
  const authState = useMemo(() => {
    if (!isConnected) return "not_connected";
    if (!isAuthenticated) return "not_authenticated";
    if (hasWalletMismatch) return "wallet_mismatch";
    return "authenticated";
  }, [isConnected, isAuthenticated, hasWalletMismatch]);

  // Show loading spinner while checking authentication state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // Require authentication if: not connected, not authenticated, or wallet mismatch
  if (authState !== "authenticated") {
    if (fallback) {
      return <>{fallback}</>;
    }

    // Generate specific error message based on authentication state
    const getErrorMessage = (): string => {
      switch (authState) {
        case "not_connected":
          return "Please connect your wallet to access this feature.";
        case "not_authenticated":
          return "To access this feature, you need to connect your wallet and sign in to prove ownership.";
        case "wallet_mismatch":
          return "Your connected wallet doesn't match your authenticated wallet. Please sign in again with your current wallet.";
        default:
          return "Authentication required to access this feature.";
      }
    };

    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="card-unlloo">
          <h2 className="text-2xl font-bold mb-4">Authentication Required</h2>
          <p className="text-base-content/70 mb-6">{getErrorMessage()}</p>
          <Web3AuthButton />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
