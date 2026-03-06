import { Address } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

/**
 * Hook to get available tokens dynamically from contract
 */
export const useAvailableTokens = () => {
  const { data: defaultToken } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });

  if (!defaultToken) {
    return [];
  }

  return [
    {
      address: defaultToken as Address,
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  ];
};
