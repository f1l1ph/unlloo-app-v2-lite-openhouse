import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useAccount } from "wagmi";
import { supabase } from "~~/utils/supabaseClient";

// ==================== Constants ====================

const DEFAULT_SIGN_IN_STATEMENT = "Sign in to Unlloo DeFi Lending Protocol";

const ERROR_MESSAGES = {
  WALLET_NOT_CONNECTED: "Wallet not connected. Please connect your wallet first.",
  NO_ETHEREUM_WALLET: "No Ethereum wallet detected. Please install MetaMask or another Web3 wallet.",
  AUTH_INCOMPLETE: "Failed to complete authentication. Please try again. If the problem persists, contact support.",
  SESSION_REFRESH_FAILED: "Failed to refresh authentication session. Please try again.",
  SIGNATURE_REJECTED: "Signature request was rejected",
  SESSION_EXPIRED: "Session expired. Please try again.",
} as const;

// ==================== Types ====================

interface SignInOptions {
  statement?: string;
}

// ==================== Hook ====================

/**
 * Supabase Auth hook with native Web3 (SIWE / EIP-4361) authentication
 *
 * Features:
 * - Uses Supabase's built-in signInWithWeb3() for SIWE flow
 * - Automatically signs out when wallet changes (prevents auth errors)
 * - Fail-fast error handling to prevent incomplete auth states
 * - JWT token includes wallet address for backend validation
 *
 * @see blueprints/60_API_Authentication.md
 * @see AUTH_IMPLEMENTATION.md
 */
export function useSupabaseAuth() {
  const { address, isConnected } = useAccount();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // ==================== Session Management ====================

  // Initialize session and listen for auth state changes
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes (sign in, sign out, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ==================== Wallet Change Detection ====================

  /**
   * Monitor wallet changes and automatically sign out if wallet doesn't match
   * Prevents 403 errors from backend's WalletOwnerGuard
   *
   * This works in conjunction with AuthGuard's wallet mismatch detection:
   * - This hook automatically signs out when wallet changes (prevents API errors)
   * - AuthGuard shows appropriate UI message while sign-out is in progress
   */
  useEffect(() => {
    // Skip if no session (user not authenticated)
    if (!session) return;

    // Skip if currently authenticating (prevents race condition during sign-in)
    if (isAuthenticating) return;

    const authenticatedWallet = session.user?.user_metadata?.wallet_address?.toLowerCase();

    // Case 1: Wallet disconnected while authenticated → sign out
    if (!isConnected || !address) {
      console.warn("Wallet disconnected while authenticated. Signing out...");
      supabase.auth
        .signOut()
        .then(() => {
          setSession(null); // Clear local state immediately
        })
        .catch(error => {
          console.error("Error during automatic sign-out on wallet disconnect:", error);
          // Still clear local state even if sign-out fails
          setSession(null);
        });
      return;
    }

    // Case 2: Wallet changed to a different address → sign out
    const currentWallet = address.toLowerCase();
    if (authenticatedWallet && authenticatedWallet !== currentWallet) {
      console.warn(
        `Wallet change detected! Authenticated: ${authenticatedWallet}, Current: ${currentWallet}. Signing out...`,
      );
      supabase.auth
        .signOut()
        .then(() => {
          setSession(null); // Clear local state immediately
        })
        .catch(error => {
          console.error("Error during automatic sign-out on wallet change:", error);
          // Still clear local state even if sign-out fails
          setSession(null);
        });
    }
  }, [address, isConnected, session, isAuthenticating]);

  // ==================== Authentication Methods ====================

  /**
   * Sign in with Ethereum using SIWE (EIP-4361)
   *
   * Flow:
   * 1. Supabase constructs SIWE message with nonce
   * 2. User signs message in MetaMask (free, no gas)
   * 3. Supabase verifies signature cryptographically
   * 4. JWT issued with 1-hour expiry
   * 5. Wallet address added to user_metadata for backend extraction
   * 6. Session refreshed to include wallet in JWT
   *
   * @throws {Error} If wallet not connected, signature rejected, or auth fails
   */
  const signIn = useCallback(
    async (options: SignInOptions = {}) => {
      // Validation: Ensure wallet is connected
      if (!isConnected || !address) {
        throw new Error(ERROR_MESSAGES.WALLET_NOT_CONNECTED);
      }

      // Validation: Ensure window.ethereum exists (required by Supabase)
      if (typeof window === "undefined" || !window.ethereum) {
        throw new Error(ERROR_MESSAGES.NO_ETHEREUM_WALLET);
      }

      setIsAuthenticating(true);

      try {
        // Step 0: Clear any stale session from a different wallet
        // This handles the case: sign in with Rabby → sign out → connect MetaMask → sign in
        const {
          data: { session: existingSession },
        } = await supabase.auth.getSession();

        if (existingSession) {
          const existingWallet = existingSession.user?.user_metadata?.wallet_address?.toLowerCase();
          const currentWallet = address.toLowerCase();

          if (existingWallet && existingWallet !== currentWallet) {
            console.log(`Clearing stale session from different wallet: ${existingWallet} → ${currentWallet}`);
            await supabase.auth.signOut();
          }
        }

        const statement = options.statement || DEFAULT_SIGN_IN_STATEMENT;

        // Step 1: Sign in with Supabase Web3 auth (handles SIWE internally)
        let data, error;
        try {
          const result = await supabase.auth.signInWithWeb3({
            chain: "ethereum",
            statement,
          });
          data = result.data;
          error = result.error;
        } catch (fetchError: unknown) {
          // Handle network errors (CORS, connection refused, etc.)
          const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
          console.error("Supabase signInWithWeb3 network error:", fetchError);

          // Check if it's a CORS or network connectivity issue
          if (
            errorMessage.includes("Failed to fetch") ||
            errorMessage.includes("NetworkError") ||
            errorMessage.includes("CORS")
          ) {
            throw new Error(
              `Cannot connect to Supabase. Please ensure:\n` +
                `1. Supabase is running (run 'supabase start' in packages/api)\n` +
                `2. NEXT_PUBLIC_SUPABASE_URL is set correctly in .env.local\n` +
                `3. The Supabase URL is accessible from your browser\n` +
                `Original error: ${errorMessage}`,
            );
          }

          // Re-throw other errors
          throw fetchError instanceof Error ? fetchError : new Error(errorMessage);
        }

        if (error) throw error;

        // Step 2: Add wallet to user_metadata for backend JWT extraction
        // CRITICAL: Backend needs wallet in user_metadata to validate requests
        if (data.user && address) {
          const { error: updateError } = await supabase.auth.updateUser({
            data: { wallet_address: address.toLowerCase() },
          });

          if (updateError) {
            console.error("Failed to update user metadata with wallet address:", updateError);
            await supabase.auth.signOut();
            throw new Error(ERROR_MESSAGES.AUTH_INCOMPLETE);
          }

          // Step 3: Refresh session to get updated JWT with wallet
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) {
            console.error("Failed to refresh session after metadata update:", refreshError);
            await supabase.auth.signOut();
            throw new Error(ERROR_MESSAGES.SESSION_REFRESH_FAILED);
          }

          // Update local session state with refreshed session (includes wallet in JWT)
          // Note: onAuthStateChange might not fire for refreshSession(), so we update manually
          if (refreshData?.session) {
            setSession(refreshData.session);
          }
        }

        return data;
      } catch (error: unknown) {
        // Transform common errors into user-friendly messages
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = (error as { code?: number })?.code;

        if (errorMessage.includes("User rejected") || errorCode === 4001) {
          throw new Error(ERROR_MESSAGES.SIGNATURE_REJECTED);
        }
        if (errorMessage.includes("already used")) {
          throw new Error(ERROR_MESSAGES.SESSION_EXPIRED);
        }

        // Re-throw with original error if not handled above
        console.error("Sign in error:", error);
        throw error instanceof Error ? error : new Error(errorMessage);
      } finally {
        setIsAuthenticating(false);
      }
    },
    [isConnected, address],
  );

  /**
   * Sign out the current user
   * Clears Supabase session and any cached auth state
   * @throws {Error} If sign out fails
   */
  const signOut = useCallback(async () => {
    try {
      // Sign out from Supabase (clears session, tokens)
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;

      // Clear local session state immediately
      setSession(null);
    } catch (error: unknown) {
      console.error("Sign out error:", error);
      // Even if signOut fails, clear local state to prevent stuck UI
      setSession(null);
      throw error instanceof Error ? error : new Error("Failed to sign out");
    }
  }, []);

  /**
   * Get the current access token for API calls
   * @returns {Promise<string | null>} JWT access token or null if not authenticated
   */
  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || null;
  }, []);

  // ==================== Return Values ====================

  return {
    // Session data
    session,
    user: session?.user || null,
    walletAddress: session?.user?.user_metadata?.wallet_address || address,

    // Auth state
    isAuthenticated: !!session,
    loading,
    isAuthenticating,

    // Auth methods
    signIn,
    signOut,
    getAccessToken,

    // Supabase client (for advanced use cases)
    supabase,
  };
}

// ==================== Global Types ====================

declare global {
  interface Window {
    ethereum?: any;
  }
}
