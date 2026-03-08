"use client";

import React, { useMemo, useState } from "react";
import { Address, formatUnits, maxUint256, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { GuaranteeBond } from "~~/hooks/unlloo/useGuarantees";
import { notification } from "~~/utils/scaffold-eth/notification";

interface GuaranteeCardProps {
  borrowerAddress: Address;
  bond: GuaranteeBond;
  onRemove: (borrower: Address) => void;
  onPayOnBehalf: (loanId: bigint, amount: bigint) => Promise<void>;
}

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
const DECIMALS = 6;

/**
 * Card displaying one guarantee and available actions (remove / pay on behalf)
 */
export const GuaranteeCard: React.FC<GuaranteeCardProps> = ({ borrowerAddress, bond, onRemove, onPayOnBehalf }) => {
  const { address } = useAccount();
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const { writeContractAsync: writeTokenAsync } = useWriteContract();
  const { data: deployedContract } = useDeployedContractInfo({ contractName: "Unlloo" });
  const unllooAddress = deployedContract?.address;

  const { data: defaultToken } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "defaultToken",
  });
  const tokenAddress = defaultToken as Address | undefined;

  // Active loan for this borrower
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

  const hasOpenLoan = Boolean(activeLoanId && (activeLoanId as bigint) !== 0n);
  const hasUnpaidDebt = Boolean(unpaidDebt);
  const loanId = activeLoanId as bigint | undefined;

  // Total owed on active loan
  const { data: totalOwed } = useScaffoldReadContract({
    contractName: "Unlloo",
    functionName: "getTotalOwed",
    args: loanId && loanId !== 0n ? [loanId] : [undefined],
    query: { enabled: Boolean(loanId) && loanId !== 0n },
  });

  // Token allowance
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
    query: { enabled: !!address && !!unllooAddress && !!tokenAddress },
  });

  const payAmountWei = useMemo(() => {
    if (!payAmount || parseFloat(payAmount) <= 0) return 0n;
    try {
      return parseUnits(payAmount, DECIMALS);
    } catch {
      return 0n;
    }
  }, [payAmount]);

  const needsApproval = allowance !== undefined && payAmountWei > 0n && (allowance as bigint) < payAmountWei;

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
      notification.success("Approved");
    } catch (error: any) {
      notification.error(error?.shortMessage || error?.message || "Approval failed");
    } finally {
      setIsApproving(false);
    }
  };

  const handlePay = async () => {
    if (!loanId || payAmountWei === 0n) return;
    try {
      setIsPaying(true);
      const loadingToast = notification.loading("Paying on behalf...");
      await onPayOnBehalf(loanId, payAmountWei);
      notification.remove(loadingToast);
      notification.success("Payment successful");
      setPayAmount("");
      setShowPayForm(false);
    } catch (error: any) {
      notification.error(error?.shortMessage || error?.message || "Payment failed");
    } finally {
      setIsPaying(false);
    }
  };

  const totalOwedFormatted = totalOwed ? parseFloat(formatUnits(totalOwed as bigint, DECIMALS)).toFixed(2) : null;

  return (
    <div className="bg-base-200 rounded-xl border border-base-300 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-base-content/50 mb-0.5">Borrower</div>
          <div className="font-mono text-sm font-medium text-base-content">{truncateAddress(borrowerAddress)}</div>
        </div>
        <div className={`badge ${bond.active ? "badge-success" : "badge-ghost"} badge-sm`}>
          {bond.active ? "Active" : "Inactive"}
        </div>
      </div>

      {/* Loan status */}
      {hasOpenLoan && totalOwedFormatted && (
        <div className="bg-base-100 rounded-lg p-2 flex justify-between text-sm">
          <span className="text-base-content/60">Outstanding debt</span>
          <span className="font-bold text-warning">{totalOwedFormatted} USDC</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onRemove(borrowerAddress)}
          disabled={hasOpenLoan || hasUnpaidDebt}
          className="btn btn-sm btn-outline btn-error flex-1"
          title={hasOpenLoan || hasUnpaidDebt ? "Cannot remove while borrower has open loan" : "Remove guarantee"}
        >
          Remove
        </button>
        {hasOpenLoan && loanId && (
          <button onClick={() => setShowPayForm(v => !v)} className="btn btn-sm btn-warning flex-1">
            Pay on Behalf
          </button>
        )}
      </div>

      {/* Pay on behalf form */}
      {showPayForm && loanId && (
        <div className="border border-base-300 rounded-lg p-3 space-y-2 bg-base-100">
          <div className="text-xs font-medium text-base-content/70">Amount to pay (USDC)</div>
          <div className="flex gap-2">
            <input
              type="number"
              value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
              placeholder="0.00"
              step="0.000001"
              min="0"
              className="input input-bordered input-sm flex-1"
            />
            {totalOwed && (
              <button
                onClick={() => setPayAmount(formatUnits(totalOwed as bigint, DECIMALS))}
                className="btn btn-xs btn-outline"
              >
                Max
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowPayForm(false)} className="btn btn-xs btn-outline flex-1">
              Cancel
            </button>
            {needsApproval ? (
              <button
                onClick={handleApprove}
                disabled={isApproving || payAmountWei === 0n}
                className="btn btn-xs btn-warning flex-1"
              >
                {isApproving ? "Approving..." : "Approve USDC"}
              </button>
            ) : (
              <button
                onClick={handlePay}
                disabled={isPaying || payAmountWei === 0n}
                className="btn btn-xs btn-primary flex-1"
              >
                {isPaying ? "Paying..." : "Confirm"}
              </button>
            )}
          </div>
        </div>
      )}

      {(hasOpenLoan || hasUnpaidDebt) && !showPayForm && (
        <div className="text-xs text-base-content/50">
          {hasUnpaidDebt ? "Borrower has unpaid debt." : "Borrower has an active loan."} Remove is disabled.
        </div>
      )}
    </div>
  );
};
