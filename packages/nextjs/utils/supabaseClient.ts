import { SupabaseClient, createClient } from "@supabase/supabase-js";

/**
 * Get Supabase URL from environment variables
 * @throws {Error} If NEXT_PUBLIC_SUPABASE_URL is not set or is a placeholder
 */
const getSupabaseUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.trim().length === 0) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL environment variable. Please set it in your .env.local file.\n" +
        "For local development, use: http://127.0.0.1:54321\n" +
        "Get your local Supabase URL by running 'supabase status' in packages/api",
    );
  }

  // Check for placeholder URLs
  const placeholderPatterns = [/xxx\.supabase\.co/i, /your-project/i, /example\.com/i, /placeholder/i];

  for (const pattern of placeholderPatterns) {
    if (pattern.test(url)) {
      throw new Error(
        `NEXT_PUBLIC_SUPABASE_URL appears to be a placeholder: "${url}"\n` +
          `Please set a real Supabase URL in your .env.local file.\n` +
          `For local development:\n` +
          `  1. Start Supabase: cd packages/api && supabase start\n` +
          `  2. Run: supabase status\n` +
          `  3. Copy the "API URL" to NEXT_PUBLIC_SUPABASE_URL in packages/nextjs/.env.local\n` +
          `  Example: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
      );
    }
  }

  // Validate URL format
  try {
    const urlObj = new URL(url);
    if (!urlObj.protocol || (!urlObj.protocol.startsWith("http") && !urlObj.protocol.startsWith("https"))) {
      throw new Error(`Invalid URL protocol: ${urlObj.protocol}`);
    }
  } catch (error) {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUPABASE_URL format: "${url}"\n` +
        `Expected a valid URL like http://127.0.0.1:54321 or https://xxx.supabase.co`,
    );
  }

  return url;
};

/**
 * Get Supabase anonymous key from environment variables
 * @throws {Error} If NEXT_PUBLIC_SUPABASE_ANON_KEY is not set or is a placeholder
 */
const getSupabaseAnonKey = (): string => {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable. Please set it in your .env.local file.\n" +
        "Get your local Supabase anon key by running 'supabase status' in packages/api",
    );
  }

  // Check for placeholder keys
  const placeholderPatterns = [/^xxx/i, /^your-/i, /^example/i, /^placeholder/i, /^sb_anon_xxx/i];

  for (const pattern of placeholderPatterns) {
    if (pattern.test(key)) {
      throw new Error(
        `NEXT_PUBLIC_SUPABASE_ANON_KEY appears to be a placeholder: "${key.substring(0, 20)}..."\n` +
          `Please set a real Supabase anon key in your .env.local file.\n` +
          `For local development:\n` +
          `  1. Start Supabase: cd packages/api && supabase start\n` +
          `  2. Run: supabase status\n` +
          `  3. Copy the "anon key" to NEXT_PUBLIC_SUPABASE_ANON_KEY in packages/nextjs/.env.local`,
      );
    }
  }

  return key;
};

/**
 * Supabase client instance for authentication and database operations
 * Configured with Web3 authentication (SIWE) support
 *
 * @see https://supabase.com/docs/guides/auth/social-login/auth-ethereum
 */
export const supabase: SupabaseClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
  auth: {
    // Enable automatic token refresh
    autoRefreshToken: true,
    // Persist session in localStorage
    persistSession: true,
    // Detect session from URL (for OAuth redirects)
    detectSessionInUrl: true,
    // Storage key for session persistence
    storageKey: "unlloo-auth-token",
    // Storage implementation (uses localStorage in browser)
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
