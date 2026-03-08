"use client";

import React, { useState } from "react";
import { Address, isAddress } from "viem";
import { useAccount } from "wagmi";
import { ShieldCheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth/notification";

interface AddGuaranteeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransactionSuccess?: () => void;
}

/**
 * Modal for a guarantor to register backing for a borrower.
 * No collateral required — guarantor just vouches and can pay on their behalf later.
 */
export const AddGuaranteeModal: React.FC<AddGuaranteeModalProps> = ({ isOpen, onClose, onTransactionSuccess }) => {
  const { address } = useAccount();
  const [borrowerAddress, setBorrowerAddress] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);

  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "Unlloo" });

  const isBorrowerValid = borrowerAddress.length > 0 && isAddress(borrowerAddress);
  const isSelf = address && borrowerAddress.toLowerCase() === address.toLowerCase();

  const handleRegister = async () => {
    if (!isBorrowerValid || isSelf) return;

    try {
      setIsRegistering(true);
      const loadingToast = notification.loading("Registering guarantee...");

      await writeContractAsync({
        functionName: "registerGuarantee",
        args: [borrowerAddress as Address],
      });

      notification.remove(loadingToast);
      notification.success("Guarantee registered successfully");

      setBorrowerAddress("");
      onTransactionSuccess?.();
      onClose();
    } catch (error: any) {
      notification.error(error?.shortMessage || error?.message || "Failed to register guarantee");
    } finally {
      setIsRegistering(false);
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
          <div className="bg-base-200 rounded-lg p-3 flex gap-3 items-start">
            <ShieldCheckIcon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-base-content/70">
              You are vouching for this borrower. No funds are locked — you can choose to pay on their behalf at any
              time.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-base-content/70 mb-2">Borrower Address</label>
            <input
              type="text"
              value={borrowerAddress}
              onChange={e => setBorrowerAddress(e.target.value)}
              placeholder="0x..."
              className={`input input-bordered w-full ${borrowerAddress && (!isBorrowerValid || isSelf) ? "input-error" : ""}`}
            />
            {borrowerAddress && !isBorrowerValid && (
              <div className="text-xs text-error mt-1">Invalid Ethereum address</div>
            )}
            {isSelf && <div className="text-xs text-error mt-1">Cannot guarantee yourself</div>}
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline flex-1" disabled={isRegistering}>
              Cancel
            </button>
            <button
              onClick={handleRegister}
              disabled={!isBorrowerValid || Boolean(isSelf) || isRegistering}
              className="btn btn-primary flex-1"
            >
              {isRegistering ? "Registering..." : "Register Guarantee"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
