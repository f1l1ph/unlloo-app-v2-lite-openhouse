// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/// @title IUnlloo
/// @author Unlloo Protocol Team
/// @notice Canonical public interface for the Unlloo undercollateralized lending protocol
/// @dev This interface defines the complete public API for the Unlloo lending protocol.
///      Internal storage layout is intentionally NOT exposed to allow upgrade flexibility.
///
/// ## Design Principles
///
/// 1. Simple Interest Model: Interest is calculated linearly and non-compounding.
///    Formula: `interest = principal × rate × time / (BLOCKS_PER_YEAR × BPS_DENOMINATOR)`
///
/// 2. Single Borrow Per Loan: Once a loan is approved, the borrower can execute
///    `borrow()` exactly once. Partial borrows are allowed but unused amounts are forfeited.
///
/// 3. One Active Loan Per Borrower: A borrower may have at most one loan in
///    `Active` or `UnpaidDebt` status at any time.
///
/// 4. Interest on Principal Only: Interest accrues solely on the outstanding
///    principal balance, not on previously accrued interest.
///
/// 5. Protocol Fee on Interest: The protocol fee is a percentage of interest
///    paid, not principal. Fee = interestPaid × protocolFeePercentage / 100
///
/// 6. ETH for Operations Only: ETH received by the contract is for gas/operational
///    purposes. All lending/borrowing uses ERC20 tokens exclusively.
///
/// ## Token Decimals
///
/// All amounts are denominated in the underlying ERC20 token's decimals unless
/// explicitly stated otherwise. Rates are in basis points (BPS, 1 BPS = 0.01%).
///
/// @custom:security-contact security@unlloo.com
interface IUnlloo {
    // =============================================================
    //                           ENUMS
    // =============================================================

    /// @notice Lifecycle states for a loan
    /// @dev State transitions:
    ///   Pending → Approved (admin approves)
    ///   Pending → Rejected (admin rejects)
    ///   Approved → Active (borrower calls borrow())
    ///   Active → Repaid (borrower repays in full)
    ///   Active → UnpaidDebt (deadline passes without full repayment)
    ///   UnpaidDebt → Repaid (borrower repays outstanding debt)
    enum LoanStatus {
        /// @notice Loan request submitted, awaiting admin decision
        Pending,
        /// @notice Loan approved by admin, awaiting borrower to call borrow()
        Approved,
        /// @notice Funds disbursed, loan is active with accruing interest
        Active,
        /// @notice Loan past deadline with outstanding balance
        UnpaidDebt,
        /// @notice Loan request rejected by admin
        Rejected,
        /// @notice Loan fully repaid (principal + interest)
        Repaid
    }

    // =============================================================
    //                           STRUCTS
    // =============================================================

    /// @notice Canonical loan record using the simple-interest model
    /// @dev This struct contains all state for a single loan throughout its lifecycle.
    ///      Storage is optimized: addresses and status are packed where possible.
    ///      All block numbers reference the chain specified by `chainId`.
    struct Loan {
        /// @notice Unique sequential identifier (1-indexed, 0 is invalid)
        uint256 loanId;

        /// @notice Address of the borrower who requested the loan
        address borrower;

        /// @notice Current lifecycle status of the loan
        /// @dev See `LoanStatus` enum for valid transitions
        LoanStatus status;

        /// @notice Self-reported wallet reputation score (0-1000)
        /// @dev Advisory only; actual credit decisions may use external oracles
        uint16 walletReputation;

        /// @notice Loan amount in token decimals
        /// @dev Set during approval; borrower may borrow less but not more
        uint256 loanAmount;

        /// @notice Requested loan duration in blocks
        /// @dev Must be within [minLoanDurationBlocks, maxLoanDurationBlocks]
        uint256 loanDurationBlocks;

        /// @notice Chain ID where the loan was requested
        /// @dev Captured at request time for cross-chain safety
        uint256 chainId;

        /// @notice Block number when loan request was submitted
        uint256 requestBlock;

        /// @notice Block number when loan was approved (0 if not approved)
        uint256 approvalBlock;

        /// @notice ERC20 token address used for this loan
        /// @dev Must be a whitelisted token with an active liquidity pool
        address token;

        /// @notice Current outstanding principal balance in token decimals
        /// @dev Decreases as borrower makes repayments
        uint256 principal;

        /// @notice Cumulative amount repaid (principal + interest) in token decimals
        uint256 amountRepaid;

        /// @notice Block number when borrow() was executed (0 if not borrowed)
        /// @dev Interest accrual begins from this block
        uint256 startBlock;

        /// @notice Block number by which full repayment is due
        /// @dev Calculated as: startBlock + loanDurationBlocks
        uint256 deadlineBlock;

        /// @notice Cumulative protocol fees collected from this loan in token decimals
        /// @dev Fee = protocolFeePercentage × interestPaid / 100
        uint256 protocolFee;

        /// @notice Accrued but unpaid interest in token decimals
        /// @dev Updated on each accrual; simple interest formula applied
        uint256 interestAccrued;

        /// @notice Fixed annual borrow rate in basis points (1 BPS = 0.01%)
        /// @dev Locked at borrow time from the current pool utilization rate
        uint256 borrowRateBps;

        /// @notice Block number when interest was last accrued
        /// @dev Used to calculate elapsed blocks for next accrual
        uint256 lastAccrualBlock;
    }

    /// @notice Aggregate state for a token's liquidity pool
    /// @dev Each supported ERC20 token has exactly one pool
    struct LiquidityPool {
        /// @notice ERC20 token address for this pool
        address token;

        /// @notice Total liquidity deposited by lenders in token decimals
        /// @dev Includes both available and borrowed amounts
        uint256 totalLiquidity;

        /// @notice Amount currently lent out to borrowers in token decimals
        /// @dev Available liquidity = totalLiquidity - borrowedAmount
        uint256 borrowedAmount;
    }

    /// @notice Individual lender's position within a token pool
    /// @dev Tracks deposits and withdrawal timing for yield calculations
    struct LenderPosition {
        /// @notice Address of the lender
        address lender;

        /// @notice ERC20 token address of the pool
        address token;

        /// @notice Current deposited amount in token decimals
        /// @dev Tracks principal only; yield is calculated separately
        uint256 depositedAmount;

        /// @notice Block number of the initial deposit
        uint256 depositBlock;

        /// @notice Block number of the most recent withdrawal (0 if never withdrawn)
        uint256 lastWithdrawBlock;
    }

    /// @notice Interest rate curve parameters for a pool
    /// @dev Per-pool configurable rate model with protocol fee
    struct RateCurveParams {
        /// @notice Base interest rate in basis points (e.g., 200 = 2%)
        uint256 baseRateBps;

        /// @notice Optimal utilization kink point in basis points (e.g., 8000 = 80%)
        uint256 optimalUtilizationBps;

        /// @notice Interest rate slope below optimal utilization in basis points
        uint256 slope1Bps;

        /// @notice Interest rate slope above optimal utilization in basis points
        uint256 slope2Bps;

        /// @notice Protocol fee on interest in basis points (e.g., 2500 = 25%)
        uint256 protocolFeeBps;
    }

    // =============================================================
    //                           EVENTS
    // =============================================================

    // ---------------------- Loan Lifecycle Events ----------------------

    /// @notice Emitted when a borrower submits a new loan request
    /// @param loanId Unique identifier assigned to the loan (indexed for filtering)
    /// @param borrower Address of the borrower submitting the request (indexed)
    /// @param walletReputation Self-reported reputation score (0-1000)
    /// @param loanAmount Requested loan amount in token decimals
    /// @param loanDurationBlocks Requested loan duration in blocks
    /// @param blockNumber Block number when request was submitted
    event LoanRequestSubmitted(
        uint256 indexed loanId,
        address indexed borrower,
        uint16 walletReputation,
        uint256 loanAmount,
        uint256 loanDurationBlocks,
        uint256 blockNumber
    );

    /// @notice Emitted when an admin approves a pending loan request
    /// @param loanId Loan identifier being approved (indexed)
    /// @param borrower Address of the borrower whose loan was approved (indexed)
    /// @param approvalBlock Block number when approval occurred
    event LoanRequestApproved(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 approvalBlock
    );

    /// @notice Emitted when an admin rejects a pending loan request
    /// @param loanId Loan identifier being rejected (indexed)
    /// @param borrower Address of the borrower whose loan was rejected (indexed)
    /// @param rejectionBlock Block number when rejection occurred
    event LoanRequestRejected(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 rejectionBlock
    );

    /// @notice Emitted when an approved loan is executed (funds disbursed)
    /// @dev `initialOwed` equals `principal` at borrow time (no interest yet)
    /// @param loanId Loan identifier being borrowed (indexed)
    /// @param borrower Address receiving the funds (indexed)
    /// @param token ERC20 token address being borrowed
    /// @param principal Amount of tokens borrowed
    /// @param initialOwed Initial amount owed (equals principal, no interest yet)
    /// @param startBlock Block number when borrowing occurred (interest starts)
    event LoanBorrowed(
        uint256 indexed loanId,
        address indexed borrower,
        address token,
        uint256 principal,
        uint256 initialOwed,
        uint256 startBlock
    );

    /// @notice Emitted on each loan repayment (partial or full)
    /// @param loanId Loan identifier being repaid (indexed)
    /// @param payer Address that sent the repayment tokens (indexed) — may differ from borrower
    /// @param token ERC20 token address being repaid
    /// @param repaymentAmount Amount repaid in this transaction
    /// @param remainingBalance Outstanding balance after repayment (0 if fully repaid)
    /// @param blockNumber Block number when repayment occurred
    event LoanRepaid(
        uint256 indexed loanId,
        address indexed payer,
        address token,
        uint256 repaymentAmount,
        uint256 remainingBalance,
        uint256 blockNumber
    );

    /// @notice Emitted when a loan transitions to UnpaidDebt status
    /// @dev Triggered when deadline passes with outstanding balance
    /// @param loanId Loan identifier moved to unpaid debt (indexed)
    /// @param borrower Address of the delinquent borrower (indexed)
    /// @param deadlineBlock The original deadline block that was missed
    /// @param blockNumber Block number when status changed
    event LoanMovedToUnpaidDebt(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 deadlineBlock,
        uint256 blockNumber
    );

    // ---------------------- Liquidity Events ----------------------

    /// @notice Emitted when a lender deposits liquidity into a pool
    /// @param lender Address of the depositor (indexed)
    /// @param token ERC20 token being deposited (indexed)
    /// @param amount Amount deposited in token decimals
    /// @param blockNumber Block number when deposit occurred
    event LiquidityDeposited(
        address indexed lender,
        address indexed token,
        uint256 amount,
        uint256 blockNumber
    );

    /// @notice Emitted when a lender withdraws liquidity from a pool
    /// @param lender Address of the withdrawer (indexed)
    /// @param token ERC20 token being withdrawn (indexed)
    /// @param principalAmount Principal portion of withdrawal
    /// @param interestAmount Earned interest portion of withdrawal
    /// @param totalAmount Total amount withdrawn (principal + interest)
    /// @param blockNumber Block number when withdrawal occurred
    event LiquidityWithdrawn(
        address indexed lender,
        address indexed token,
        uint256 principalAmount,
        uint256 interestAmount,
        uint256 totalAmount,
        uint256 blockNumber
    );

    // ---------------------- Admin Events ----------------------

    /// @notice Emitted when admin withdraws accumulated protocol fees
    /// @param admin Address of the admin making withdrawal (indexed)
    /// @param token ERC20 token being withdrawn (indexed)
    /// @param amount Amount of fees withdrawn
    /// @param blockNumber Block number when withdrawal occurred
    event ProtocolFeesWithdrawn(
        address indexed admin,
        address indexed token,
        uint256 amount,
        uint256 blockNumber
    );

    /// @notice Emitted when pool interest rate parameters are updated
    /// @param token Pool token address (indexed)
    /// @param baseRateBps New base rate in basis points
    /// @param optimalUtilizationBps New optimal utilization kink point
    /// @param slope1Bps New slope below optimal utilization
    /// @param slope2Bps New slope above optimal utilization
    /// @param protocolFeeBps New protocol fee in basis points
    /// @param blockNumber Block number when update occurred
    event InterestRatesUpdated(
        address indexed token,
        uint256 baseRateBps,
        uint256 optimalUtilizationBps,
        uint256 slope1Bps,
        uint256 slope2Bps,
        uint256 protocolFeeBps,
        uint256 blockNumber
    );

    /// @notice Emitted when a new liquidity pool is added for a token
    /// @param token ERC20 token address for the new pool (indexed)
    /// @param blockNumber Block number when pool was added
    event PoolAdded(address indexed token, uint256 blockNumber);

    /// @notice Emitted when a liquidity pool is removed
    /// @param token ERC20 token address of the removed pool (indexed)
    /// @param blockNumber Block number when pool was removed
    event PoolRemoved(address indexed token, uint256 blockNumber);

    /// @notice Emitted when pool loan limits are updated
    /// @param token ERC20 token address of the pool (indexed)
    /// @param minLoanAmount New minimum loan amount in token decimals
    /// @param maxLoanAmount New maximum loan amount in token decimals
    /// @param blockNumber Block number when limits were updated
    event PoolLoanLimitsUpdated(
        address indexed token,
        uint256 minLoanAmount,
        uint256 maxLoanAmount,
        uint256 blockNumber
    );

    /// @notice Emitted when ETH is received by the contract
    /// @dev ETH is for operational purposes only (gas sponsorship, etc.)
    /// @param sender Address that sent ETH (indexed)
    /// @param amount Amount of ETH received in wei
    /// @param blockNumber Block number when ETH was received
    event ETHReceived(address indexed sender, uint256 amount, uint256 blockNumber);

    /// @notice Emitted when admin withdraws ETH from the contract
    /// @dev ETH is operational only; not part of lending pools
    /// @param admin Address of the admin making withdrawal (indexed)
    /// @param amount Amount of ETH withdrawn in wei
    /// @param blockNumber Block number when withdrawal occurred
    event ETHWithdrawn(address indexed admin, uint256 amount, uint256 blockNumber);

    /// @notice Emitted during emergency token recovery
    /// @dev Only callable by admin in emergency situations
    /// @param token ERC20 token being recovered (indexed)
    /// @param amount Amount recovered in token decimals
    /// @param blockNumber Block number when emergency withdrawal occurred
    event EmergencyWithdraw(address indexed token, uint256 amount, uint256 blockNumber);

    /// @notice Emitted when the extension delegate contract is updated
    /// @dev Emitted by setExtension(); used to track Ext upgrade history
    /// @param oldExtension Address of the previous UnllooExt contract (indexed)
    /// @param newExtension Address of the new UnllooExt contract (indexed)
    /// @param blockNumber Block number when the update occurred
    event ExtensionUpdated(
        address indexed oldExtension,
        address indexed newExtension,
        uint256 blockNumber
    );

    // ---------------------- Configuration Events ----------------------

    /// @notice Emitted when minimum reputation threshold is updated
    /// @param oldMinReputation Previous minimum reputation value
    /// @param newMinReputation New minimum reputation value
    /// @param blockNumber Block number when update occurred
    event MinReputationUpdated(
        uint16 oldMinReputation,
        uint16 newMinReputation,
        uint256 blockNumber
    );

    /// @notice Emitted when cooldown period between loan requests is updated
    /// @param oldCooldownBlocks Previous cooldown in blocks
    /// @param newCooldownBlocks New cooldown in blocks
    /// @param blockNumber Block number when update occurred
    event CooldownBlocksUpdated(
        uint256 oldCooldownBlocks,
        uint256 newCooldownBlocks,
        uint256 blockNumber
    );

    // =============================================================
    //                       USER ACTIONS
    // =============================================================

    /// @notice Submit a new loan request to the protocol
    /// @dev Requirements:
    ///   - Caller must not have an active or unpaid loan
    ///   - Caller must be past cooldown period from last request
    ///   - Token must have an active liquidity pool
    ///   - Amount must be within pool's [minLoanAmount, maxLoanAmount]
    ///   - Duration must be within [minLoanDurationBlocks, maxLoanDurationBlocks]
    ///   - walletReputation must be >= minReputation threshold
    /// @param walletReputation Self-reported reputation score (0-1000)
    /// @param token ERC20 token address to borrow
    /// @param loanAmount Requested loan amount in token decimals
    /// @param loanDurationBlocks Requested duration in blocks
    /// @return loanId Unique identifier assigned to the new loan request
    function submitLoanRequest(
        uint16 walletReputation,
        address token,
        uint256 loanAmount,
        uint256 loanDurationBlocks
    ) external returns (uint256 loanId);

    /// @notice Approve a pending loan request (admin only)
    /// @dev Transitions loan from Pending to Approved status.
    ///      The borrower then has approvedLoanExpiryBlocks to call borrow().
    /// @param loanId Identifier of the loan to approve
    function approveLoanRequest(uint256 loanId) external;

    /// @notice Reject a pending loan request (admin only)
    /// @dev Transitions loan from Pending to Rejected status (terminal).
    /// @param loanId Identifier of the loan to reject
    function rejectLoanRequest(uint256 loanId) external;

    /// @notice Execute borrowing on an approved loan
    /// @dev Requirements:
    ///   - Loan must be in Approved status
    ///   - Caller must be the loan's borrower
    ///   - tokenAmount must be > 0 and <= approved loanAmount
    ///   - Sufficient liquidity must be available in the pool
    ///   - Can only be called once per loan; unused approved amount is forfeited
    /// @param loanId Identifier of the approved loan
    /// @param tokenAmount Amount to borrow (may be less than approved amount)
    function borrow(uint256 loanId, uint256 tokenAmount) external;

    /// @notice Make a repayment on an active loan
    /// @dev Requirements:
    ///   - Loan must be in Active or UnpaidDebt status
    ///   - Caller must approve token transfer to contract
    ///   - Repayment is applied: interest first, then principal
    ///   - If full balance repaid, loan transitions to Repaid status
    /// @param loanId Identifier of the loan to repay
    /// @param amount Amount to repay in token decimals
    function repay(uint256 loanId, uint256 amount) external;

    /// @notice Deposit liquidity into a token pool to earn yield
    /// @dev Requirements:
    ///   - Token must have an active liquidity pool
    ///   - Caller must approve token transfer to contract
    ///   - Amount must be > 0
    /// @param token ERC20 token address to deposit
    /// @param amount Amount to deposit in token decimals
    function depositLiquidity(address token, uint256 amount) external;

    /// @notice Withdraw liquidity (principal + earned interest) from a pool
    /// @dev Requirements:
    ///   - Caller must have sufficient deposited balance
    ///   - Pool must have sufficient available liquidity (not borrowed)
    /// @param token ERC20 token address to withdraw
    /// @param amount Amount of principal to withdraw in token decimals
    function withdrawLiquidity(address token, uint256 amount) external;

    // =============================================================
    //                         VIEW FUNCTIONS
    // =============================================================

    // ---------------------- Loan Queries ----------------------

    /// @notice Retrieve complete loan data by ID
    /// @param loanId Identifier of the loan to query
    /// @return Loan struct containing all loan state
    function getLoan(uint256 loanId) external view returns (Loan memory);

    /// @notice Get the maximum approved amount for a loan
    /// @dev Returns 0 for non-approved loans or invalid IDs
    /// @param loanId Identifier of the loan to query
    /// @return Maximum amount the borrower can borrow (in token decimals)
    function getApprovedLoanAmount(uint256 loanId) external view returns (uint256);

    /// @notice Calculate current accrued interest for a loan
    /// @dev Uses simple interest: principal × rate × elapsedBlocks / (blocksPerYear × BPS)
    ///      Returns 0 for loans that haven't been borrowed yet
    /// @param loanId Identifier of the loan to query
    /// @return Accrued interest amount in token decimals
    function getAccruedInterest(uint256 loanId) external view returns (uint256);

    /// @notice Calculate total amount currently owed on a loan
    /// @dev Returns principal + accrued interest (simple interest model)
    /// @param loanId Identifier of the loan to query
    /// @return Total owed amount in token decimals
    function getTotalOwed(uint256 loanId) external view returns (uint256);

    /// @notice Get all loan IDs for a specific borrower
    /// @dev Returns loans in all statuses (historical and current)
    /// @param borrower Address of the borrower to query
    /// @return Array of loan IDs belonging to the borrower
    function getLoansByBorrower(address borrower) external view returns (uint256[] memory);

    /// @notice Get loan IDs filtered by status with pagination
    /// @dev Useful for admin dashboards and indexers
    /// @param status LoanStatus to filter by
    /// @param offset Starting index for pagination
    /// @param limit Maximum number of results to return
    /// @return Array of loan IDs matching the status
    function getLoansByStatus(
        LoanStatus status,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory);

    /// @notice Get the active or unpaid loan ID for a borrower
    /// @dev Returns 0 if the borrower has no Active or UnpaidDebt loan
    /// @param borrower Address of the borrower to query
    /// @return Loan ID if exists, 0 otherwise
    function getActiveLoanByBorrower(address borrower) external view returns (uint256);

    // ---------------------- Pool Queries ----------------------

    /// @notice Get aggregate pool state for a token
    /// @param token ERC20 token address of the pool
    /// @return LiquidityPool struct with current pool state
    function getLiquidityPool(address token) external view returns (LiquidityPool memory);

    /// @notice Get current loan limits for a pool
    /// @param token ERC20 token address of the pool
    /// @return minLoanAmount Current minimum loan amount in token decimals
    /// @return maxLoanAmount Current maximum loan amount in token decimals
    function getPoolLoanLimits(address token)
        external
        view
        returns (uint256 minLoanAmount, uint256 maxLoanAmount);

    /// @notice Get the interest rate curve parameters for a pool
    /// @param token Pool token address
    /// @return RateCurveParams struct with all rate parameters
    function getPoolRateCurve(address token) external view returns (RateCurveParams memory);

    /// @notice Calculate current borrow rate for a token pool
    /// @dev Rate is determined by pool utilization: borrowedAmount / totalLiquidity
    ///      Higher utilization = higher rates to incentivize deposits
    /// @param token ERC20 token address of the pool
    /// @return Current borrow rate in basis points (1 BPS = 0.01%)
    function calculateBorrowRate(address token) external view returns (uint256);

    /// @notice Get accumulated protocol fees for a token
    /// @dev Fees accumulate from interest payments; withdrawable by admin
    /// @param token ERC20 token address to query
    /// @return Accumulated fee amount in token decimals
    function getProtocolFees(address token) external view returns (uint256);

    /// @notice Get count of active lenders in a pool
    /// @dev A lender is "active" if their depositedAmount > 0
    /// @param token ERC20 token address of the pool
    /// @return Number of active lenders
    function getActiveLenderCount(address token) external view returns (uint256);

    // ---------------------- Lender Queries ----------------------

    /// @notice Get lender position with calculated interest
    /// @dev Returns deposited amount, accrued interest, and total withdrawable
    /// @param lender Address of the lender
    /// @param token ERC20 token address of the pool
    /// @return depositedAmount Principal deposited
    /// @return accruedInterest Interest earned so far
    /// @return totalWithdrawable Total amount available for withdrawal
    function getLenderPosition(
        address lender,
        address token
    ) external view returns (uint256 depositedAmount, uint256 accruedInterest, uint256 totalWithdrawable);

    // ---------------------- User State Queries ----------------------

    /// @notice Check if a user has any unpaid debt
    /// @dev Used to enforce one-active-loan-per-borrower rule
    /// @param user Address to check
    /// @return True if user has a loan in UnpaidDebt status
    function hasUnpaidDebt(address user) external view returns (bool);

    /// @notice Check if a user can submit a new loan request
    /// @dev Returns false if user has active loan, unpaid debt, or is in cooldown
    /// @param user Address to check
    /// @return True if user is eligible to submit a request
    function canSubmitRequest(address user) external view returns (bool);

    /// @notice Get the block number when cooldown ends for a user
    /// @dev Returns 0 if user has never made a request
    /// @param user Address to check
    /// @return Block number when cooldown expires (0 if no cooldown)
    function getCooldownEndBlock(address user) external view returns (uint256);

    // =============================================================
    //                        ADMIN ACTIONS
    // =============================================================

    /// @notice Pause all protocol operations (admin only)
    /// @dev When paused: no new loans, borrows, repayments, deposits, or withdrawals
    ///      Uses OpenZeppelin Pausable pattern
    function pause() external;

    /// @notice Resume protocol operations after pause (admin only)
    function unpause() external;

    /// @notice Withdraw ETH from contract (admin only)
    /// @dev ETH is for operational purposes only; not part of lending pools
    /// @param amount Amount of ETH to withdraw in wei
    function withdrawETH(uint256 amount) external;

    /// @notice Update minimum reputation threshold for loan requests (admin only)
    /// @dev New threshold applies to future requests only
    /// @param newMinReputation New minimum reputation value (0-1000)
    function updateMinReputation(uint16 newMinReputation) external;

    /// @notice Update cooldown period between loan requests (admin only)
    /// @param newCooldownBlocks New cooldown duration in blocks
    function updateCooldownBlocks(uint256 newCooldownBlocks) external;

    /// @notice Add a new liquidity pool for a token (admin only)
    /// @dev Requirements:
    ///   - Token must be a valid ERC20 contract
    ///   - Pool must not already exist for this token
    ///   - minLoanAmount must be <= maxLoanAmount
    /// @param token ERC20 token address for the new pool
    /// @param minLoanAmount Minimum loan amount in token decimals
    /// @param maxLoanAmount Maximum loan amount in token decimals
    function addLiquidityPool(
        address token,
        uint256 minLoanAmount,
        uint256 maxLoanAmount
    ) external;

    /// @notice Remove a liquidity pool (admin only)
    /// @dev Requirements:
    ///   - Pool must exist
    ///   - Pool should ideally have no active loans (check before calling)
    /// @param token ERC20 token address of the pool to remove
    function removeLiquidityPool(address token) external;

    /// @notice Update loan amount limits for a pool (admin only)
    /// @dev New limits apply to future loan requests only
    /// @param token ERC20 token address of the pool
    /// @param minLoanAmount New minimum loan amount in token decimals
    /// @param maxLoanAmount New maximum loan amount in token decimals
    function updatePoolLoanLimits(
        address token,
        uint256 minLoanAmount,
        uint256 maxLoanAmount
    ) external;

    /// @notice Update interest rate curve parameters for a specific pool (admin only)
    /// @dev New rates apply to future loans only; existing loans keep their locked rate
    /// @param token Pool token address
    /// @param baseRateBps Base rate in basis points (e.g., 200 = 2%)
    /// @param optimalUtilizationBps Optimal utilization kink point (e.g., 8000 = 80%)
    /// @param slope1Bps Slope below optimal utilization (e.g., 600 = 6%)
    /// @param slope2Bps Slope above optimal utilization (e.g., 4000 = 40%)
    /// @param protocolFeeBps Protocol fee on interest (e.g., 2500 = 25%)
    function updatePoolRateCurve(
        address token,
        uint256 baseRateBps,
        uint256 optimalUtilizationBps,
        uint256 slope1Bps,
        uint256 slope2Bps,
        uint256 protocolFeeBps
    ) external;

    /// @notice Withdraw accumulated protocol fees (admin only)
    /// @dev Fees are collected from interest payments on repaid loans
    /// @param token ERC20 token address to withdraw fees from
    /// @param amount Amount of fees to withdraw in token decimals
    function withdrawProtocolFees(address token, uint256 amount) external;

    /// @notice Update the address of the UnllooExt extension contract (admin only)
    /// @dev Updates extensionDelegate and emits ExtensionUpdated.
    ///      In production this should be protected by a timelock.
    /// @param newExtension Address of the new UnllooExt deployment
    function setExtension(address newExtension) external;

    // =============================================================
    //                    CONFIG GETTERS (Safe to expose)
    // =============================================================

    /// @notice Get the current loan counter (next loan ID will be this + 1)
    /// @return Current total number of loans created
    function loanCounter() external view returns (uint256);

    /// @notice Get current minimum reputation threshold
    /// @return Minimum reputation score required for loan requests (0-1000)
    function minReputation() external view returns (uint16);

    /// @notice Get current cooldown period between loan requests
    /// @return Cooldown duration in blocks
    function cooldownBlocks() external view returns (uint256);

    /// @notice Get the default token address used for new pools
    /// @return Default token address
    function defaultToken() external view returns (address);

    // =============================================================
    //                   CONSTANT / CONFIG GETTERS
    // =============================================================

    /// @notice Get configured block time for the chain
    /// @dev Used for interest calculations: blocksPerYear = 365.25 days / blockTimeSeconds
    /// @return Block time in seconds (e.g., 12 for Ethereum mainnet)
    function blockTimeSeconds() external view returns (uint256);

    /// @notice Get minimum allowed loan duration
    /// @dev Loan requests with shorter durations will revert
    /// @return Minimum duration in blocks
    function minLoanDurationBlocks() external view returns (uint256);

    /// @notice Get maximum allowed loan duration
    /// @dev Loan requests with longer durations will revert
    /// @return Maximum duration in blocks
    function maxLoanDurationBlocks() external view returns (uint256);

    /// @notice Get maximum blocks for interest calculation
    /// @dev Prevents runaway interest accrual on abandoned loans
    /// @return Maximum blocks to use in interest calculation
    function MAX_BLOCKS_FOR_INTEREST() external view returns (uint256);

    /// @notice Get maximum pending loan requests per user
    /// @dev Prevents spam; user must wait for resolution before new requests
    /// @return Maximum number of concurrent pending loans
    function MAX_PENDING_LOANS_PER_USER() external view returns (uint256);

    /// @notice Get expiry period for approved loans
    /// @dev Approved loans must be borrowed within this period or expire
    /// @return Expiry duration in blocks after approval
    function approvedLoanExpiryBlocks() external view returns (uint256);

    // =============================================================
    //                INTEREST RATE CONSTANTS
    // =============================================================

    /// @notice Maximum borrower rate in basis points (50% = 5000)
    /// @return Maximum annual borrow rate in basis points
    function MAX_BORROWER_RATE() external view returns (uint256);

    /// @notice Minimum borrower rate in basis points (5% = 500)
    /// @return Minimum annual borrow rate in basis points
    function MIN_BORROWER_RATE() external view returns (uint256);

    // =============================================================
    //                     GUARANTOR TYPES
    // =============================================================

    /// @notice Tracks a guarantor's commitment to back a borrower
    /// @dev No collateral is locked — guarantor pays from their own wallet when needed
    struct GuaranteeBond {
        address guarantor;
        address borrower;
        bool active;
    }

    // ---------------------- Guarantor Events ----------------------

    event GuaranteeRegistered(
        address indexed guarantor,
        address indexed borrower,
        uint256 blockNumber
    );

    event GuaranteeRemoved(
        address indexed guarantor,
        address indexed borrower,
        uint256 blockNumber
    );

    event GuarantorPaidOnBehalf(
        uint256 indexed loanId,
        address indexed guarantor,
        address indexed borrower,
        uint256 amountPaid,
        uint256 blockNumber
    );

    // =============================================================
    //                     GUARANTOR FUNCTIONS
    // =============================================================

    /// @notice Register as a guarantor for a borrower (no collateral required)
    function registerGuarantee(address borrower) external;

    /// @notice Remove guarantee (only if borrower has no active/unpaid loan)
    function removeGuarantee(address borrower) external;

    /// @notice Guarantor pays on behalf of a borrower — tokens pulled from guarantor's wallet
    function payOnBehalf(uint256 loanId, uint256 amount) external;

    function getGuaranteeBond(address borrower, address guarantor) external view returns (GuaranteeBond memory);
    function getGuarantorsForBorrower(address borrower) external view returns (address[] memory);
    function getGuaranteesByGuarantor(address guarantor) external view returns (address[] memory borrowers);
    function isGuaranteed(address borrower) external view returns (bool);
}
