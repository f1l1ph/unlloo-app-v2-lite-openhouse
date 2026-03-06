// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "./utils/ReentrancyGuardUpgradeable.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IUnlloo.sol";
import "./libraries/UnllooStatusArray.sol";
import "./errors/UnllooErrors.sol";

/**
 * @title Unlloo
 * @notice Decentralized lending protocol with reputation-based loan requests
 * @dev Upgradeable contract using proxy pattern
 *
 * Production changes:
 * - Fixes critical repay accounting bug (no double-subtraction of repaid amounts)
 * - Adds fair lender yield distribution via supply index (interest paid only)
 * - Protocol fees are segregated; do not block LP principal withdrawals
 * - Interest continues accruing after due date
 * - Owner-only expiry for Approved requests
 * - Optional public "mark overdue" for correct status transitions
 * - Strict ERC20 transfers (reverts on fee-on-transfer style behavior)
 */
contract Unlloo is
    IUnlloo,
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;
    using UnllooStatusArray for uint256[];

    // ============ Constants ============
    uint256 public constant MAX_BLOCKS_FOR_INTEREST = 40_000_000;
    uint256 public constant MAX_PENDING_LOANS_PER_USER = 1;

    uint256 public constant MAX_BORROWER_RATE = 5000; // 50% rate cap
    uint256 public constant MIN_BORROWER_RATE = 900;  // 5% rate floor

    // Default rate curve parameters (used when adding new pools)
    uint256 private constant DEFAULT_BASE_RATE_BPS = 1200;              // 12% base rate
    uint256 private constant DEFAULT_OPTIMAL_UTILIZATION_BPS = 8000;   // 80% optimal utilization
    uint256 private constant DEFAULT_SLOPE1_BPS = 600;                 // 6% slope before optimal
    uint256 private constant DEFAULT_SLOPE2_BPS = 4000;                // 40% slope after optimal
    uint256 private constant DEFAULT_PROTOCOL_FEE_BPS = 2500;          // 25% protocol fee

    uint256 private constant INDEX_SCALE = 1e18; // For supply index calculations
    uint256 private constant SECONDS_PER_DAY = 24 * 60 * 60;
    uint256 private constant SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;
    uint256 private constant MAX_INTEREST_ACCRUAL_YEARS = 5; // Cap interest accrual to 5 years after deadline

    // ============ State Variables ============
    uint256 public loanCounter;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) private _borrowerLoans;

    mapping(LoanStatus => uint256[]) private _loansByStatus;
    mapping(LoanStatus => mapping(uint256 => uint256)) private _loanStatusIndex;

    mapping(address => LiquidityPool) public pools;
    mapping(address => mapping(address => LenderPosition)) public lenderPositions;
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
    mapping(address => uint256) private _activeLoanByBorrower;

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
    mapping(address => RateCurveParams) private _poolRateCurve;

    uint256[35] private __gap;

    // ============ Constructor ============
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Modifiers ============
    modifier loanExists(uint256 loanId) {
        if (loans[loanId].borrower == address(0)) revert UnllooErrors.LoanNotFound(loanId);
        _;
    }

    modifier onlyBorrower(uint256 loanId) {
        if (msg.sender != loans[loanId].borrower) revert UnllooErrors.NotBorrower(msg.sender, loans[loanId].borrower);
        _;
    }

    modifier validPool(address token) {
        if (token == address(0) || pools[token].token == address(0)) revert UnllooErrors.InvalidPool(token);
        _;
    }

    // ============ Initializer ============
    function initialize(
        address _defaultToken,
        uint256 blockTimeSecondsValue,
        address initialOwner,
        uint256 _defaultMinLoanAmount,
        uint256 _defaultMaxLoanAmount
    ) public initializer {
        if (initialOwner == address(0)) revert UnllooErrors.InvalidOwner(initialOwner);
        if (_defaultToken == address(0)) revert UnllooErrors.InvalidDefaultToken(address(0));
        if (blockTimeSecondsValue == 0 || blockTimeSecondsValue > 86400) revert UnllooErrors.InvalidBlockTime(blockTimeSecondsValue);

        if (_defaultMinLoanAmount == 0 || _defaultMaxLoanAmount == 0) {
            revert UnllooErrors.InvalidPoolLoanLimits(_defaultMinLoanAmount, _defaultMaxLoanAmount);
        }
        if (_defaultMinLoanAmount >= _defaultMaxLoanAmount) {
            revert UnllooErrors.InvalidPoolLoanLimits(_defaultMinLoanAmount, _defaultMaxLoanAmount);
        }

        __Ownable_init(initialOwner);
        __Pausable_init();
        __ReentrancyGuard_init();

        defaultToken = _defaultToken;
        blockTimeSeconds = blockTimeSecondsValue;

        _validateTokenDecimals(_defaultToken);

        pools[_defaultToken] = LiquidityPool({ token: _defaultToken, totalLiquidity: 0, borrowedAmount: 0 });
        minLoanAmountPerPool[_defaultToken] = _defaultMinLoanAmount;
        maxLoanAmountPerPool[_defaultToken] = _defaultMaxLoanAmount;

        // supply index starts at 1e18
        poolSupplyIndex[_defaultToken] = 1e18;

        // Set default rate curve for default pool
        _poolRateCurve[_defaultToken] = RateCurveParams({
            baseRateBps: DEFAULT_BASE_RATE_BPS,
            optimalUtilizationBps: DEFAULT_OPTIMAL_UTILIZATION_BPS,
            slope1Bps: DEFAULT_SLOPE1_BPS,
            slope2Bps: DEFAULT_SLOPE2_BPS,
            protocolFeeBps: DEFAULT_PROTOCOL_FEE_BPS
        });

        minReputation = 200;

        // Calculate blocks per day (multiply first, divide last to avoid precision loss)
        uint256 blocksPerDay = SECONDS_PER_DAY / blockTimeSeconds;
        if (blocksPerDay == 0) revert UnllooErrors.InvalidBlockTime(blockTimeSeconds);
        
        // Calculate duration constants (multiply first, divide last)
        minLoanDurationBlocks = blocksPerDay;
        maxLoanDurationBlocks = (SECONDS_PER_DAY * 60) / blockTimeSeconds; // 60 days
        approvedLoanExpiryBlocks = (SECONDS_PER_DAY * 30) / blockTimeSeconds; // 30 days
        cooldownBlocks = blocksPerDay;
    }

    // ============ Loan Request Functions ============
    /// @inheritdoc IUnlloo
    function submitLoanRequest(
        uint16 walletReputation,
        address token,
        uint256 loanAmount,
        uint256 loanDurationBlocks
    ) external whenNotPaused returns (uint256 loanId) {
        if (walletReputation < minReputation || walletReputation > 1000) {
            revert UnllooErrors.InvalidReputation(walletReputation, minReputation);
        }
        if (token == address(0) || pools[token].token == address(0)) revert UnllooErrors.InvalidPool(token);

        (uint256 minLoanAmountToken, uint256 maxLoanAmountToken) = _getLoanLimits(token);

        if (loanAmount < minLoanAmountToken || loanAmount > maxLoanAmountToken) {
            revert UnllooErrors.InvalidAmount(loanAmount, minLoanAmountToken, maxLoanAmountToken);
        }
        if (loanDurationBlocks < minLoanDurationBlocks || loanDurationBlocks > maxLoanDurationBlocks) {
            revert UnllooErrors.InvalidDuration(loanDurationBlocks, minLoanDurationBlocks, maxLoanDurationBlocks);
        }
        if (hasUnpaidDebt(msg.sender)) revert UnllooErrors.HasUnpaidDebt(msg.sender);
        if (openRequestCount[msg.sender] >= MAX_PENDING_LOANS_PER_USER) revert UnllooErrors.ExceedsMaxPendingLoans(msg.sender);
        if (_activeLoanByBorrower[msg.sender] != 0) revert UnllooErrors.HasActiveLoan(msg.sender);

        if (lastRequestBlock[msg.sender] > 0) {
            uint256 cooldownEnd = lastRequestBlock[msg.sender] + cooldownBlocks;
            if (block.number < cooldownEnd) revert UnllooErrors.CooldownNotExpired(msg.sender, cooldownEnd);
        }

        loanId = ++loanCounter;

        loans[loanId] = Loan({
            loanId: loanId,
            borrower: msg.sender,
            status: LoanStatus.Pending,
            walletReputation: walletReputation,
            loanAmount: loanAmount,
            loanDurationBlocks: loanDurationBlocks,
            chainId: block.chainid,
            requestBlock: block.number,
            approvalBlock: 0,
            token: token,
            principal: 0,
            amountRepaid: 0, // informational only; not used for debt math
            startBlock: 0,
            deadlineBlock: 0,
            protocolFee: 0,
            interestAccrued: 0,
            borrowRateBps: 0,
            lastAccrualBlock: 0
        });

        _borrowerLoans[msg.sender].push(loanId);
        _loansByStatus[LoanStatus.Pending].add(_loanStatusIndex[LoanStatus.Pending], loanId, LoanStatus.Pending);

        openRequestCount[msg.sender] += 1;
        lastRequestBlock[msg.sender] = block.number;

        emit LoanRequestSubmitted(loanId, msg.sender, walletReputation, loanAmount, loanDurationBlocks, block.number);
    }

    /// @inheritdoc IUnlloo
    function approveLoanRequest(uint256 loanId)
        external
        onlyOwner
        loanExists(loanId)
    {
        Loan storage loan = loans[loanId];

        if (loan.status != LoanStatus.Pending) revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Pending));
        if (hasUnpaidDebt(loan.borrower)) revert UnllooErrors.HasUnpaidDebt(loan.borrower);
        if (_activeLoanByBorrower[loan.borrower] != 0) revert UnllooErrors.HasActiveLoan(loan.borrower);

        loan.status = LoanStatus.Approved;
        loan.approvalBlock = block.number;

        _loansByStatus[LoanStatus.Pending].remove(_loanStatusIndex[LoanStatus.Pending], loanId, LoanStatus.Pending);
        _loansByStatus[LoanStatus.Approved].add(_loanStatusIndex[LoanStatus.Approved], loanId, LoanStatus.Approved);

        emit LoanRequestApproved(loanId, loan.borrower, block.number);
    }

    /// @inheritdoc IUnlloo
    function rejectLoanRequest(uint256 loanId)
        external
        onlyOwner
        loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Pending) revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Pending));

        loan.status = LoanStatus.Rejected;

        _loansByStatus[LoanStatus.Pending].remove(_loanStatusIndex[LoanStatus.Pending], loanId, LoanStatus.Pending);
        _loansByStatus[LoanStatus.Rejected].add(_loanStatusIndex[LoanStatus.Rejected], loanId, LoanStatus.Rejected);

        if (openRequestCount[loan.borrower] > 0) openRequestCount[loan.borrower] -= 1;

        emit LoanRequestRejected(loanId, loan.borrower, block.number);
    }

    /**
     * @notice Owner-only expiry for Approved requests (prevents permanent openRequestCount lock)
     */
    function expireApprovedLoan(uint256 loanId)
        external
        onlyOwner
        loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Approved) revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Approved));

        uint256 expiryBlock = loan.approvalBlock + approvedLoanExpiryBlocks;
        if (block.number <= expiryBlock) {
            revert UnllooErrors.ApprovedLoanNotExpired(loanId, block.number, expiryBlock);
        }

        loan.status = LoanStatus.Rejected;

        _loansByStatus[LoanStatus.Approved].remove(_loanStatusIndex[LoanStatus.Approved], loanId, LoanStatus.Approved);
        _loansByStatus[LoanStatus.Rejected].add(_loanStatusIndex[LoanStatus.Rejected], loanId, LoanStatus.Rejected);

        if (openRequestCount[loan.borrower] > 0) openRequestCount[loan.borrower] -= 1;

        emit LoanRequestRejected(loanId, loan.borrower, block.number);
    }

    // ============ Borrowing Functions ============
    /// @inheritdoc IUnlloo
    function borrow(
        uint256 loanId,
        uint256 tokenAmount
    ) external whenNotPaused nonReentrant loanExists(loanId) onlyBorrower(loanId) {
        Loan storage loan = loans[loanId];

        if (loan.status != LoanStatus.Approved) revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Approved));
        if (tokenAmount == 0) revert UnllooErrors.InvalidAmount(tokenAmount, 1, type(uint256).max);

        uint256 expiryBlock = loan.approvalBlock + approvedLoanExpiryBlocks;
        if (block.number > expiryBlock) revert UnllooErrors.ApprovedLoanExpired(loanId, loan.approvalBlock, expiryBlock);

        if (_activeLoanByBorrower[msg.sender] != 0) revert UnllooErrors.HasActiveLoan(msg.sender);

        address token = loan.token;
        if (token == address(0) || pools[token].token == address(0)) revert UnllooErrors.InvalidPool(token);

        uint256 maxTokenAmount = getApprovedLoanAmount(loanId);
        if (tokenAmount > maxTokenAmount) revert UnllooErrors.InvalidAmount(tokenAmount, 1, maxTokenAmount);

        LiquidityPool storage pool = pools[token];

        if (pool.borrowedAmount > pool.totalLiquidity) revert UnllooErrors.InsufficientLiquidity(tokenAmount, 0);
        uint256 freeLiquidity = pool.totalLiquidity - pool.borrowedAmount;
        if (tokenAmount > freeLiquidity) revert UnllooErrors.InsufficientLiquidity(tokenAmount, freeLiquidity);

        if (loan.loanDurationBlocks > MAX_BLOCKS_FOR_INTEREST) {
            revert UnllooErrors.InvalidDuration(loan.loanDurationBlocks, 1, MAX_BLOCKS_FOR_INTEREST);
        }

        // Calculate fixed borrow rate based on current utilization
        uint256 borrowRateBps = _calculateBorrowRate(token);

        loanInitialPrincipal[loanId] = tokenAmount;

        loan.status = LoanStatus.Active;
        loan.principal = tokenAmount;
        loan.amountRepaid = 0;
        loan.startBlock = block.number;
        loan.deadlineBlock = block.number + loan.loanDurationBlocks;
        loan.protocolFee = 0;
        loan.interestAccrued = 0;
        loan.borrowRateBps = borrowRateBps; // Fixed rate for loan lifetime
        loan.lastAccrualBlock = block.number; // Initialize accrual tracking

        _loansByStatus[LoanStatus.Approved].remove(_loanStatusIndex[LoanStatus.Approved], loanId, LoanStatus.Approved);
        _loansByStatus[LoanStatus.Active].add(_loanStatusIndex[LoanStatus.Active], loanId, LoanStatus.Active);

        _activeLoanByBorrower[loan.borrower] = loanId;

        if (openRequestCount[loan.borrower] > 0) openRequestCount[loan.borrower] -= 1;

        pool.borrowedAmount += tokenAmount;
        activeLoansPerPool[token] += 1;

        _safeTransferExact(token, msg.sender, tokenAmount);

        // Calculate expected interest using simple interest for event
        // Formula: I = P * r * t where t = blocksElapsed / blocksPerYear
        // Multiply first, divide last to avoid precision loss:
        // expectedInterest = (tokenAmount * borrowRateBps * loanDurationBlocks * blockTimeSeconds) / (10000 * SECONDS_PER_YEAR)
        uint256 expectedInterest = (tokenAmount * borrowRateBps * loan.loanDurationBlocks * blockTimeSeconds) / (10000 * SECONDS_PER_YEAR);
        uint256 expectedTotalOwed = tokenAmount + expectedInterest;

        emit LoanBorrowed(loanId, msg.sender, token, tokenAmount, expectedTotalOwed, block.number);
    }

    /// @inheritdoc IUnlloo
    function getApprovedLoanAmount(uint256 loanId)
        public
        view
        loanExists(loanId)
        returns (uint256 approvedAmount)
    {
        Loan memory loan = loans[loanId];
        if (loan.status != LoanStatus.Approved && loan.status != LoanStatus.Pending) return 0;
        return loan.loanAmount;
    }

    // ============ Repayment / Overdue ============
    /**
     * @notice Mark an overdue Active loan as UnpaidDebt in storage
     * @dev This function syncs storage state with the virtual status projection from getLoan().
     *      Anyone can call this to ensure storage reflects the actual overdue status.
     *      
     *      **Why this exists:**
     *      - getLoan() performs virtual status projection for UI convenience
     *      - Storage may lag behind until this function is called
     *      - State-changing functions (like repay()) automatically transition overdue loans
     *      - This function allows explicit synchronization of storage with projection
     *      
     *      **Effects:**
     *      - Updates loan.status to UnpaidDebt in storage
     *      - Updates status arrays and counters
     *      - Emits LoanMovedToUnpaidDebt event
     *      
     *      **Pause Behavior:**
     *      - This function is intentionally NOT pausable to allow status maintenance during emergencies
     *      - Status transitions don't move funds, only update accounting state
     *      
     *      @param loanId The ID of the overdue loan to mark
     */
    function markLoanOverdue(uint256 loanId)
        external
        loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Active));
        // Sentinel check: loan not yet started (startBlock == 0) or invalid duration
        if (loan.startBlock == 0 || loan.loanDurationBlocks == 0) revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Active));

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);
        if (block.number < deadline) revert UnllooErrors.InvalidDuration(block.number, deadline, type(uint256).max);

        _transitionToUnpaidDebt(loanId, loan, deadline);
    }

    /// @inheritdoc IUnlloo
    /// @dev **Pause Behavior:** This function is intentionally NOT pausable to allow borrowers
    ///      to repay debts during emergencies. Preventing repayments during pause could unfairly
    ///      penalize borrowers with accruing interest while they cannot act.
    function repay(
        uint256 loanId,
        uint256 amount
    ) external nonReentrant loanExists(loanId) onlyBorrower(loanId) {
        Loan storage loan = loans[loanId];

        _validateRepaymentConditions(loan, amount);

        // Accrue simple interest before any operations
        _accrueLoanInterest(loanId);

        // If overdue, transition to UnpaidDebt in storage
        _checkAndTransitionOverdue(loanId, loan);

        // Calculate payment amounts
        (uint256 payAmount, uint256 interestPayment, uint256 principalPayment) = 
            _calculateRepaymentSplit(loan, amount);

        // Interaction: Transfer funds first to verify exact amount (fee-on-transfer protection)
        // Note: Protected by nonReentrant modifier
        _safeTransferFromExact(loan.token, msg.sender, address(this), payAmount);

        // Effects: Update state after verifying transfer amount
        // Process interest payment with protocol fees
        if (interestPayment > 0) {
            _processInterestPayment(loan, interestPayment);
        }

        // Record informational repayment (NOT used for debt math)
        loan.amountRepaid += payAmount;

        // Apply principal payment
        if (principalPayment > 0) {
            _applyPrincipalPayment(loan, principalPayment);
        }

        // Check if loan is fully repaid and finalize
        uint256 newTotalDue = _checkAndFinalizeRepayment(loanId, loan);

        emit LoanRepaid(loanId, msg.sender, loan.token, payAmount, newTotalDue, block.number);
    }

    /// @notice Validates all preconditions required for a valid repayment
    /// @dev Checks loan status, amount validity, pool existence, and loan start state
    /// @param loan Storage reference to the loan being repaid
    /// @param amount The repayment amount to validate
    function _validateRepaymentConditions(Loan storage loan, uint256 amount) internal view {
        if (loan.status != LoanStatus.Active && loan.status != LoanStatus.UnpaidDebt) {
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Active));
        }
        if (amount == 0) revert UnllooErrors.InvalidAmount(amount, 1, type(uint256).max);
        if (loan.token == address(0) || pools[loan.token].token == address(0)) {
            revert UnllooErrors.InvalidPool(loan.token);
        }
        // Sentinel check: loan not yet started (startBlock == 0)
        if (loan.startBlock == 0) {
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(LoanStatus.Active));
        }
    }

    /// @dev Checks if loan is overdue and transitions to UnpaidDebt in storage if necessary
    /// @notice This is called automatically in state-changing functions (e.g., repay())
    ///         to ensure storage state matches the virtual projection from getLoan()
    /// @param loanId The loan ID to check
    /// @param loan Storage reference to the loan
    function _checkAndTransitionOverdue(uint256 loanId, Loan storage loan) internal {
        if (loan.status != LoanStatus.Active) return;
        
        uint256 deadline = loan.deadlineBlock != 0 
            ? loan.deadlineBlock 
            : (loan.startBlock + loan.loanDurationBlocks);
            
        if (block.number >= deadline) {
            _transitionToUnpaidDebt(loanId, loan, deadline);
        }
    }

    /// @notice Calculates how to split a repayment between interest and principal
    /// @dev Interest is paid first, then principal. Payment is capped at total due.
    /// @param loan Storage reference to the loan being repaid
    /// @param amount The total repayment amount requested
    /// @return payAmount Actual amount to be paid (capped at total due)
    /// @return interestPayment Portion allocated to interest
    /// @return principalPayment Portion allocated to principal reduction
    function _calculateRepaymentSplit(
        Loan storage loan, 
        uint256 amount
    ) internal view returns (uint256 payAmount, uint256 interestPayment, uint256 principalPayment) {
        uint256 interestDue = loan.interestAccrued;
        uint256 principalOutstanding = loan.principal;
        uint256 totalDue = principalOutstanding + interestDue;
        
        if (totalDue == 0) revert UnllooErrors.InvalidAmount(amount, 1, 0);
        
        // Cap payment at total due to prevent overpayment
        payAmount = amount > totalDue ? totalDue : amount;
        
        // Interest first, then principal
        interestPayment = payAmount > interestDue ? interestDue : payAmount;
        principalPayment = payAmount - interestPayment;
    }

    /// @notice Processes an interest payment by splitting between protocol and lenders
    /// @dev Calculates protocol fee, distributes remainder to lenders via supply index.
    ///      Updates lastAccrualBlock only when interest is fully settled to ensure
    ///      the accrual baseline persists across partial interest payments.
    /// @param loan Storage reference to the loan
    /// @param interestPayment Amount of interest being paid
    function _processInterestPayment(Loan storage loan, uint256 interestPayment) internal {
        uint256 poolProtocolFeeBps = _poolRateCurve[loan.token].protocolFeeBps;
        uint256 protocolFeeForPayment = (interestPayment * poolProtocolFeeBps) / 10000;
        uint256 lenderInterest = interestPayment - protocolFeeForPayment;
        
        // Update protocol revenue
        protocolFees[loan.token] += protocolFeeForPayment;
        loan.protocolFee += protocolFeeForPayment;
        
        // Reduce accrued interest
        loan.interestAccrued -= interestPayment;
        
        // Distribute lender interest via supply index
        if (lenderInterest > 0) {
            _distributeInterestToLenders(loan.token, lenderInterest);
        }
        
        // Only update lastAccrualBlock when interest is fully settled
        // This ensures the accrual baseline is not reset on partial interest payments
        // and prevents micro-repayments from reducing interest growth
        if (loan.interestAccrued == 0) {
            loan.lastAccrualBlock = block.number;
        }
    }

    /// @notice Applies a principal payment to a loan and updates pool accounting
    /// @dev Reduces loan principal and pool borrowedAmount. Does NOT reset lastAccrualBlock
    ///      to ensure continuous interest accrual regardless of principal payments.
    ///      This prevents micro-repayments from reducing interest growth.
    /// @param loan Storage reference to the loan
    /// @param principalPayment Amount of principal being repaid
    function _applyPrincipalPayment(Loan storage loan, uint256 principalPayment) internal {
        // Cap at actual principal to prevent underflow
        if (principalPayment > loan.principal) {
            principalPayment = loan.principal;
        }
        
        loan.principal -= principalPayment;

        // Update pool borrowedAmount
        LiquidityPool storage pool = pools[loan.token];
        if (principalPayment > pool.borrowedAmount) {
            pool.borrowedAmount = 0;
        } else {
            pool.borrowedAmount -= principalPayment;
        }

        // DO NOT reset lastAccrualBlock here - it should only update when interest is fully settled
        // This ensures continuous interest accrual regardless of principal payments
    }

    /// @notice Checks if loan is fully repaid and transitions to Repaid status if so
    /// @dev Calculates remaining debt and calls _finalizeRepaid if principal and interest are zero.
    ///      Does NOT forgive principal dust to maintain conservation invariants.
    /// @param loanId The loan ID to check
    /// @param loan Storage reference to the loan
    /// @return newTotalDue The remaining total due after repayment (0 if fully repaid)
    function _checkAndFinalizeRepayment(uint256 loanId, Loan storage loan) internal returns (uint256 newTotalDue) {
        uint256 newAccrued = _getAccruedInterest(loanId);
        newTotalDue = loan.principal + newAccrued;

        // NOTE: We intentionally do NOT forgive principal "dust".
        // Forgiving principal without receiving tokens breaks conservation and can cause LP withdrawals
        // to revert (NotEnoughCash). Borrowers must repay full principal.
        // Sentinel check: loan fully repaid (principal and all interest cleared)
        if (loan.principal == 0 && newTotalDue == 0) {
            _finalizeRepaid(loanId, loan);
        }
    }

    // ============ Liquidity Pool Functions ============
    /// @inheritdoc IUnlloo
    function depositLiquidity(address token, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        validPool(token)
    {
        if (amount == 0) revert UnllooErrors.InvalidAmount(amount, 1, type(uint256).max);

        uint256 allowance = IERC20(token).allowance(msg.sender, address(this));
        if (allowance < amount) revert UnllooErrors.InsufficientAllowance(amount, allowance);

        _distributePendingInterest(token);
        _updateLenderAccrual(msg.sender, token);

        LenderPosition storage position = lenderPositions[msg.sender][token];
        bool isNewLender = position.lender == address(0);

        if (isNewLender) {
            position.lender = msg.sender;
            position.token = token;
            position.depositBlock = block.number;
            position.lastWithdrawBlock = block.number;
            activeLenderCount[token] += 1;
        }

        position.depositedAmount += amount;
        pools[token].totalLiquidity += amount;

        _safeTransferFromExact(token, msg.sender, address(this), amount);

        emit LiquidityDeposited(msg.sender, token, amount, block.number);
    }

    /// @inheritdoc IUnlloo
    function withdrawLiquidity(address token, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        validPool(token)
    {
        if (amount == 0) revert UnllooErrors.InvalidAmount(amount, 1, type(uint256).max);

        _distributePendingInterest(token);
        _updateLenderAccrual(msg.sender, token);

        LenderPosition storage position = lenderPositions[msg.sender][token];
        if (position.lender == address(0) || position.depositedAmount == 0) revert UnllooErrors.InvalidAmount(amount, 1, 0);
        if (amount > position.depositedAmount) revert UnllooErrors.InvalidAmount(amount, 1, position.depositedAmount);

        LiquidityPool storage pool = pools[token];
        if (pool.borrowedAmount > pool.totalLiquidity) revert UnllooErrors.InsufficientLiquidity(amount, 0);

        uint256 freeLiquidity = pool.totalLiquidity - pool.borrowedAmount;
        if (amount > freeLiquidity) revert UnllooErrors.InsufficientLiquidity(amount, freeLiquidity);

        uint256 accrued = lenderAccruedInterest[msg.sender][token];

        uint256 interestToPay;
        if (amount == position.depositedAmount) {
            // Full withdrawal: pay all interest
            interestToPay = accrued;
        } else {
            // Partial: pay pro-rata
            interestToPay = (accrued * amount) / position.depositedAmount;
        }

        // Update storage before external call
        position.depositedAmount -= amount;
        position.lastWithdrawBlock = block.number;
        pool.totalLiquidity -= amount;

        if (interestToPay > 0) {
            lenderAccruedInterest[msg.sender][token] = accrued - interestToPay;
        }

        if (position.depositedAmount == 0) {
            delete lenderPositions[msg.sender][token];
            delete lenderSupplyIndex[msg.sender][token];
            delete lenderAccruedInterest[msg.sender][token];
            activeLenderCount[token] -= 1;
        }

        uint256 totalPayout = amount + interestToPay;

        // Ensure we do not spend reserved protocol fees
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < totalPayout) revert UnllooErrors.NotEnoughCash(totalPayout, balance);
        if (balance - totalPayout < protocolFees[token]) revert UnllooErrors.NotEnoughCash(totalPayout, balance - protocolFees[token]);

        _safeTransferExact(token, msg.sender, totalPayout);

        emit LiquidityWithdrawn(msg.sender, token, amount, interestToPay, totalPayout, block.number);
    }

    /// @inheritdoc IUnlloo
    function getLenderPosition(address lender, address token)
        external
        view
        returns (uint256 depositedAmount, uint256 accruedInterest, uint256 totalWithdrawable)
    {
        LenderPosition memory position = lenderPositions[lender][token];
        if (position.lender == address(0) || position.depositedAmount == 0) return (0, 0, 0);

        depositedAmount = position.depositedAmount;

        uint256 idx = poolSupplyIndex[token];
        uint256 und = poolUndistributedInterest[token];
        uint256 tl = pools[token].totalLiquidity;
        if (und > 0 && tl > 0) {
            idx += (und * INDEX_SCALE) / tl;
        }

        uint256 lenderIdx = lenderSupplyIndex[lender][token];
        uint256 pending = 0;
        if (idx > lenderIdx) {
            pending = (depositedAmount * (idx - lenderIdx)) / INDEX_SCALE;
        }

        accruedInterest = lenderAccruedInterest[lender][token] + pending;
        totalWithdrawable = depositedAmount + accruedInterest;
    }

    // ============ View Functions ============
    function _interestDue(uint256 loanId) internal view returns (uint256) {
        return _getAccruedInterest(loanId);
    }

    function _totalOwed(uint256 loanId) internal view returns (uint256) {
        return loans[loanId].principal + _interestDue(loanId);
    }

    /// @inheritdoc IUnlloo
    /// @notice Get loan information with virtual status projection
    /// @dev **IMPORTANT: This function performs VIRTUAL STATUS PROJECTION**
    ///      The returned loan status may differ from actual storage state.
    ///      
    ///      For Active loans past their deadline, this function returns UnpaidDebt
    ///      even if storage still shows Active. This is for UI convenience.
    ///      
    ///      **Storage State Transitions:**
    ///      - Storage transitions to UnpaidDebt occur via:
    ///        1. Explicit call to `markLoanOverdue(loanId)` (anyone can call)
    ///        2. Automatic transition in state-changing functions like `repay()`
    ///      
    ///      **Frontend/Indexer Considerations:**
    ///      - Frontends should use this function for display purposes
    ///      - Indexers should track both projected status (from getLoan) and actual storage
    ///      - State-changing operations use actual storage status, not projected status
    ///      - To sync storage with projection, call `markLoanOverdue()` before state changes
    ///      
    ///      @param loanId The ID of the loan to retrieve
    ///      @return loan Loan struct with potentially projected status
    function getLoan(uint256 loanId)
        external
        view
        returns (Loan memory loan)
    {
        loan = loans[loanId];
        if (loan.borrower == address(0)) return loan;

        // Virtual status projection: reflect overdue status for UI even if storage hasn't updated
        if (loan.status == LoanStatus.Active || loan.status == LoanStatus.UnpaidDebt) {
            uint256 deadline = loan.deadlineBlock;
            if (deadline == 0) deadline = loan.startBlock + loan.loanDurationBlocks;
            if (deadline != 0 && block.number >= deadline) {
                // Project UnpaidDebt status even if storage still shows Active
                // Storage will be updated by markLoanOverdue() or during state-changing operations
                loan.status = LoanStatus.UnpaidDebt;
                loan.deadlineBlock = deadline;
            }
        }
    }

    /// @inheritdoc IUnlloo
    function getAccruedInterest(uint256 loanId)
        external
        view
        loanExists(loanId)
        returns (uint256 accruedInterest)
    {
        return _interestDue(loanId);
    }

    /// @inheritdoc IUnlloo
    function getTotalOwed(uint256 loanId)
        external
        view
        loanExists(loanId)
        returns (uint256 totalOwed)
    {
        return _totalOwed(loanId);
    }

    /// @inheritdoc IUnlloo
    function getRemainingBalance(uint256 loanId)
        external
        view
        loanExists(loanId)
        returns (uint256 remainingBalance)
    {
        return _totalOwed(loanId);
    }

    /// @inheritdoc IUnlloo
    function calculateBorrowRate(address token)
        external
        view
        returns (uint256 rateBps)
    {
        return _calculateBorrowRate(token);
    }

    /// @inheritdoc IUnlloo
    function getLoansByBorrower(address borrower)
        external
        view
        returns (uint256[] memory)
    {
        return _borrowerLoans[borrower];
    }

    /// @inheritdoc IUnlloo
    function getLoansByStatus(
        LoanStatus status,
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

    /// @inheritdoc IUnlloo
    function getLiquidityPool(address token)
        external
        view
        returns (LiquidityPool memory pool)
    {
        pool = pools[token];
    }

    /// @inheritdoc IUnlloo
    function getActiveLenderCount(address token)
        external
        view
        returns (uint256 count)
    {
        return activeLenderCount[token];
    }

    /// @inheritdoc IUnlloo
    function hasUnpaidDebt(address user)
        public
        view
        returns (bool)
    {
        if (unpaidDebtLoanCount[user] != 0) return true;

        uint256 activeId = _activeLoanByBorrower[user];
        // Sentinel check: no active loan ID set
        if (activeId == 0) return false;

        Loan memory loan = loans[activeId];
        if (loan.status == LoanStatus.UnpaidDebt) return true;
        if (loan.status != LoanStatus.Active) return false;
        // Sentinel check: loan not yet started (startBlock == 0) or invalid duration
        if (loan.startBlock == 0 || loan.loanDurationBlocks == 0) return false;

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);
        return block.number >= deadline;
    }

    /// @inheritdoc IUnlloo
    function getActiveLoanByBorrower(address borrower)
        external
        view
        returns (uint256 loanId)
    {
        loanId = _activeLoanByBorrower[borrower];
        // Sentinel check: no active loan ID set
        if (loanId == 0) return 0;

        Loan memory loan = loans[loanId];
        if (loan.status != LoanStatus.Active) return 0;
        // Sentinel check: loan not yet started (startBlock == 0) or invalid duration
        if (loan.startBlock == 0 || loan.loanDurationBlocks == 0) return 0;

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);
        if (block.number >= deadline) return 0;

        return loanId;
    }

    /// @inheritdoc IUnlloo
    function getProtocolFees(address token)
        external
        view
        returns (uint256 balance)
    {
        return protocolFees[token];
    }

    /// @inheritdoc IUnlloo
    function canSubmitRequest(address user)
        external
        view
        returns (bool)
    {
        if (hasUnpaidDebt(user)) return false;
        if (_activeLoanByBorrower[user] != 0) return false;
        if (openRequestCount[user] >= MAX_PENDING_LOANS_PER_USER) return false;

        uint256 lastRequest = lastRequestBlock[user];
        if (lastRequest == 0) return true;

        return block.number >= lastRequest + cooldownBlocks;
    }

    /// @inheritdoc IUnlloo
    function getCooldownEndBlock(address user)
        external
        view
        returns (uint256 cooldownEndBlock)
    {
        if (user == address(0)) return type(uint256).max;

        uint256 lastRequest = lastRequestBlock[user];
        if (lastRequest == 0) return 0;

        return lastRequest + cooldownBlocks;
    }

    function borrowerLoans(address borrower)
        external
        view
        returns (uint256[] memory)
    {
        return _borrowerLoans[borrower];
    }

    function loansByStatus(LoanStatus status)
        external
        view
        returns (uint256[] memory)
    {
        return _loansByStatus[status];
    }

    // ============ Admin Functions ============
    /// @inheritdoc IUnlloo
    function pause() external onlyOwner { _pause(); }
    /// @inheritdoc IUnlloo
    function unpause() external onlyOwner { _unpause(); }

    /**
     * @dev Safer emergency withdraw: only allows withdrawing tokens NOT configured as a pool token.
     *      For pool tokens, use withdrawProtocolFees().
     */
    function emergencyWithdraw(address token, uint256 amount)
        external
        onlyOwner
        whenPaused
        nonReentrant
    {
        _validateNonZeroAddress(token);

        // Disallow emergency withdraw for active pools to prevent accidental LP fund theft.
        if (pools[token].token != address(0)) revert UnllooErrors.InvalidPool(token);

        uint256 balance = IERC20(token).balanceOf(address(this));
        _validateNonZeroAmount(amount, balance);

        _safeTransferExact(token, owner(), amount);
        emit EmergencyWithdraw(token, amount, block.number);
    }

    /// @inheritdoc IUnlloo
    function withdrawETH(uint256 amount)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        uint256 fees = protocolFees[address(0)];
        if (amount == 0 || amount > fees) revert UnllooErrors.InvalidAmount(amount, 1, fees);

        uint256 bal = address(this).balance;
        if (amount > bal) revert UnllooErrors.InvalidAmount(amount, 1, bal);

        // Effects (state changes before external call - CEI pattern)
        protocolFees[address(0)] = fees - amount;
        address recipient = owner();
        
        // Emit before interaction (strict CEI)
        emit ETHWithdrawn(recipient, amount, block.number);

        // Interaction: low-level call with explicit error handling
        // Using call{value:}("") is the recommended pattern for ETH transfers
        // as it forwards all available gas and handles contract recipients
        (bool success, ) = payable(recipient).call{ value: amount }("");
        require(success, "ETH_TRANSFER_FAILED");
    }

    /// @inheritdoc IUnlloo
    function updateMinReputation(uint16 newMinReputation)
        external
        onlyOwner
    {
        if (newMinReputation > 1000) revert UnllooErrors.InvalidReputation(newMinReputation, 0);
        if (newMinReputation == minReputation) revert UnllooErrors.InvalidReputation(newMinReputation, minReputation);

        uint16 oldMinReputation = minReputation;
        minReputation = newMinReputation;

        emit MinReputationUpdated(oldMinReputation, newMinReputation, block.number);
    }


    /// @inheritdoc IUnlloo
    function updateCooldownBlocks(uint256 newCooldownBlocks)
        external
        onlyOwner
    {
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

        emit CooldownBlocksUpdated(oldCooldownBlocks, newCooldownBlocks, block.number);
    }


    /// @inheritdoc IUnlloo
    function addLiquidityPool(address token, uint256 minLoanAmount, uint256 maxLoanAmount)
        external
        onlyOwner
    {
        if (token == address(0)) revert UnllooErrors.InvalidPool(address(0));
        if (pools[token].token != address(0)) revert UnllooErrors.PoolExists(token);

        _validateTokenDecimals(token);

        if (minLoanAmount == 0 || maxLoanAmount == 0) revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);
        if (minLoanAmount >= maxLoanAmount) revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);

        pools[token] = LiquidityPool({ token: token, totalLiquidity: 0, borrowedAmount: 0 });
        minLoanAmountPerPool[token] = minLoanAmount;
        maxLoanAmountPerPool[token] = maxLoanAmount;

        poolSupplyIndex[token] = INDEX_SCALE;

        // Set default rate curve for new pool
        _poolRateCurve[token] = RateCurveParams({
            baseRateBps: DEFAULT_BASE_RATE_BPS,
            optimalUtilizationBps: DEFAULT_OPTIMAL_UTILIZATION_BPS,
            slope1Bps: DEFAULT_SLOPE1_BPS,
            slope2Bps: DEFAULT_SLOPE2_BPS,
            protocolFeeBps: DEFAULT_PROTOCOL_FEE_BPS
        });

        emit PoolAdded(token, block.number);
    }

    /// @inheritdoc IUnlloo
    /// @dev **Warning:** Any accumulated undistributed interest (rounding dust) will be lost
    ///      when the pool is removed. This is typically negligible but should be considered.
    ///      Ensure all lenders have withdrawn before removing a pool.
    function removeLiquidityPool(address token)
        external
        onlyOwner
    {
        LiquidityPool memory pool = pools[token];
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

        emit PoolRemoved(token, block.number);
    }

    /// @inheritdoc IUnlloo
    function updatePoolLoanLimits(address token, uint256 minLoanAmount, uint256 maxLoanAmount)
        external
        onlyOwner
    {
        if (token == address(0) || pools[token].token == address(0)) revert UnllooErrors.InvalidPool(token);
        if (minLoanAmount == 0 || maxLoanAmount == 0) revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);
        if (minLoanAmount >= maxLoanAmount) revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmount, maxLoanAmount);

        minLoanAmountPerPool[token] = minLoanAmount;
        maxLoanAmountPerPool[token] = maxLoanAmount;

        emit PoolLoanLimitsUpdated(token, minLoanAmount, maxLoanAmount, block.number);
    }

    /// @inheritdoc IUnlloo
    function updatePoolRateCurve(
        address token,
        uint256 baseRateBps,
        uint256 optimalUtilizationBps,
        uint256 slope1Bps,
        uint256 slope2Bps,
        uint256 protocolFeeBps
    )
        external
        onlyOwner
        validPool(token)
    {
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

        _poolRateCurve[token] = RateCurveParams({
            baseRateBps: baseRateBps,
            optimalUtilizationBps: optimalUtilizationBps,
            slope1Bps: slope1Bps,
            slope2Bps: slope2Bps,
            protocolFeeBps: protocolFeeBps
        });

        emit InterestRatesUpdated(
            token,
            baseRateBps,
            optimalUtilizationBps,
            slope1Bps,
            slope2Bps,
            protocolFeeBps,
            block.number
        );
    }

    /// @inheritdoc IUnlloo
    function getPoolRateCurve(address token)
        external
        view
        returns (RateCurveParams memory)
    {
        return _poolRateCurve[token];
    }

    /// @inheritdoc IUnlloo
    function getPoolLoanLimits(address token)
        external
        view
        returns (uint256 minLoanAmount, uint256 maxLoanAmount)
    {
        return (minLoanAmountPerPool[token], maxLoanAmountPerPool[token]);
    }

    /// @inheritdoc IUnlloo
    function withdrawProtocolFees(address token, uint256 amount)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        _validateNonZeroAddress(token);
        _validateNonZeroAmount(amount, protocolFees[token]);

        protocolFees[token] -= amount;
        address o = owner();
        _safeTransferExact(token, o, amount);
        emit ProtocolFeesWithdrawn(o, token, amount, block.number);
    }

    // ============ Internal: Simple Interest ============
    
    /// @notice Calculate capped blocks elapsed for interest calculation
    /// @dev Applies two caps to prevent unbounded interest accrual:
    ///      1. 5-year cap after loan deadline (for overdue loans)
    ///      2. Absolute MAX_BLOCKS_FOR_INTEREST cap (for abandoned loans)
    /// @param lastAccrualBlock Block when interest was last accrued
    /// @param startBlock Block when loan started
    /// @param deadlineBlock Block when loan is due (0 if not set)
    /// @param loanDurationBlocks Duration of the loan in blocks
    /// @return blocksElapsed Capped number of blocks for interest calculation
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
            // Calculate maximum block for interest accrual: deadline + 5 years
            uint256 maxInterestAccrualBlocks = (MAX_INTEREST_ACCRUAL_YEARS * SECONDS_PER_YEAR) / blockTimeSeconds;
            uint256 maxInterestBlock = deadline + maxInterestAccrualBlocks;
            
            // If we've passed the maximum interest accrual block, cap to that point
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
    
    /// @notice Accrue simple interest on a loan
    /// @dev Simple interest formula: I = P * r * t
    ///      Updates loan.interestAccrued but NOT lastAccrualBlock.
    ///      lastAccrualBlock is only updated when interest is fully settled (in _processInterestPayment).
    ///      This ensures continuous interest accrual regardless of principal payments.
    /// @param loanId The loan ID to accrue interest on
    function _accrueLoanInterest(uint256 loanId) internal {
        Loan storage loan = loans[loanId];
        // Sentinel checks: loan has no principal, rate, or not started
        if (loan.principal == 0 || loan.borrowRateBps == 0 || loan.lastAccrualBlock == 0) return;
        
        uint256 blocksElapsed = _calculateCappedBlocksElapsed(
            loan.lastAccrualBlock,
            loan.startBlock,
            loan.deadlineBlock,
            loan.loanDurationBlocks
        );
        if (blocksElapsed == 0) return;
        
        // Simple interest: I = P * rateBps * blocksElapsed * blockTimeSeconds / (10000 * SECONDS_PER_YEAR)
        uint256 interest = (loan.principal * loan.borrowRateBps * blocksElapsed * blockTimeSeconds) / (10000 * SECONDS_PER_YEAR);
        
        loan.interestAccrued += interest;
        // DO NOT update lastAccrualBlock here - it's only updated when interest is fully settled
    }
    
    /// @notice Calculate utilization-based borrow rate
    /// @dev Piecewise linear model based on pool utilization using per-pool parameters
    ///      Uses multiply-first-divide-last pattern to avoid precision loss
    /// @param token Token address of the pool
    /// @return rateBps Borrow rate in basis points
    function _calculateBorrowRate(address token) internal view returns (uint256 rateBps) {
        LiquidityPool memory pool = pools[token];
        if (pool.totalLiquidity == 0) return MIN_BORROWER_RATE;
        
        RateCurveParams memory curve = _poolRateCurve[token];
        
        // Calculate utilization: U = borrowedAmount * 10000 / totalLiquidity
        uint256 utilization = (pool.borrowedAmount * 10000) / pool.totalLiquidity;
        
        // Piecewise linear model (multiply first, divide last to avoid precision loss)
        if (utilization <= curve.optimalUtilizationBps) {
            // Below optimal: baseRate + (borrowedAmount * 10000 * slope1) / (totalLiquidity * optimalUtil)
            // This combines the utilization calculation with the slope calculation
            uint256 slopeContribution = (pool.borrowedAmount * 10000 * curve.slope1Bps) / 
                (pool.totalLiquidity * curve.optimalUtilizationBps);
            rateBps = curve.baseRateBps + slopeContribution;
        } else {
            // Above optimal: baseRate + slope1 + ((U - optimalUtil) * slope2) / (10000 - optimalUtil)
            uint256 excessUtil = utilization - curve.optimalUtilizationBps;
            uint256 remainingUtil = 10000 - curve.optimalUtilizationBps;
            // Multiply first: (excessUtil * slope2Bps) / remainingUtil
            uint256 excessContribution = (excessUtil * curve.slope2Bps) / remainingUtil;
            rateBps = curve.baseRateBps + curve.slope1Bps + excessContribution;
        }
        
        // Clamp to min/max bounds
        if (rateBps < MIN_BORROWER_RATE) rateBps = MIN_BORROWER_RATE;
        if (rateBps > MAX_BORROWER_RATE) rateBps = MAX_BORROWER_RATE;
        
        return rateBps;
    }
    
    /// @notice Get accrued interest for a loan (view function)
    /// @dev Calculates interest without modifying state using simple interest formula.
    ///      Uses multiply-first-divide-last pattern to avoid precision loss.
    /// @param loanId The loan ID to calculate interest for
    /// @return Total accrued interest including any new interest since last accrual
    function _getAccruedInterest(uint256 loanId) internal view returns (uint256) {
        Loan memory loan = loans[loanId];
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
        uint256 newInterest = (loan.principal * loan.borrowRateBps * blocksElapsed * blockTimeSeconds) / (10000 * SECONDS_PER_YEAR);
        return loan.interestAccrued + newInterest;
    }

    // ============ Internal: Lender index ============
    /// @dev Distributes pending interest to the supply index
    /// @notice Explicitly tracks rounding dust to maintain exact accounting and prevent precision loss.
    ///         This function handles the divide-before-multiply pattern by explicitly calculating
    ///         and preserving any rounding dust that would otherwise be lost.
    /// @param token The token address for the pool
    function _distributePendingInterest(address token) internal {
        uint256 pending = poolUndistributedInterest[token];
        if (pending == 0) return;

        uint256 tl = pools[token].totalLiquidity;
        if (tl == 0) return;

        // Calculate index delta: (pending * INDEX_SCALE) / tl
        uint256 delta = (pending * INDEX_SCALE) / tl;
        if (delta == 0) return;

        // Calculate actual distributed amount: (delta * tl) / INDEX_SCALE
        // This divide-before-multiply pattern is intentional for index-based distribution,
        // but we MUST track the rounding dust to prevent permanent loss
        uint256 distributed = (delta * tl) / INDEX_SCALE;
        
        // CRITICAL: Explicitly calculate and preserve rounding dust
        // Without this, dust would be permanently lost, causing long-term lender underpayment
        uint256 dust = pending - distributed;
        poolUndistributedInterest[token] = dust;
        poolSupplyIndex[token] += delta;
    }

    function _updateLenderAccrual(address lender, address token) internal {
        // Cache poolSupplyIndex to avoid redundant storage reads
        uint256 idx = poolSupplyIndex[token];
        
        LenderPosition memory pos = lenderPositions[lender][token];
        if (pos.depositedAmount == 0) {
            lenderSupplyIndex[lender][token] = idx;
            return;
        }

        uint256 lenderIdx = lenderSupplyIndex[lender][token];
        if (lenderIdx == 0) lenderIdx = idx;

        if (idx > lenderIdx) {
            uint256 delta = idx - lenderIdx;
            uint256 addAccrued = (pos.depositedAmount * delta) / INDEX_SCALE;
            if (addAccrued > 0) lenderAccruedInterest[lender][token] += addAccrued;
        }

        lenderSupplyIndex[lender][token] = idx;
    }

    /// @dev Distributes interest to lenders via supply index
    /// @notice Explicitly tracks rounding dust to maintain exact accounting and prevent precision loss.
    ///         This function handles the divide-before-multiply pattern by explicitly calculating
    ///         and preserving any rounding dust that would otherwise be lost.
    /// @param token The token address for the pool
    /// @param amount The interest amount to distribute
    function _distributeInterestToLenders(address token, uint256 amount) internal {
        if (amount == 0) return;
        uint256 tl = pools[token].totalLiquidity;
        if (tl == 0) {
            // No liquidity: store entire amount as undistributed for future distribution
            poolUndistributedInterest[token] += amount;
            return;
        }

        // Calculate index delta: (amount * INDEX_SCALE) / tl
        uint256 delta = (amount * INDEX_SCALE) / tl;
        if (delta == 0) {
            // Delta too small: store entire amount as undistributed for future distribution
            poolUndistributedInterest[token] += amount;
            return;
        }

        // Calculate actual distributed amount: (delta * tl) / INDEX_SCALE
        // This divide-before-multiply pattern is intentional for index-based distribution,
        // but we MUST track the rounding dust to prevent permanent loss
        uint256 distributed = (delta * tl) / INDEX_SCALE;
        
        // CRITICAL: Explicitly calculate and preserve rounding dust
        // Without this, dust would be permanently lost, causing long-term lender underpayment
        uint256 dust = amount - distributed;
        poolUndistributedInterest[token] += dust;

        poolSupplyIndex[token] += delta;
    }

    // ============ Internal: Status transitions ============
    function _transitionToUnpaidDebt(uint256 loanId, Loan storage loan, uint256 deadline) internal {
        if (loan.status != LoanStatus.Active) return;

        loan.status = LoanStatus.UnpaidDebt;
        loan.deadlineBlock = deadline;

        _loansByStatus[LoanStatus.Active].remove(_loanStatusIndex[LoanStatus.Active], loanId, LoanStatus.Active);
        _loansByStatus[LoanStatus.UnpaidDebt].add(_loanStatusIndex[LoanStatus.UnpaidDebt], loanId, LoanStatus.UnpaidDebt);

        unpaidDebtLoanCount[loan.borrower] += 1;

        if (_activeLoanByBorrower[loan.borrower] == loanId) _activeLoanByBorrower[loan.borrower] = 0;

        // per-pool counters
        address token = loan.token;
        if (activeLoansPerPool[token] > 0) activeLoansPerPool[token] -= 1;
        unpaidDebtLoansPerPool[token] += 1;

        emit LoanMovedToUnpaidDebt(loanId, loan.borrower, loan.deadlineBlock, block.number);
    }

    function _finalizeRepaid(uint256 loanId, Loan storage loan) internal {
        LoanStatus beforeStatus = loan.status;
        loan.status = LoanStatus.Repaid;

        if (beforeStatus == LoanStatus.UnpaidDebt && unpaidDebtLoanCount[loan.borrower] > 0) {
            unpaidDebtLoanCount[loan.borrower] -= 1;
        }

        if (_activeLoanByBorrower[loan.borrower] == loanId) {
            _activeLoanByBorrower[loan.borrower] = 0;
        }

        // per-pool counters
        address token = loan.token;
        if (beforeStatus == LoanStatus.Active) {
            if (activeLoansPerPool[token] > 0) activeLoansPerPool[token] -= 1;
        } else if (beforeStatus == LoanStatus.UnpaidDebt) {
            if (unpaidDebtLoansPerPool[token] > 0) unpaidDebtLoansPerPool[token] -= 1;
        }

        _loansByStatus[beforeStatus].remove(_loanStatusIndex[beforeStatus], loanId, beforeStatus);
        _loansByStatus[LoanStatus.Repaid].add(_loanStatusIndex[LoanStatus.Repaid], loanId, LoanStatus.Repaid);
    }

    // ============ Internal: Transfer helpers (strict ERC20) ============
    function _safeTransferFromExact(address token, address from, address to, uint256 amount) internal {
        uint256 beforeBal = IERC20(token).balanceOf(to);
        IERC20(token).safeTransferFrom(from, to, amount);
        uint256 afterBal = IERC20(token).balanceOf(to);
        if (afterBal - beforeBal != amount) revert UnllooErrors.UnsupportedTokenTransfer(token);
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

    // ============ Internal Helper Functions ============
    function _getLoanLimits(address token)
        internal
        view
        returns (uint256 minLoanAmountToken, uint256 maxLoanAmountToken)
    {
        minLoanAmountToken = minLoanAmountPerPool[token];
        maxLoanAmountToken = maxLoanAmountPerPool[token];
        if (minLoanAmountToken == 0 || maxLoanAmountToken == 0) {
            revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmountToken, maxLoanAmountToken);
        }
    }

    function _validateNonZeroAddress(address addr) internal pure {
        if (addr == address(0)) revert UnllooErrors.InvalidPool(address(0));
    }

    function _validateNonZeroAmount(uint256 amount, uint256 maxAmount) internal pure {
        if (amount == 0 || amount > maxAmount) revert UnllooErrors.InvalidAmount(amount, 1, maxAmount);
    }

    function _validateTokenDecimals(address token) internal view {
        try IERC20Metadata(token).decimals() returns (uint8 decimals) {
            if (decimals < 6 || decimals > 18) revert UnllooErrors.InvalidPool(token);
        } catch {
            revert UnllooErrors.InvalidPool(token);
        }
    }

    // ============ Receive Function ============
    receive() external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert UnllooErrors.InvalidAmount(0, 1, type(uint256).max);

        protocolFees[address(0)] += msg.value;
        emit ETHReceived(msg.sender, msg.value, block.number);
    }
}
