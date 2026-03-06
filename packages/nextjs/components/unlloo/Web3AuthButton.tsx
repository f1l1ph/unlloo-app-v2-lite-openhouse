"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { useSupabaseAuth } from "~~/hooks/useSupabaseAuth";

/**
 * Formats an Ethereum address for display (e.g., "0x1234...5678")
 */
const formatAddress = (address: string): string => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * Web3AuthButton component for signing in/out with Ethereum wallet via Supabase Web3 auth.
 *
 * Features:
 * - Shows connection status and authentication state
 * - Handles SIWE (Sign-In with Ethereum) flow
 * - Provides clear error messages and loading states
 * - Automatically clears errors on successful authentication
 */
export function Web3AuthButton() {
  const { isConnected } = useAccount();
  const { isAuthenticated, isAuthenticating, signIn, signOut, walletAddress } = useSupabaseAuth();
  const [error, setError] = useState<string | null>(null);

  // Clear error when authentication succeeds
  useEffect(() => {
    if (isAuthenticated && error) {
      setError(null);
    }
  }, [isAuthenticated, error]);

  const handleSignIn = useCallback(async () => {
    if (!isConnected) {
      toast.error("Please connect your wallet first");
      return;
    }

    setError(null);

    try {
      await signIn({
        statement: "Sign in to Unlloo DeFi Lending Protocol. I accept the Terms of Service.",
      });
      toast.success("Successfully signed in!");
      // Error will be cleared by useEffect when isAuthenticated becomes true
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to sign in";
      setError(errorMessage);

      // Provide user-friendly error messages
      if (errorMessage.includes("User rejected") || errorMessage.includes("4001")) {
        toast.error("Signature rejected. Please try again.");
      } else if (errorMessage.includes("not connected") || errorMessage.includes("WALLET_NOT_CONNECTED")) {
        toast.error("Please connect your wallet first");
      } else if (errorMessage.includes("already used") || errorMessage.includes("SESSION_EXPIRED")) {
        toast.error("Session expired. Please sign in again.");
      } else {
        toast.error(`Sign in failed: ${errorMessage}`);
      }
      console.error("Sign in error:", err);
    }
  }, [isConnected, signIn]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
      toast.success("Successfully signed out");
      setError(null); // Clear any errors on sign out
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to sign out";
      toast.error(`Failed to sign out: ${errorMessage}`);
      console.error("Sign out error:", err);
    }
  }, [signOut]);

  if (!isConnected) {
    return (
      <div className="alert alert-warning">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span>Please connect your wallet to access Unlloo features</span>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex flex-col gap-3">
        <div className="alert alert-success">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 shrink-0 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1">
            <div className="font-semibold">Authenticated</div>
            <div className="text-sm opacity-80">{walletAddress ? formatAddress(walletAddress) : "Connected"}</div>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="btn btn-outline btn-sm"
          disabled={isAuthenticating}
          aria-label="Sign out from Unlloo"
        >
          {isAuthenticating ? (
            <>
              <span className="loading loading-spinner loading-xs"></span>
              Signing Out...
            </>
          ) : (
            "Sign Out"
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="alert alert-info">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          className="h-6 w-6 shrink-0 stroke-current"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="flex-1">
          <div className="font-semibold">Authentication Required</div>
          <div className="text-sm">Sign a message with your wallet to access Unlloo features</div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 shrink-0 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleSignIn}
        className="btn btn-primary"
        disabled={isAuthenticating || !isConnected}
        aria-label="Sign in with your Ethereum wallet"
        aria-busy={isAuthenticating}
      >
        {isAuthenticating ? (
          <>
            <span className="loading loading-spinner"></span>
            Signing In...
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
            Sign In with Wallet
          </>
        )}
      </button>

      <p className="text-xs text-base-content/60 text-center">
        You&apos;ll be asked to sign a message in your wallet to prove ownership. This is free and doesn&apos;t send a
        transaction.
      </p>
    </div>
  );
}
