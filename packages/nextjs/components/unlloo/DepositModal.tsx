"use client";

import React, { useMemo, useState } from "react";
import { Address, formatUnits, maxUint256, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useBalance } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolAddress: Address;
  assetSymbol: string;
  assetName: string;
  onTransactionSuccess?: () => void;
}

/**
 * Modal component for depositing liquidity into a pool
 */
export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  poolAddress,
  assetSymbol,
  onTransactionSuccess,
}) => {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const { writeContractAsync: writeUnllooAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });
  const { writeContractAsync: writeTokenAsync } = useWriteContract();
  const { data: tokenBalance } = useBalance({ address, token: poolAddress });

  // Get Unlloo contract address for approval
  const { data: deployedContract } = useDeployedContractInfo({ contractName: "Unlloo" });
  const unllooAddress = deployedContract?.address;

  // Read allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: poolAddress,
    abi: [
      {
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
      {
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ],
    functionName: "allowance",
    args: address && unllooAddress ? [address, unllooAddress as Address] : undefined,
    query: {
      enabled: !!address && !!unllooAddress,
    },
  });

  const decimals = 6; // USDC has 6 decimals
  const balance = tokenBalance ? parseFloat(formatUnits(tokenBalance.value, decimals)) : 0;
  const amountWei = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return BigInt(0);
    try {
      return parseUnits(amount, decimals);
    } catch {
      return BigInt(0);
    }
  }, [amount, decimals]);

  const needsApproval = allowance !== undefined && amountWei > 0 && allowance < amountWei;

  const handleApprove = async () => {
    if (!address || !unllooAddress) return;

    try {
      setIsApproving(true);
      await writeTokenAsync({
        address: poolAddress,
        abi: [
          {
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            name: "approve",
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "approve",
        args: [unllooAddress as Address, maxUint256],
      });
      await refetchAllowance();
      setIsApproving(false);
    } catch (error) {
      console.error("Approval error:", error);
      setIsApproving(false);
    }
  };

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0 || !address) return;

    try {
      setIsDepositing(true);

      // Check if approval is needed
      if (needsApproval) {
        await handleApprove();
      }

      // Then deposit
      await writeUnllooAsync({
        functionName: "depositLiquidity",
        args: [poolAddress, amountWei],
      });

      setAmount("");
      onTransactionSuccess?.();
      onClose();
      setIsDepositing(false);
    } catch (error) {
      console.error("Deposit error:", error);
      setIsDepositing(false);
    }
  };

  const handleMax = () => {
    if (balance > 0) {
      setAmount(balance.toFixed(6));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-base-100 rounded-xl border border-base-300 p-6 max-w-md w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-base-content">Deposit {assetSymbol}</h2>
          <button onClick={onClose} className="text-base-content/60 hover:text-base-content">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-base-content/70 mb-2">Amount ({assetSymbol})</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.000001"
                min="0"
                className="flex-1 input input-bordered w-full"
              />
              <button onClick={handleMax} className="btn btn-sm btn-outline">
                Max
              </button>
            </div>
            <div className="text-xs text-base-content/60 mt-1">
              Balance: {balance.toFixed(6)} {assetSymbol}
            </div>
          </div>

          <div className="bg-base-200 rounded-lg p-3">
            <div className="text-sm text-base-content/70 mb-1">You will deposit</div>
            <div className="text-lg font-bold text-base-content">
              {amount || "0.00"} {assetSymbol}
            </div>
          </div>

          {needsApproval && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-sm text-warning-content">
                You need to approve {assetSymbol} before depositing. Click `Approve` first, then `Deposit`.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline flex-1">
              Cancel
            </button>
            {needsApproval ? (
              <button
                onClick={handleApprove}
                disabled={isApproving || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > balance}
                className="btn btn-warning flex-1"
              >
                {isApproving ? "Approving..." : "Approve"}
              </button>
            ) : (
              <button
                onClick={handleDeposit}
                disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > balance || isDepositing}
                className="btn btn-primary flex-1"
              >
                {isDepositing ? "Depositing..." : "Deposit"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
