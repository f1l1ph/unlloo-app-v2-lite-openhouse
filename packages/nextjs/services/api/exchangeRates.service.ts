import { buildAuditHeaders, storeRequestIdFromResponse } from "./auditHeaders";

const API_ORIGIN = process.env.NEXT_PUBLIC_NESTJS_API_URL || "http://localhost:3000";
const API_BASE_URL = API_ORIGIN.endsWith("/api/v2") ? API_ORIGIN : `${API_ORIGIN.replace(/\/$/, "")}/api/v2`;

export type SupportedChain = "ethereum" | "arbitrum" | "base" | "avalanche" | "optimism" | "sepolia"; // @TODO Sepolia can be security issue, should be removed

export interface TokenUsdPriceResponse {
  chain: SupportedChain;
  tokenAddress: string;
  usdPrice: number;
  usdPriceE6: number;
  source: string;
  lastUpdated: string;
}

export async function getTokenUsdPrice(params: {
  chain: SupportedChain;
  tokenAddress: string;
  chainId?: number;
}): Promise<TokenUsdPriceResponse> {
  const url = new URL(`${API_BASE_URL}/exchange-rates/token-usd`);
  url.searchParams.set("chain", params.chain);
  url.searchParams.set("tokenAddress", params.tokenAddress);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      ...buildAuditHeaders({ chainId: params.chainId }),
    },
  });

  storeRequestIdFromResponse(response.headers);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorData.message || `Failed to fetch token USD price: ${response.statusText}`);
  }

  return response.json();
}
