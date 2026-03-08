"use client";

import React, { useState } from "react";
import { AddGuaranteeModal } from "./AddGuaranteeModal";
import { GuaranteeCard } from "./GuaranteeCard";
import { Address, formatUnits } from "viem";
import { useAccount } from "wagmi";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useGuarantees } from "~~/hooks/unlloo/useGuarantees";
import { notification } from "~~/utils/scaffold-eth/notification";

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
const decimals = 6;

/**
 * Dashboard showing guarantees the connected wallet provides and guarantors backing them
 */
export const GuarantorDashboard: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { guaranteedBorrowers, myGuarantors, gracePeriodBlocks, removeGuarantee, coverDebt, refetch } = useGuarantees();

  // Get the default token address for total locked calculation
  const { data: defaultTokenAddress } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });

  // Total locked by connected user
  const { data: totalLocked } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getTotalLockedByGuarantor",
    args: address && defaultTokenAddress ? [address, defaultTokenAddress as Address] : [undefined, undefined],
    query: { enabled: Boolean(address) && Boolean(defaultTokenAddress) },
  });

  const totalLockedFormatted = totalLocked
    ? parseFloat(formatUnits(totalLocked as bigint, decimals)).toFixed(2)
    : "0.00";

  const handleRemove = async (borrower: Address) => {
    try {
      await removeGuarantee(borrower);
      notification.success("Guarantee removed and collateral returned");
    } catch (error: any) {
      notification.error(error?.shortMessage || error?.message || "Failed to remove guarantee");
    }
  };

  const handleCoverDebt = async (loanId: bigint) => {
    try {
      await coverDebt(loanId);
      notification.success("Debt covered successfully");
    } catch (error: any) {
      notification.error(error?.shortMessage || error?.message || "Failed to cover debt");
    }
  };

  if (!isConnected || !address) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center py-16">
          <ShieldCheckIcon className="h-16 w-16 mx-auto text-base-content/30 mb-4" />
          <h2 className="text-2xl font-bold text-base-content mb-2">Guarantor Program</h2>
          <p className="text-base-content/60">Connect your wallet to manage guarantee bonds.</p>
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
          <p className="text-base-content/60 text-sm mt-0.5">Back borrowers with collateral bonds</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-base-200 rounded-xl border border-base-300 p-4">
          <div className="text-xs text-base-content/50 mb-1">Guarantees Provided</div>
          <div className="text-2xl font-bold text-base-content">{guaranteedBorrowers.length}</div>
        </div>
        <div className="bg-base-200 rounded-xl border border-base-300 p-4">
          <div className="text-xs text-base-content/50 mb-1">Total Locked (USDC)</div>
          <div className="text-2xl font-bold text-primary">{totalLockedFormatted}</div>
        </div>
        <div className="bg-base-200 rounded-xl border border-base-300 p-4">
          <div className="text-xs text-base-content/50 mb-1">Grace Period</div>
          <div className="text-2xl font-bold text-base-content">
            {gracePeriodBlocks ? `${gracePeriodBlocks.toString()} blocks` : "—"}
          </div>
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
          <GuarantorBondList
            guarantorAddress={address}
            borrowers={guaranteedBorrowers as Address[]}
            onRemove={handleRemove}
            onCoverDebt={handleCoverDebt}
          />
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
              <GuarantorBondRow key={guarantorAddr} borrowerAddress={address} guarantorAddress={guarantorAddr} />
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

interface GuarantorBondListProps {
  guarantorAddress: Address;
  borrowers: Address[];
  onRemove: (borrower: Address) => void;
  onCoverDebt: (loanId: bigint) => void;
}

const GuarantorBondList: React.FC<GuarantorBondListProps> = ({
  guarantorAddress,
  borrowers,
  onRemove,
  onCoverDebt,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {borrowers.map(borrower => (
        <GuarantorBondItem
          key={borrower}
          guarantorAddress={guarantorAddress}
          borrowerAddress={borrower}
          onRemove={onRemove}
          onCoverDebt={onCoverDebt}
        />
      ))}
    </div>
  );
};

interface GuarantorBondItemProps {
  guarantorAddress: Address;
  borrowerAddress: Address;
  onRemove: (borrower: Address) => void;
  onCoverDebt: (loanId: bigint) => void;
}

const GuarantorBondItem: React.FC<GuarantorBondItemProps> = ({
  guarantorAddress,
  borrowerAddress,
  onRemove,
  onCoverDebt,
}) => {
  const { data: bond } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getGuaranteeBond",
    args: [borrowerAddress, guarantorAddress],
  });

  if (!bond) return null;

  const bondTyped = bond as {
    guarantor: Address;
    borrower: Address;
    token: Address;
    lockedAmount: bigint;
    maxCoverageAmount: bigint;
    active: boolean;
  };

  return (
    <GuaranteeCard borrowerAddress={borrowerAddress} bond={bondTyped} onRemove={onRemove} onCoverDebt={onCoverDebt} />
  );
};

interface GuarantorBondRowProps {
  borrowerAddress: Address;
  guarantorAddress: Address;
}

const GuarantorBondRow: React.FC<GuarantorBondRowProps> = ({ borrowerAddress, guarantorAddress }) => {
  const { data: bond } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getGuaranteeBond",
    args: [borrowerAddress, guarantorAddress],
  });

  if (!bond) return null;

  const bondTyped = bond as {
    guarantor: Address;
    borrower: Address;
    token: Address;
    lockedAmount: bigint;
    maxCoverageAmount: bigint;
    active: boolean;
  };

  const lockedFormatted = parseFloat(formatUnits(bondTyped.lockedAmount, decimals)).toFixed(2);

  return (
    <div className="bg-base-200 rounded-xl border border-base-300 p-4 flex items-center justify-between">
      <div>
        <div className="text-xs text-base-content/50 mb-0.5">Guarantor</div>
        <div className="font-mono text-sm font-medium text-base-content">{truncateAddress(guarantorAddress)}</div>
      </div>
      <div className="text-right">
        <div className="text-xs text-base-content/50 mb-0.5">Locked</div>
        <div className="font-bold text-primary">{lockedFormatted} USDC</div>
      </div>
      <div className={`badge ${bondTyped.active ? "badge-success" : "badge-ghost"} badge-sm ml-2`}>
        {bondTyped.active ? "Active" : "Inactive"}
      </div>
    </div>
  );
};
