"use client";

import React, { useMemo, useState } from "react";
import { Address, formatUnits, isAddress, maxUint256, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useBalance } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth/notification";

interface AddGuaranteeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransactionSuccess?: () => void;
}

/**
 * Modal for a guarantor to register a new bond backing a borrower
 */
export const AddGuaranteeModal: React.FC<AddGuaranteeModalProps> = ({ isOpen, onClose, onTransactionSuccess }) => {
  const { address } = useAccount();
  const [borrowerAddress, setBorrowerAddress] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const { writeContractAsync: writeUnllooAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });
  const { writeContractAsync: writeTokenAsync } = useWriteContract();

  // Get default token from contract
  const { data: defaultTokenAddress } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });

  const tokenAddress = defaultTokenAddress as Address | undefined;
  const decimals = 6; // USDC has 6 decimals

  // Get token balance
  const { data: tokenBalance } = useBalance({ address, token: tokenAddress });
  const balance = tokenBalance ? parseFloat(formatUnits(tokenBalance.value, decimals)) : 0;

  // Get Unlloo contract address for approval
  const { data: deployedContract } = useDeployedContractInfo({ contractName: "Unlloo" });
  const unllooAddress = deployedContract?.address;

  // Read allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress,
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
    ],
    functionName: "allowance",
    args: address && unllooAddress ? [address, unllooAddress as Address] : undefined,
    query: {
      enabled: !!address && !!unllooAddress && !!tokenAddress,
    },
  });

  // Collateral amount in wei (maxCoverage is set equal to collateral — 100% coverage)
  const collateralWei = useMemo(() => {
    if (!collateralAmount || parseFloat(collateralAmount) <= 0) return BigInt(0);
    try {
      return parseUnits(collateralAmount, decimals);
    } catch {
      return BigInt(0);
    }
  }, [collateralAmount]);

  const isBorrowerValid = borrowerAddress.length > 0 && isAddress(borrowerAddress);
  const needsApproval = allowance !== undefined && collateralWei > 0 && allowance < collateralWei;

  const handleApprove = async () => {
    if (!address || !unllooAddress || !tokenAddress) return;

    try {
      setIsApproving(true);
      await writeTokenAsync({
        address: tokenAddress,
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
      notification.success("Token approval successful");
    } catch (error: any) {
      console.error("Approval error:", error);
      notification.error(error?.shortMessage || error?.message || "Failed to approve token");
      setIsApproving(false);
    }
  };

  const handleRegister = async () => {
    if (!isBorrowerValid || collateralWei === BigInt(0) || !address || !tokenAddress) return;

    try {
      setIsRegistering(true);
      const loadingToast = notification.loading("Registering guarantee...");

      if (needsApproval) {
        await handleApprove();
        const allowanceResult = await refetchAllowance();
        const updatedAllowance = allowanceResult.data;
        if (updatedAllowance === undefined || updatedAllowance < collateralWei) {
          notification.remove(loadingToast);
          setIsRegistering(false);
          notification.error("Token approval failed. Please approve the token first.");
          return;
        }
      }

      await writeUnllooAsync({
        functionName: "registerGuarantee",
        args: [borrowerAddress as Address, tokenAddress, collateralWei, collateralWei],
      });

      notification.remove(loadingToast);
      notification.success("Guarantee registered successfully");

      setBorrowerAddress("");
      setCollateralAmount("");
      onTransactionSuccess?.();
      onClose();
      setIsRegistering(false);
    } catch (error: any) {
      console.error("Register guarantee error:", error);
      notification.error(error?.shortMessage || error?.message || "Failed to register guarantee");
      setIsRegistering(false);
    }
  };

  const handleMax = () => {
    if (balance > 0) {
      setCollateralAmount(balance.toFixed(6));
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
          <h2 className="text-2xl font-bold text-base-content">Add Guarantee</h2>
          <button onClick={onClose} className="text-base-content/60 hover:text-base-content">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-base-content/70 mb-2">Borrower Address</label>
            <input
              type="text"
              value={borrowerAddress}
              onChange={e => setBorrowerAddress(e.target.value)}
              placeholder="0x..."
              className={`input input-bordered w-full ${borrowerAddress && !isBorrowerValid ? "input-error" : ""}`}
            />
            {borrowerAddress && !isBorrowerValid && (
              <div className="text-xs text-error mt-1">Invalid Ethereum address</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-base-content/70 mb-2">Collateral Amount (USDC)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={collateralAmount}
                onChange={e => setCollateralAmount(e.target.value)}
                placeholder="0.00"
                step="0.000001"
                min="0"
                className="flex-1 input input-bordered w-full"
              />
              <button onClick={handleMax} className="btn btn-sm btn-outline">
                Max
              </button>
            </div>
            <div className="text-xs text-base-content/60 mt-1">Balance: {balance.toFixed(6)} USDC</div>
          </div>

          <div className="bg-base-200 rounded-lg p-3 space-y-1">
            <div className="text-sm text-base-content/70 font-medium mb-1">Bond Summary</div>
            <div className="flex justify-between text-sm">
              <span className="text-base-content/60">Collateral locked:</span>
              <span className="font-bold text-base-content">{collateralAmount || "0.00"} USDC</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-base-content/60">Max coverage:</span>
              <span className="font-bold text-primary">{collateralAmount || "0.00"} USDC</span>
            </div>
            <div className="text-xs text-base-content/50 mt-1">
              Max coverage equals collateral (100% coverage ratio)
            </div>
          </div>

          {needsApproval && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-sm text-warning-content">
                You need to approve USDC before registering. Click &ldquo;Approve USDC&rdquo; first.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline flex-1" disabled={isApproving || isRegistering}>
              Cancel
            </button>
            {needsApproval ? (
              <button
                onClick={handleApprove}
                disabled={isApproving || collateralWei === BigInt(0) || parseFloat(collateralAmount || "0") > balance}
                className="btn btn-warning flex-1"
              >
                {isApproving ? "Approving..." : "Approve USDC"}
              </button>
            ) : (
              <button
                onClick={handleRegister}
                disabled={
                  !isBorrowerValid ||
                  collateralWei === BigInt(0) ||
                  parseFloat(collateralAmount || "0") > balance ||
                  isRegistering
                }
                className="btn btn-primary flex-1"
              >
                {isRegistering ? "Registering..." : "Register Guarantee"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
