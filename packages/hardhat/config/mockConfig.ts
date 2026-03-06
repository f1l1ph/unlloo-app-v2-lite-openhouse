/**
 * Mock contract configuration for local/testnet deployments
 */
export const mockConfig = {
  erc20: {
    name: "Mock USDC",
    symbol: "mUSDC",
    decimals: 6, // USDC has 6 decimals
  },
  /**
   * Configuration for minting USDC to addresses during deployment
   *
   * This is only used for local networks (hardhat/localhost) where MockERC20 is deployed.
   * For mainnet/testnet, real USDC cannot be minted.
   *
   * Default Hardhat accounts (for reference):
   * Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   * Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
   * Account #2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
   * Account #3: 0x90F79bf6EB2c4f870365E785982E1f101E93b906
   * Account #4: 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
   */
  mint: {
    // Amount to mint per address (10,000 USDC with 6 decimals)
    amountPerAddress: "10000000000", // 10,000 * 10^6 = 10,000,000,000 (10 billion in smallest unit)

    // List of addresses to mint USDC to
    // Uncomment and add addresses you want to receive USDC during deployment
    addresses: ["0x4f57c97f76E8d1C889eaA74A02E150BE1e0EDe25"],
    admin: "0x4f57c97f76E8d1C889eaA74A02E150BE1e0EDe25",
  },
} as const;
