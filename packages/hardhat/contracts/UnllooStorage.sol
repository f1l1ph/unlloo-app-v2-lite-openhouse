// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "./utils/ReentrancyGuardUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IUnlloo.sol";
import "./errors/UnllooErrors.sol";

/**
 * @title UnllooStorage
 * @notice Abstract base contract declaring all state variables and constants shared by
 *         UnllooCore and UnllooExt. Both contracts inherit only this contract, which
 *         guarantees their storage layouts are identical — a strict requirement for the
 *         delegatecall-based extension pattern.
 * @dev Rules:
 *      - Never declare state variables directly in UnllooCore or UnllooExt.
 *      - All new state goes here, appended before __gap, with __gap decremented.
 *      - Inheritance order must never change: Initializable, OwnableUpgradeable,
 *        ReentrancyGuardUpgradeable, PausableUpgradeable.
 *      - The three shared internal functions (_hasUnpaidDebt, _interestDue,
 *        _calculateBorrowRate) live here so both Core and Ext can call them
 *        without logic duplication.
 */
abstract contract UnllooStorage is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;
    // ============ Constants ============
    uint256 public constant MAX_BLOCKS_FOR_INTEREST = 40_000_000;
    uint256 public constant MAX_PENDING_LOANS_PER_USER = 1;

    uint256 public constant MAX_BORROWER_RATE = 5000; // 50% rate cap
    uint256 public constant MIN_BORROWER_RATE = 900; // 5% rate floor

    // Default rate curve parameters (used when adding new pools)
    uint256 internal constant DEFAULT_BASE_RATE_BPS = 1200; // 12% base rate
    uint256 internal constant DEFAULT_OPTIMAL_UTILIZATION_BPS = 8000; // 80% optimal utilization
    uint256 internal constant DEFAULT_SLOPE1_BPS = 600; // 6% slope before optimal
    uint256 internal constant DEFAULT_SLOPE2_BPS = 4000; // 40% slope after optimal
    uint256 internal constant DEFAULT_PROTOCOL_FEE_BPS = 2500; // 25% protocol fee

    uint256 internal constant INDEX_SCALE = 1e18; // For supply index calculations
    uint256 internal constant SECONDS_PER_DAY = 24 * 60 * 60;
    uint256 internal constant SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;
    uint256 internal constant MAX_INTEREST_ACCRUAL_YEARS = 5; // Cap interest accrual to 5 years after deadline

    // ============ State Variables ============
    // NOTE: Order must never change — any addition goes at the end before __gap.
    uint256 public loanCounter;
    mapping(uint256 => IUnlloo.Loan) public loans;
    mapping(address => uint256[]) internal _borrowerLoans;

    mapping(IUnlloo.LoanStatus => uint256[]) internal _loansByStatus;
    mapping(IUnlloo.LoanStatus => mapping(uint256 => uint256)) internal _loanStatusIndex;

    mapping(address => IUnlloo.LiquidityPool) public pools;
    mapping(address => mapping(address => IUnlloo.LenderPosition)) public lenderPositions;
    mapping(address => uint256) public lastRequestBlock;
    mapping(address => uint256) public protocolFees;

    mapping(address => uint256) public activeLenderCount;

    mapping(address => uint256) public minLoanAmountPerPool;
    mapping(address => uint256) public maxLoanAmountPerPool;

    uint16 public minReputation;
    uint256 public cooldownBlocks;

    uint256 public blockTimeSeconds;
    uint256 public minLoanDurationBlocks;
    uint256 public maxLoanDurationBlocks;
    uint256 public approvedLoanExpiryBlocks;

    address public defaultToken;

    // ============ Simple Interest State ============
    mapping(uint256 => uint256) public loanInitialPrincipal;

    /// @notice One active loan per borrower; 0 if none
    mapping(address => uint256) internal _activeLoanByBorrower;

    /// @notice Number of loans in UnpaidDebt status per borrower
    mapping(address => uint256) public unpaidDebtLoanCount;
    /// @notice Number of open requests (Pending or Approved) per borrower
    mapping(address => uint256) public openRequestCount;

    // ============ Lender Yield (Supply Index) ============
    mapping(address => uint256) public poolSupplyIndex; // token => index (1e18)
    mapping(address => uint256) public poolUndistributedInterest; // rounding dust bucket
    mapping(address => mapping(address => uint256)) public lenderSupplyIndex; // lender => token => index snapshot
    mapping(address => mapping(address => uint256)) public lenderAccruedInterest; // lender => token => accrued

    // ============ Per-pool active loan counters (avoid O(n) scans) ============
    mapping(address => uint256) public activeLoansPerPool;
    mapping(address => uint256) public unpaidDebtLoansPerPool;

    // ============ Per-pool Interest Rate Parameters ============
    mapping(address => IUnlloo.RateCurveParams) internal _poolRateCurve;

    /// @notice Address of the currently active UnllooExt contract.
    ///         Core's fallback delegates all unrecognized calls to this address.
    address public extensionDelegate;

    // ============ Guarantor Bond State ============
    /// @dev guarantor => borrowers[] — list of borrowers this guarantor backs
    mapping(address => address[]) internal _guaranteesByGuarantor;
    /// @dev guarantor => borrower => index in _guaranteesByGuarantor[guarantor]
    mapping(address => mapping(address => uint256)) internal _guaranteeIndex;
    /// @dev borrower => guarantors[] — list of guarantors backing this borrower
    mapping(address => address[]) internal _guarantorsForBorrower;
    /// @dev borrower => guarantor => index in _guarantorsForBorrower[borrower]
    mapping(address => mapping(address => uint256)) internal _guarantorIndex;
    /// @dev borrower => guarantor => bond details
    mapping(address => mapping(address => IUnlloo.GuaranteeBond)) public guaranteeBonds;
    /// @notice Blocks after loan deadline before admin can seize a guarantor bond
    uint256 public guarantorGracePeriodBlocks;

    /// @dev Storage gap reduced from 35 to 28:
    ///      -1 for extensionDelegate, -6 for guarantor state variables.
    ///      Decrement this count by 1 for each new state variable added above.
    uint256[28] private __gap;

    // ============ Shared Internal Helpers ============
    // These are placed in UnllooStorage so both Core and Ext can call them directly
    // without duplication. Neither contract can call the other's internal functions
    // across the delegatecall boundary.

    /**
     * @notice Check whether a user has any outstanding unpaid debt.
     * @dev Checks storage counter first, then performs virtual projection for active loans
     *      that have passed their deadline but haven't been transitioned in storage yet.
     * @param user Address to check
     * @return True if the user has a loan in UnpaidDebt status (or is virtually overdue)
     */
    function _hasUnpaidDebt(address user) internal view returns (bool) {
        if (unpaidDebtLoanCount[user] != 0) return true;

        uint256 activeId = _activeLoanByBorrower[user];
        // Sentinel check: no active loan ID set
        if (activeId == 0) return false;

        IUnlloo.Loan memory loan = loans[activeId];
        if (loan.status == IUnlloo.LoanStatus.UnpaidDebt) return true;
        if (loan.status != IUnlloo.LoanStatus.Active) return false;
        // Sentinel check: loan not yet started (startBlock == 0) or invalid duration
        if (loan.startBlock == 0 || loan.loanDurationBlocks == 0) return false;

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);
        return block.number >= deadline;
    }

    /**
     * @notice Calculate current accrued interest for a loan (view, no state mutation).
     * @dev Delegates to the internal _getAccruedInterest implementation. Placed here so
     *      both Core (repay internals) and Ext (getAccruedInterest, getTotalOwed) can call
     *      the same logic without duplication.
     * @param loanId Loan ID to calculate interest for
     * @return Accrued interest amount in token decimals
     */
    function _interestDue(uint256 loanId) internal view returns (uint256) {
        IUnlloo.Loan memory loan = loans[loanId];
        // Sentinel checks: loan has no principal, rate, or not started
        if (loan.principal == 0 || loan.borrowRateBps == 0 || loan.lastAccrualBlock == 0) {
            return loan.interestAccrued;
        }

        uint256 blocksElapsed = _calculateCappedBlocksElapsed(
            loan.lastAccrualBlock,
            loan.startBlock,
            loan.deadlineBlock,
            loan.loanDurationBlocks
        );
        if (blocksElapsed == 0) return loan.interestAccrued;

        // Simple interest: I = P * rateBps * blocksElapsed * blockTimeSeconds / (10000 * SECONDS_PER_YEAR)
        uint256 newInterest = (loan.principal * loan.borrowRateBps * blocksElapsed * blockTimeSeconds) /
            (10000 * SECONDS_PER_YEAR);
        return loan.interestAccrued + newInterest;
    }

    /**
     * @notice Calculate utilization-based borrow rate for a pool.
     * @dev Piecewise linear model using per-pool rate curve parameters.
     *      Used by Core (borrow) and Ext (calculateBorrowRate view).
     * @param token Token address of the pool
     * @return rateBps Borrow rate in basis points
     */
    function _calculateBorrowRate(address token) internal view returns (uint256 rateBps) {
        IUnlloo.LiquidityPool memory pool = pools[token];
        if (pool.totalLiquidity == 0) return MIN_BORROWER_RATE;

        IUnlloo.RateCurveParams memory curve = _poolRateCurve[token];

        // Calculate utilization: U = borrowedAmount * 10000 / totalLiquidity
        uint256 utilization = (pool.borrowedAmount * 10000) / pool.totalLiquidity;

        // Piecewise linear model (multiply first, divide last to avoid precision loss)
        if (utilization <= curve.optimalUtilizationBps) {
            // Below optimal: baseRate + (borrowedAmount * 10000 * slope1) / (totalLiquidity * optimalUtil)
            uint256 slopeContribution = (pool.borrowedAmount * 10000 * curve.slope1Bps) /
                (pool.totalLiquidity * curve.optimalUtilizationBps);
            rateBps = curve.baseRateBps + slopeContribution;
        } else {
            // Above optimal: baseRate + slope1 + ((U - optimalUtil) * slope2) / (10000 - optimalUtil)
            uint256 excessUtil = utilization - curve.optimalUtilizationBps;
            uint256 remainingUtil = 10000 - curve.optimalUtilizationBps;
            uint256 excessContribution = (excessUtil * curve.slope2Bps) / remainingUtil;
            rateBps = curve.baseRateBps + curve.slope1Bps + excessContribution;
        }

        // Clamp to min/max bounds
        if (rateBps < MIN_BORROWER_RATE) rateBps = MIN_BORROWER_RATE;
        if (rateBps > MAX_BORROWER_RATE) rateBps = MAX_BORROWER_RATE;

        return rateBps;
    }

    // ============ Shared Validation Helpers ============

    /**
     * @notice Revert if the given loan ID does not correspond to an existing loan.
     * @param loanId Loan ID to validate
     */
    function _requireLoanExists(uint256 loanId) internal view {
        if (loans[loanId].borrower == address(0)) revert UnllooErrors.LoanNotFound(loanId);
    }

    /**
     * @notice Revert if the given token address is zero or has no active pool.
     * @param token Token address to validate
     */
    function _requireValidPool(address token) internal view {
        if (token == address(0) || pools[token].token == address(0)) revert UnllooErrors.InvalidPool(token);
    }

    // ============ Shared Transfer / Validation Helpers ============
    // These are duplicated in neither Core nor Ext — declared once here so both inherit them.

    function _validateTokenDecimals(address token) internal view {
        try IERC20Metadata(token).decimals() returns (uint8 decimals) {
            if (decimals < 6 || decimals > 18) revert UnllooErrors.InvalidPool(token);
        } catch {
            revert UnllooErrors.InvalidPool(token);
        }
    }

    function _validateNonZeroAddress(address addr) internal pure {
        if (addr == address(0)) revert UnllooErrors.InvalidPool(address(0));
    }

    function _validateNonZeroAmount(uint256 amount, uint256 maxAmount) internal pure {
        if (amount == 0 || amount > maxAmount) revert UnllooErrors.InvalidAmount(amount, 1, maxAmount);
    }

    function _safeTransferExact(address token, address to, uint256 amount) internal {
        uint256 beforeFrom = IERC20(token).balanceOf(address(this));
        uint256 beforeTo = IERC20(token).balanceOf(to);
        IERC20(token).safeTransfer(to, amount);
        uint256 afterFrom = IERC20(token).balanceOf(address(this));
        uint256 afterTo = IERC20(token).balanceOf(to);
        if (beforeFrom - afterFrom != amount) revert UnllooErrors.UnsupportedTokenTransfer(token);
        if (afterTo - beforeTo != amount) revert UnllooErrors.UnsupportedTokenTransfer(token);
    }

    // ============ Internal: Capped Blocks (shared by _interestDue and _accrueLoanInterest) ============

    /**
     * @dev Capped blocks calculation used by both _interestDue (Storage) and
     *      _accrueLoanInterest (Core). Applies two caps to prevent unbounded interest accrual:
     *      1. 5-year cap after loan deadline (for overdue loans)
     *      2. Absolute MAX_BLOCKS_FOR_INTEREST cap (for abandoned loans)
     */
    function _calculateCappedBlocksElapsed(
        uint256 lastAccrualBlock,
        uint256 startBlock,
        uint256 deadlineBlock,
        uint256 loanDurationBlocks
    ) internal view returns (uint256 blocksElapsed) {
        blocksElapsed = block.number - lastAccrualBlock;
        if (blocksElapsed == 0) return 0;

        // Calculate deadline for interest accrual cap
        uint256 deadline = deadlineBlock != 0 ? deadlineBlock : (startBlock + loanDurationBlocks);

        // Cap interest accrual to 5 years after deadline (for non-repaid loans)
        if (deadline > 0 && startBlock > 0) {
            uint256 maxInterestAccrualBlocks = (MAX_INTEREST_ACCRUAL_YEARS * SECONDS_PER_YEAR) / blockTimeSeconds;
            uint256 maxInterestBlock = deadline + maxInterestAccrualBlocks;

            if (block.number > maxInterestBlock) {
                uint256 maxAllowedBlocks = maxInterestBlock > lastAccrualBlock
                    ? maxInterestBlock - lastAccrualBlock
                    : 0;
                if (blocksElapsed > maxAllowedBlocks) {
                    blocksElapsed = maxAllowedBlocks;
                }
            }
        }

        // Absolute cap: prevent unbounded interest accrual on abandoned loans
        if (blocksElapsed > MAX_BLOCKS_FOR_INTEREST) {
            blocksElapsed = MAX_BLOCKS_FOR_INTEREST;
        }
    }
}
