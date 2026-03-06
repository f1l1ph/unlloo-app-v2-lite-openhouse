import { buildAuditHeaders, storeRequestIdFromResponse } from "./auditHeaders";
import axios from "axios";
import { supabase } from "~~/utils/supabaseClient";

const API_ORIGIN = process.env.NEXT_PUBLIC_NESTJS_API_URL || "http://localhost:3000";
const API_BASE_URL = API_ORIGIN.endsWith("/api/v2") ? API_ORIGIN : `${API_ORIGIN.replace(/\/$/, "")}/api/v2`;

// Default timeout: 120 seconds for first-time reputation calculations
// Can be overridden via environment variable
const DEFAULT_TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || "160000", 10);

// Configure axios instance with authentication
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: Add audit headers and JWT token
apiClient.interceptors.request.use(async config => {
  if (typeof window !== "undefined") {
    // Add audit headers
    config.headers = {
      ...(config.headers || {}),
      ...buildAuditHeaders(),
    } as any;

    // Add JWT token if available
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch (error) {
      console.error("Failed to get auth session:", error);
    }
  }
  return config;
});

// Response interceptor: Store request ID
apiClient.interceptors.response.use(
  response => {
    if (typeof window !== "undefined") {
      storeRequestIdFromResponse(response.headers as any);
    }
    return response;
  },
  error => {
    const headers = error?.response?.headers;
    if (typeof window !== "undefined" && headers) {
      storeRequestIdFromResponse(headers as any);
    }
    return Promise.reject(error);
  },
);

export { API_BASE_URL, DEFAULT_TIMEOUT_MS };
