import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

export interface GuaranteeBond {
  guarantor: Address;
  borrower: Address;
  token: Address;
  lockedAmount: bigint;
  maxCoverageAmount: bigint;
  active: boolean;
}

/**
 * Hook for reading and writing guarantor data
 */
export const useGuarantees = () => {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });

  // Borrowers I am guaranteeing
  const { data: guaranteedBorrowers, refetch: refetchBorrowers } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getGuaranteesByGuarantor",
    args: address ? [address] : [undefined],
    query: { enabled: Boolean(address) },
  });

  // Guarantors for me (as borrower)
  const { data: myGuarantors, refetch: refetchMyGuarantors } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getGuarantorsForBorrower",
    args: address ? [address] : [undefined],
    query: { enabled: Boolean(address) },
  });

  // Grace period
  const { data: gracePeriodBlocks } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "guarantorGracePeriodBlocks",
  });

  const invalidate = useCallback(async () => {
    if (publicClient) {
      const current = await publicClient.getBlockNumber();
      const target = current + 1n;
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const latest = await publicClient.getBlockNumber();
        if (latest >= target) break;
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      await new Promise(r => setTimeout(r, 2000));
    }
    queryClient.invalidateQueries({ queryKey: ["readContract"] });
    await Promise.all([refetchBorrowers(), refetchMyGuarantors()]);
  }, [publicClient, queryClient, refetchBorrowers, refetchMyGuarantors]);

  const registerGuarantee = useCallback(
    async (borrower: Address, token: Address, collateralAmount: bigint, maxCoverageAmount: bigint) => {
      await writeContractAsync({
        functionName: "registerGuarantee",
        args: [borrower, token, collateralAmount, maxCoverageAmount],
      });
      await invalidate();
    },
    [writeContractAsync, invalidate],
  );

  const removeGuarantee = useCallback(
    async (borrower: Address) => {
      await writeContractAsync({
        functionName: "removeGuarantee",
        args: [borrower],
      });
      await invalidate();
    },
    [writeContractAsync, invalidate],
  );

  const coverDebt = useCallback(
    async (loanId: bigint) => {
      await writeContractAsync({
        functionName: "guarantorCoverDebt",
        args: [loanId],
      });
      await invalidate();
    },
    [writeContractAsync, invalidate],
  );

  return {
    guaranteedBorrowers: (guaranteedBorrowers as Address[] | undefined) ?? [],
    myGuarantors: (myGuarantors as Address[] | undefined) ?? [],
    gracePeriodBlocks: gracePeriodBlocks as bigint | undefined,
    registerGuarantee,
    removeGuarantee,
    coverDebt,
    refetch: invalidate,
  };
};
