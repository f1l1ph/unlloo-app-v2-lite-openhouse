export const AUDIT_REQUEST_ID_STORAGE_KEY = "unlloo:x-request-id";

export function getStoredRequestId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(AUDIT_REQUEST_ID_STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function storeRequestIdFromResponse(headers: Headers | Record<string, string>): void {
  if (typeof window === "undefined") return;
  let requestId: string | null = null;

  if (headers instanceof Headers) {
    requestId = headers.get("x-request-id");
  } else {
    const key = Object.keys(headers).find(k => k.toLowerCase() === "x-request-id");
    requestId = key ? headers[key] : null;
  }

  if (!requestId) return;
  try {
    window.localStorage.setItem(AUDIT_REQUEST_ID_STORAGE_KEY, requestId);
  } catch {
    // ignore
  }
}

export function buildAuditHeaders(params?: { chainId?: number }): Record<string, string> {
  const h: Record<string, string> = {};

  // Reuse request-id after the backend issues one (backend generates by default)
  const stored = getStoredRequestId();
  if (stored) h["x-request-id"] = stored;

  if (typeof process !== "undefined") {
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (appVersion) h["x-app-version"] = appVersion;
  }

  if (params?.chainId != null) h["x-chain-id"] = String(params.chainId);

  return h;
}
