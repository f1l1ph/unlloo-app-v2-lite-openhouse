/**
 * Network configuration for Unlloo deployment
 *
 * This file contains network-specific addresses for:
 * - Chainlink USDC/USD Price Feed addresses
 * - USDC token addresses
 *
 * Source for price feeds: https://docs.chain.link/data-feeds/price-feeds/addresses
 */

export interface NetworkAddresses {
  usdc: string;
}

export const networkAddresses: Record<string, NetworkAddresses> = {
  // Ethereum Mainnet
  mainnet: {
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC on Ethereum
  },
  // Ethereum Sepolia Testnet
  sepolia: {
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC on Sepolia
  },
  // Robinhood Chain Testnet (Arbitrum Orbit L2, Chain ID: 46630)
  // No USDC deployed yet — mock contract will be used
  robinhoodTestnet: {
    usdc: "0x0000000000000000000000000000000000000000",
  },
  // Local networks (use zero address - deployer should deploy mock contracts)
  hardhat: {
    usdc: "0x0000000000000000000000000000000000000000",
  },
  localhost: {
    usdc: "0x0000000000000000000000000000000000000000",
  },
};

/**
 * Block time in milliseconds for each network
 * Using milliseconds to avoid precision issues with decimal seconds
 */
export const blockTimeMilliseconds: Record<string, number> = {
  hardhat: 1000, // 1 second = 1000ms
  localhost: 1000, // 1 second = 1000ms
  mainnet: 12000, // 12 seconds = 12000ms
  sepolia: 12000, // 12 seconds = 12000ms
  robinhoodTestnet: 250, // ~250ms (Arbitrum Orbit L2)
};

/**
 * Convert block time from milliseconds to seconds for contract deployment
 */
export function getBlockTimeSeconds(networkName: string): number {
  const blockTimeMs = blockTimeMilliseconds[networkName] || 2000; // Default 2 seconds
  return blockTimeMs / 1000; // Convert to seconds
}
