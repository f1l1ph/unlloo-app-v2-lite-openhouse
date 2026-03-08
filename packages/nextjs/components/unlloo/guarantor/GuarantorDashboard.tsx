"use client";

import React, { useState } from "react";
import { AddGuaranteeModal } from "./AddGuaranteeModal";
import { GuaranteeCard } from "./GuaranteeCard";
import { Address } from "viem";
import { useAccount } from "wagmi";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useGuarantees } from "~~/hooks/unlloo/useGuarantees";
import { notification } from "~~/utils/scaffold-eth/notification";

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

/**
 * Dashboard showing guarantees the connected wallet provides and guarantors backing them
 */
export const GuarantorDashboard: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { guaranteedBorrowers, myGuarantors, removeGuarantee, payOnBehalf, refetch } = useGuarantees();

  const handleRemove = async (borrower: Address) => {
    try {
      await removeGuarantee(borrower);
      notification.success("Guarantee removed");
    } catch (error: any) {
      notification.error(error?.shortMessage || error?.message || "Failed to remove guarantee");
    }
  };

  const handlePayOnBehalf = async (loanId: bigint, amount: bigint) => {
    await payOnBehalf(loanId, amount);
    refetch();
  };

  if (!isConnected || !address) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center py-16">
          <ShieldCheckIcon className="h-16 w-16 mx-auto text-base-content/30 mb-4" />
          <h2 className="text-2xl font-bold text-base-content mb-2">Guarantor Program</h2>
          <p className="text-base-content/60">Connect your wallet to manage guarantees.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Page Header */}
      <div className="flex items-center gap-3 mb-8">
        <ShieldCheckIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold text-base-content">Guarantor Program</h1>
          <p className="text-base-content/60 text-sm mt-0.5">Vouch for borrowers and pay on their behalf when needed</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="bg-base-200 rounded-xl border border-base-300 p-4">
          <div className="text-xs text-base-content/50 mb-1">Guarantees I Provide</div>
          <div className="text-2xl font-bold text-base-content">{guaranteedBorrowers.length}</div>
        </div>
        <div className="bg-base-200 rounded-xl border border-base-300 p-4">
          <div className="text-xs text-base-content/50 mb-1">My Guarantors</div>
          <div className="text-2xl font-bold text-base-content">{myGuarantors.length}</div>
        </div>
      </div>

      {/* Section 1: Guarantees I Provide */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-base-content">Guarantees I Provide</h2>
          <button onClick={() => setIsAddModalOpen(true)} className="btn btn-primary btn-sm gap-2">
            <ShieldCheckIcon className="h-4 w-4" />
            Add Guarantee
          </button>
        </div>

        {guaranteedBorrowers.length === 0 ? (
          <div className="bg-base-200 rounded-xl border border-base-300 p-8 text-center">
            <ShieldCheckIcon className="h-10 w-10 mx-auto text-base-content/30 mb-3" />
            <p className="text-base-content/60">You are not currently guaranteeing any borrowers.</p>
            <button onClick={() => setIsAddModalOpen(true)} className="btn btn-primary btn-sm mt-4">
              Add Your First Guarantee
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(guaranteedBorrowers as Address[]).map(borrower => (
              <GuaranteeCardWrapper
                key={borrower}
                guarantorAddress={address}
                borrowerAddress={borrower}
                onRemove={handleRemove}
                onPayOnBehalf={handlePayOnBehalf}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: My Guarantors */}
      <section>
        <h2 className="text-xl font-bold text-base-content mb-4">My Guarantors</h2>

        {myGuarantors.length === 0 ? (
          <div className="bg-base-200 rounded-xl border border-base-300 p-8 text-center">
            <p className="text-base-content/60">No one is currently guaranteeing your loans.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(myGuarantors as Address[]).map(guarantorAddr => (
              <GuarantorRow key={guarantorAddr} guarantorAddress={guarantorAddr} />
            ))}
          </div>
        )}
      </section>

      <AddGuaranteeModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onTransactionSuccess={refetch}
      />
    </div>
  );
};

// ============ Sub-components ============

interface GuaranteeCardWrapperProps {
  guarantorAddress: Address;
  borrowerAddress: Address;
  onRemove: (borrower: Address) => void;
  onPayOnBehalf: (loanId: bigint, amount: bigint) => Promise<void>;
}

const GuaranteeCardWrapper: React.FC<GuaranteeCardWrapperProps> = ({
  guarantorAddress,
  borrowerAddress,
  onRemove,
  onPayOnBehalf,
}) => {
  const { data: bond } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getGuaranteeBond",
    args: [borrowerAddress, guarantorAddress],
  });

  if (!bond) return null;

  const bondTyped = bond as { guarantor: Address; borrower: Address; active: boolean };

  return (
    <GuaranteeCard
      borrowerAddress={borrowerAddress}
      bond={bondTyped}
      onRemove={onRemove}
      onPayOnBehalf={onPayOnBehalf}
    />
  );
};

const GuarantorRow: React.FC<{ guarantorAddress: Address }> = ({ guarantorAddress }) => (
  <div className="bg-base-200 rounded-xl border border-base-300 p-4 flex items-center justify-between">
    <div>
      <div className="text-xs text-base-content/50 mb-0.5">Guarantor</div>
      <div className="font-mono text-sm font-medium text-base-content">{truncateAddress(guarantorAddress)}</div>
    </div>
    <div className="badge badge-success badge-sm">Active</div>
  </div>
);
