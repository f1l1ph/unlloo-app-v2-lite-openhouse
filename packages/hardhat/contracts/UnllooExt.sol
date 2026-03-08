// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./UnllooStorage.sol";
import "./IUnlloo.sol";
import "./libraries/UnllooStatusArray.sol";
import "./errors/UnllooErrors.sol";

/**
 * @title UnllooExt
 * @notice Extension contract containing all admin functions and external view functions
 *         for the Unlloo lending protocol.
 * @dev This contract is invoked exclusively via delegatecall from UnllooCore's fallback
 *      function. It has no constructor, no initializer, and no fallback of its own.
 *      All storage reads and writes operate on UnllooCore's (proxy's) storage through
 *      the delegatecall context. Modifiers inherited from UnllooStorage (onlyOwner,
 *      nonReentrant, whenPaused, whenNotPaused) work correctly because they read from
 *      the same storage slots.
 *
 *      Storage layout MUST remain identical to UnllooCore. Both contracts inherit only
 *      UnllooStorage, which is the sole mechanism ensuring layout parity.
 */
contract UnllooExt is UnllooStorage {
    using SafeERC20 for IERC20;
    using UnllooStatusArray for uint256[];

    // ============ Admin Functions ============

    /// @notice Approve a pending loan request (admin only)
    function approveLoanRequest(uint256 loanId) external onlyOwner {
        _requireLoanExists(loanId);
        IUnlloo.Loan storage loan = loans[loanId];

        if (loan.status != IUnlloo.LoanStatus.Pending)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Pending));
        if (_hasUnpaidDebt(loan.borrower)) revert UnllooErrors.HasUnpaidDebt(loan.borrower);
        if (_activeLoanByBorrower[loan.borrower] != 0) revert UnllooErrors.HasActiveLoan(loan.borrower);

        loan.status = IUnlloo.LoanStatus.Approved;
        loan.approvalBlock = block.number;

        _loansByStatus[IUnlloo.LoanStatus.Pending].remove(
            _loanStatusIndex[IUnlloo.LoanStatus.Pending],
            loanId,
            IUnlloo.LoanStatus.Pending
        );
        _loansByStatus[IUnlloo.LoanStatus.Approved].add(
            _loanStatusIndex[IUnlloo.LoanStatus.Approved],
            loanId,
            IUnlloo.LoanStatus.Approved
        );

        emit IUnlloo.LoanRequestApproved(loanId, loan.borrower, block.number);
    }

    /// @notice Reject a pending loan request (admin only)
    function rejectLoanRequest(uint256 loanId) external onlyOwner {
        _requireLoanExists(loanId);
        IUnlloo.Loan storage loan = loans[loanId];
        if (loan.status != IUnlloo.LoanStatus.Pending)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Pending));

        loan.status = IUnlloo.LoanStatus.Rejected;

        _loansByStatus[IUnlloo.LoanStatus.Pending].remove(
            _loanStatusIndex[IUnlloo.LoanStatus.Pending],
            loanId,
            IUnlloo.LoanStatus.Pending
        );
        _loansByStatus[IUnlloo.LoanStatus.Rejected].add(
            _loanStatusIndex[IUnlloo.LoanStatus.Rejected],
            loanId,
            IUnlloo.LoanStatus.Rejected
        );

        if (openRequestCount[loan.borrower] > 0) openRequestCount[loan.borrower] -= 1;

        emit IUnlloo.LoanRequestRejected(loanId, loan.borrower, block.number);
    }

    /// @notice Pause all protocol operations (admin only)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume protocol operations after pause (admin only)
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Add a new liquidity pool for a token (admin only)
    function addLiquidityPool(address token, uint256 minLoanAmount, uint256 maxLoanAmount) external onlyOwner {
        if (token == address(0)) revert UnllooErrors.InvalidPool(address(0));
        if (pools[token].token != address(0)) revert UnllooErrors.PoolExists(token);

        _validateTokenDecimals(token);

        if (minLoanAmount == 0 || maxLoanAmount == 0)
            revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);
        if (minLoanAmount >= maxLoanAmount) revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);

        pools[token] = IUnlloo.LiquidityPool({ token: token, totalLiquidity: 0, borrowedAmount: 0 });
        minLoanAmountPerPool[token] = minLoanAmount;
        maxLoanAmountPerPool[token] = maxLoanAmount;

        poolSupplyIndex[token] = INDEX_SCALE;

        // Set default rate curve for new pool
        _poolRateCurve[token] = IUnlloo.RateCurveParams({
            baseRateBps: DEFAULT_BASE_RATE_BPS,
            optimalUtilizationBps: DEFAULT_OPTIMAL_UTILIZATION_BPS,
            slope1Bps: DEFAULT_SLOPE1_BPS,
            slope2Bps: DEFAULT_SLOPE2_BPS,
            protocolFeeBps: DEFAULT_PROTOCOL_FEE_BPS
        });

        emit IUnlloo.PoolAdded(token, block.number);
    }

    /// @notice Remove a liquidity pool (admin only)
    /// @dev **Warning:** Any accumulated undistributed interest (rounding dust) will be lost
    ///      when the pool is removed. This is typically negligible but should be considered.
    ///      Ensure all lenders have withdrawn before removing a pool.
    function removeLiquidityPool(address token) external onlyOwner {
        IUnlloo.LiquidityPool memory pool = pools[token];
        if (pool.token == address(0)) revert UnllooErrors.InvalidPool(token);
        if (pool.totalLiquidity > 0) revert UnllooErrors.PoolNotEmpty(token);

        if (activeLoansPerPool[token] != 0 || unpaidDebtLoansPerPool[token] != 0) {
            revert UnllooErrors.ActiveLoansUsingPool(token);
        }

        delete pools[token];
        delete minLoanAmountPerPool[token];
        delete maxLoanAmountPerPool[token];
        delete poolSupplyIndex[token];
        delete poolUndistributedInterest[token];
        delete _poolRateCurve[token];

        emit IUnlloo.PoolRemoved(token, block.number);
    }

    /// @notice Update loan amount limits for a pool (admin only)
    function updatePoolLoanLimits(address token, uint256 minLoanAmount, uint256 maxLoanAmount) external onlyOwner {
        if (token == address(0) || pools[token].token == address(0)) revert UnllooErrors.InvalidPool(token);
        if (minLoanAmount == 0 || maxLoanAmount == 0)
            revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);
        if (minLoanAmount >= maxLoanAmount) revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);

        minLoanAmountPerPool[token] = minLoanAmount;
        maxLoanAmountPerPool[token] = maxLoanAmount;

        emit IUnlloo.PoolLoanLimitsUpdated(token, minLoanAmount, maxLoanAmount, block.number);
    }

    /// @notice Update interest rate curve parameters for a specific pool (admin only)
    function updatePoolRateCurve(
        address token,
        uint256 baseRateBps,
        uint256 optimalUtilizationBps,
        uint256 slope1Bps,
        uint256 slope2Bps,
        uint256 protocolFeeBps
    ) external onlyOwner {
        _requireValidPool(token);

        // Validation: baseRateBps max 10%
        if (baseRateBps > 1000) {
            revert UnllooErrors.InvalidRateCurveParam(token, "baseRateBps", baseRateBps);
        }

        // Validation: optimalUtilizationBps between 50% and 95%
        if (optimalUtilizationBps < 5000 || optimalUtilizationBps > 9500) {
            revert UnllooErrors.InvalidRateCurveParam(token, "optimalUtilizationBps", optimalUtilizationBps);
        }

        // Validation: slope1Bps max 20%
        if (slope1Bps > 2000) {
            revert UnllooErrors.InvalidRateCurveParam(token, "slope1Bps", slope1Bps);
        }

        // Validation: slope2Bps max 100%
        if (slope2Bps > 10000) {
            revert UnllooErrors.InvalidRateCurveParam(token, "slope2Bps", slope2Bps);
        }

        // Validation: protocolFeeBps max 50%
        if (protocolFeeBps > 5000) {
            revert UnllooErrors.InvalidRateCurveParam(token, "protocolFeeBps", protocolFeeBps);
        }

        // Validation: max possible rate must not exceed MAX_BORROWER_RATE
        uint256 maxPossibleRate = baseRateBps + slope1Bps + slope2Bps;
        if (maxPossibleRate > MAX_BORROWER_RATE) {
            revert UnllooErrors.InvalidRateCurveParam(token, "totalMaxRate", maxPossibleRate);
        }

        _poolRateCurve[token] = IUnlloo.RateCurveParams({
            baseRateBps: baseRateBps,
            optimalUtilizationBps: optimalUtilizationBps,
            slope1Bps: slope1Bps,
            slope2Bps: slope2Bps,
            protocolFeeBps: protocolFeeBps
        });

        emit IUnlloo.InterestRatesUpdated(
            token,
            baseRateBps,
            optimalUtilizationBps,
            slope1Bps,
            slope2Bps,
            protocolFeeBps,
            block.number
        );
    }

    /// @notice Update minimum reputation threshold for loan requests (admin only)
    function updateMinReputation(uint16 newMinReputation) external onlyOwner {
        if (newMinReputation > 1000) revert UnllooErrors.InvalidReputation(newMinReputation, 0);
        if (newMinReputation == minReputation) revert UnllooErrors.InvalidReputation(newMinReputation, minReputation);

        uint16 oldMinReputation = minReputation;
        minReputation = newMinReputation;

        emit IUnlloo.MinReputationUpdated(oldMinReputation, newMinReputation, block.number);
    }

    /// @notice Update cooldown period between loan requests (admin only)
    function updateCooldownBlocks(uint256 newCooldownBlocks) external onlyOwner {
        // Calculate min/max cooldown (multiply first, divide last to avoid precision loss)
        uint256 minCooldown = SECONDS_PER_DAY / blockTimeSeconds;
        if (minCooldown == 0) revert UnllooErrors.InvalidBlockTime(blockTimeSeconds);

        // maxCooldown = 30 days worth of blocks
        uint256 maxCooldown = (SECONDS_PER_DAY * 30) / blockTimeSeconds;

        if (newCooldownBlocks < minCooldown || newCooldownBlocks > maxCooldown) {
            revert UnllooErrors.InvalidDuration(newCooldownBlocks, minCooldown, maxCooldown);
        }
        if (newCooldownBlocks == cooldownBlocks) {
            revert UnllooErrors.InvalidDuration(newCooldownBlocks, cooldownBlocks, cooldownBlocks);
        }

        uint256 oldCooldownBlocks = cooldownBlocks;
        cooldownBlocks = newCooldownBlocks;

        emit IUnlloo.CooldownBlocksUpdated(oldCooldownBlocks, newCooldownBlocks, block.number);
    }

    /// @notice Withdraw accumulated protocol fees (admin only)
    function withdrawProtocolFees(address token, uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        _validateNonZeroAddress(token);
        _validateNonZeroAmount(amount, protocolFees[token]);

        protocolFees[token] -= amount;
        address o = owner();
        _safeTransferExact(token, o, amount);
        emit IUnlloo.ProtocolFeesWithdrawn(o, token, amount, block.number);
    }

    /// @notice Withdraw ETH from contract (admin only)
    function withdrawETH(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        uint256 fees = protocolFees[address(0)];
        if (amount == 0 || amount > fees) revert UnllooErrors.InvalidAmount(amount, 1, fees);

        uint256 bal = address(this).balance;
        if (amount > bal) revert UnllooErrors.InvalidAmount(amount, 1, bal);

        // Effects (state changes before external call - CEI pattern)
        protocolFees[address(0)] = fees - amount;
        address recipient = owner();

        // Emit before interaction (strict CEI)
        emit IUnlloo.ETHWithdrawn(recipient, amount, block.number);

        // Interaction: low-level call with explicit error handling
        (bool success, ) = payable(recipient).call{ value: amount }("");
        require(success, "ETH_TRANSFER_FAILED");
    }

    /**
     * @dev Safer emergency withdraw: only allows withdrawing tokens NOT configured as a pool token.
     *      For pool tokens, use withdrawProtocolFees().
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner whenPaused nonReentrant {
        _validateNonZeroAddress(token);

        // Disallow emergency withdraw for active pools to prevent accidental LP fund theft.
        if (pools[token].token != address(0)) revert UnllooErrors.InvalidPool(token);

        uint256 balance = IERC20(token).balanceOf(address(this));
        _validateNonZeroAmount(amount, balance);

        _safeTransferExact(token, owner(), amount);
        emit IUnlloo.EmergencyWithdraw(token, amount, block.number);
    }

    // ============ External View Functions ============

    /// @notice Get loan information with virtual status projection
    /// @dev **IMPORTANT: This function performs VIRTUAL STATUS PROJECTION**
    ///      The returned loan status may differ from actual storage state.
    function getLoan(uint256 loanId) external view returns (IUnlloo.Loan memory loan) {
        loan = loans[loanId];
        if (loan.borrower == address(0)) return loan;

        // Virtual status projection: reflect overdue status for UI even if storage hasn't updated
        if (loan.status == IUnlloo.LoanStatus.Active || loan.status == IUnlloo.LoanStatus.UnpaidDebt) {
            uint256 deadline = loan.deadlineBlock;
            if (deadline == 0) deadline = loan.startBlock + loan.loanDurationBlocks;
            if (deadline != 0 && block.number >= deadline) {
                // Project UnpaidDebt status even if storage still shows Active
                loan.status = IUnlloo.LoanStatus.UnpaidDebt;
                loan.deadlineBlock = deadline;
            }
        }
    }

    /// @notice Get remaining balance (principal + interest) — alias for getTotalOwed, kept for compatibility
    function getRemainingBalance(uint256 loanId) external view returns (uint256 remainingBalance) {
        _requireLoanExists(loanId);
        return loans[loanId].principal + _interestDue(loanId);
    }

    /// @notice Calculate current accrued interest for a loan
    function getAccruedInterest(uint256 loanId) external view returns (uint256 accruedInterest) {
        _requireLoanExists(loanId);
        return _interestDue(loanId);
    }

    /// @notice Calculate total amount currently owed on a loan
    function getTotalOwed(uint256 loanId) external view returns (uint256 totalOwed) {
        _requireLoanExists(loanId);
        return loans[loanId].principal + _interestDue(loanId);
    }

    /// @notice Calculate current borrow rate for a token pool
    function calculateBorrowRate(address token) external view returns (uint256 rateBps) {
        return _calculateBorrowRate(token);
    }

    /// @notice Get all loan IDs for a specific borrower
    function getLoansByBorrower(address borrower) external view returns (uint256[] memory) {
        return _borrowerLoans[borrower];
    }

    /// @notice Get loan IDs filtered by status with pagination
    function getLoansByStatus(
        IUnlloo.LoanStatus status,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory loanIds) {
        uint256[] storage statusLoans = _loansByStatus[status];
        uint256 length = statusLoans.length;

        if (offset >= length || limit == 0) return loanIds;

        uint256 end = offset + limit;
        if (end > length) end = length;

        uint256 resultLength = end - offset;
        loanIds = new uint256[](resultLength);

        for (uint256 i = offset; i < end; i++) {
            loanIds[i - offset] = statusLoans[i];
        }
    }

    /// @notice Get aggregate pool state for a token
    function getLiquidityPool(address token) external view returns (IUnlloo.LiquidityPool memory pool) {
        pool = pools[token];
    }

    /// @notice Get count of active lenders in a pool
    function getActiveLenderCount(address token) external view returns (uint256 count) {
        return activeLenderCount[token];
    }

    /// @notice Get the active or unpaid loan ID for a borrower
    function getActiveLoanByBorrower(address borrower) external view returns (uint256 loanId) {
        loanId = _activeLoanByBorrower[borrower];
        // Sentinel check: no active loan ID set
        if (loanId == 0) return 0;

        IUnlloo.Loan memory loan = loans[loanId];
        if (loan.status != IUnlloo.LoanStatus.Active) return 0;
        // Sentinel check: loan not yet started (startBlock == 0) or invalid duration
        if (loan.startBlock == 0 || loan.loanDurationBlocks == 0) return 0;

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);
        if (block.number >= deadline) return 0;

        return loanId;
    }

    /// @notice Get accumulated protocol fees for a token
    function getProtocolFees(address token) external view returns (uint256 balance) {
        return protocolFees[token];
    }

    /// @notice Check if a user can submit a new loan request
    function canSubmitRequest(address user) external view returns (bool) {
        if (_hasUnpaidDebt(user)) return false;
        if (_activeLoanByBorrower[user] != 0) return false;
        if (openRequestCount[user] >= MAX_PENDING_LOANS_PER_USER) return false;

        uint256 lastRequest = lastRequestBlock[user];
        if (lastRequest == 0) return true;

        return block.number >= lastRequest + cooldownBlocks;
    }

    /// @notice Get the block number when cooldown ends for a user
    function getCooldownEndBlock(address user) external view returns (uint256 cooldownEndBlock) {
        if (user == address(0)) return type(uint256).max;

        uint256 lastRequest = lastRequestBlock[user];
        if (lastRequest == 0) return 0;

        return lastRequest + cooldownBlocks;
    }

    /// @notice Get all loan IDs for a borrower (alias for getLoansByBorrower)
    function borrowerLoans(address borrower) external view returns (uint256[] memory) {
        return _borrowerLoans[borrower];
    }

    /// @notice Get all loan IDs in a given status (unpaginated)
    function loansByStatus(IUnlloo.LoanStatus status) external view returns (uint256[] memory) {
        return _loansByStatus[status];
    }

    /// @notice Get the interest rate curve parameters for a pool
    function getPoolRateCurve(address token) external view returns (IUnlloo.RateCurveParams memory) {
        return _poolRateCurve[token];
    }

    /// @notice Get current loan limits for a pool
    function getPoolLoanLimits(address token) external view returns (uint256 minLoanAmount, uint256 maxLoanAmount) {
        return (minLoanAmountPerPool[token], maxLoanAmountPerPool[token]);
    }

    // ============ Guarantor View Functions ============

    /// @notice Get the guarantee record between a borrower and a specific guarantor
    function getGuaranteeBond(address borrower, address guarantor) external view returns (IUnlloo.GuaranteeBond memory) {
        return guaranteeBonds[borrower][guarantor];
    }

    /// @notice Get all guarantors backing a specific borrower
    function getGuarantorsForBorrower(address borrower) external view returns (address[] memory) {
        return _guarantorsForBorrower[borrower];
    }

    /// @notice Get all borrowers backed by a specific guarantor
    function getGuaranteesByGuarantor(address guarantor) external view returns (address[] memory borrowers) {
        return _guaranteesByGuarantor[guarantor];
    }

    /// @notice Check whether a borrower has at least one active guarantor
    function isGuaranteed(address borrower) external view returns (bool) {
        return _guarantorsForBorrower[borrower].length > 0;
    }

}
