"use client";

import React, { useState } from "react";
import { Address, parseUnits } from "viem";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolAddress: Address;
  assetSymbol: string;
  assetName: string;
  assetDecimals: number;
  depositedAmount: string;
  totalWithdrawable: string;
  onTransactionSuccess?: () => void;
}

/**
 * Modal component for withdrawing liquidity from a pool
 */
export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  poolAddress,
  assetSymbol,
  assetDecimals,
  depositedAmount,
  totalWithdrawable,
  onTransactionSuccess,
}) => {
  const [amount, setAmount] = useState("");
  const { writeContractAsync: writeUnllooAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });

  const deposited = parseFloat(depositedAmount);
  const withdrawable = parseFloat(totalWithdrawable);

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    try {
      const amountWei = parseUnits(amount, assetDecimals);

      await writeUnllooAsync({
        functionName: "withdrawLiquidity",
        args: [poolAddress, amountWei],
      });

      setAmount("");
      onTransactionSuccess?.();
      onClose();
    } catch (error) {
      console.error("Withdraw error:", error);
    }
  };

  const handleMax = () => {
    if (withdrawable > 0) {
      setAmount(withdrawable.toFixed(assetDecimals === 6 ? 6 : 4));
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
          <h2 className="text-2xl font-bold text-base-content">Withdraw {assetSymbol}</h2>
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
                step={assetDecimals === 6 ? "0.000001" : "0.0001"}
                min="0"
                max={withdrawable.toString()}
                className="flex-1 input input-bordered w-full"
              />
              <button onClick={handleMax} className="btn btn-sm btn-outline">
                Max
              </button>
            </div>
            <div className="text-xs text-base-content/60 mt-1">
              Available: {withdrawable.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
            </div>
          </div>

          <div className="bg-base-200 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-base-content/70">Deposited:</span>
              <span className="font-medium text-base-content">
                {deposited.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-base-content/70">Total Withdrawable:</span>
              <span className="font-medium text-success">
                {withdrawable.toFixed(assetDecimals === 6 ? 6 : 4)} {assetSymbol}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline flex-1">
              Cancel
            </button>
            <button
              onClick={handleWithdraw}
              disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > withdrawable}
              className="btn btn-primary flex-1"
            >
              Withdraw
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
