"use client";

import React from "react";
import { Address, formatUnits } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { GuaranteeBond } from "~~/hooks/unlloo/useGuarantees";

interface GuaranteeCardProps {
  borrowerAddress: Address;
  bond: GuaranteeBond;
  onRemove: (borrower: Address) => void;
  onCoverDebt: (loanId: bigint) => void;
}

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

/**
 * Card displaying one guarantee bond and available actions
 */
export const GuaranteeCard: React.FC<GuaranteeCardProps> = ({ borrowerAddress, bond, onRemove, onCoverDebt }) => {
  const decimals = 6;

  // Check if borrower has an active or unpaid loan
  const { data: activeLoanId } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getActiveLoanByBorrower",
    args: [borrowerAddress],
  });

  const { data: unpaidDebt } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "hasUnpaidDebt",
    args: [borrowerAddress],
  });

  const hasOpenLoan = Boolean(activeLoanId && (activeLoanId as bigint) !== BigInt(0));
  const hasUnpaidDebt = Boolean(unpaidDebt);

  const lockedFormatted = parseFloat(formatUnits(bond.lockedAmount, decimals)).toFixed(2);
  const maxCoverageFormatted = parseFloat(formatUnits(bond.maxCoverageAmount, decimals)).toFixed(2);

  return (
    <div className="bg-base-200 rounded-xl border border-base-300 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-base-content/50 mb-0.5">Borrower</div>
          <div className="font-mono text-sm font-medium text-base-content">{truncateAddress(borrowerAddress)}</div>
        </div>
        <div className={`badge ${bond.active ? "badge-success" : "badge-ghost"} badge-sm`}>
          {bond.active ? "Active" : "Inactive"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-base-100 rounded-lg p-2">
          <div className="text-xs text-base-content/50 mb-0.5">Locked</div>
          <div className="font-bold text-base-content">{lockedFormatted} USDC</div>
        </div>
        <div className="bg-base-100 rounded-lg p-2">
          <div className="text-xs text-base-content/50 mb-0.5">Max Coverage</div>
          <div className="font-bold text-base-content">{maxCoverageFormatted} USDC</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onRemove(borrowerAddress)}
          disabled={hasOpenLoan || hasUnpaidDebt}
          className="btn btn-sm btn-outline btn-error flex-1"
          title={hasOpenLoan || hasUnpaidDebt ? "Cannot remove while borrower has open loan" : "Remove guarantee"}
        >
          Remove
        </button>
        {hasUnpaidDebt && activeLoanId && (activeLoanId as bigint) !== BigInt(0) && (
          <button
            onClick={() => onCoverDebt(activeLoanId as bigint)}
            className="btn btn-sm btn-warning flex-1"
            title="Cover borrower's unpaid debt using your bond"
          >
            Cover Debt
          </button>
        )}
      </div>

      {(hasOpenLoan || hasUnpaidDebt) && (
        <div className="text-xs text-base-content/50">
          {hasUnpaidDebt ? "Borrower has unpaid debt." : "Borrower has an active loan."} Remove is disabled.
        </div>
      )}
    </div>
  );
};
