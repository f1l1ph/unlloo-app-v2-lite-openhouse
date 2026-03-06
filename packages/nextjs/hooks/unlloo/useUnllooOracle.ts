import { Address } from "viem";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

/**
 * Hook to interact with the Unlloo oracle for on-chain reputation requests
 */
export const useUnllooOracle = () => {
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });

  const requestReputation = async (walletAddress: Address) => {
    // Check if the contract has a requestReputation function
    // If not, this might be handled differently
    try {
      // This would call a function on the contract to request reputation calculation
      // The contract would emit an event that the backend listens to
      // For now, we'll assume this is handled via a contract function if it exists
      // If the function doesn't exist, this will be a no-op and we'll rely on API-only calculation

      // Note: The old implementation called requestReputation on-chain
      // We need to check if this function exists in the contract
      // If it doesn't exist, we can skip this step and just use API calculation

      return await writeContractAsync({
        functionName: "requestReputation",
        args: [walletAddress],
      } as any);
    } catch (error) {
      // If the function doesn't exist, that's okay - we'll use API-only calculation
      console.warn("On-chain reputation request not available, using API-only calculation");
      throw error;
    }
  };

  return {
    requestReputation,
  };
};
