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
 * @title UnllooCore
 * @notice Hot-path implementation contract for the Unlloo lending protocol.
 * @dev This is the contract the UUPS proxy points to as its implementation.
 *      It handles all user-facing state-changing operations (submit, borrow, repay,
 *      deposit, withdraw) and all internal accounting helpers.
 *
 *      Admin functions and view functions live in UnllooExt. When a call arrives
 *      whose selector does not match any function in Core, fallback() fires and
 *      forwards the call to UnllooExt via delegatecall. Since delegatecall runs
 *      Ext's bytecode in Core's storage context, all state reads/writes target the
 *      proxy's storage — the caller observes a single contract at one address.
 *
 *      Storage layout MUST remain identical to UnllooExt. Both contracts inherit
 *      only UnllooStorage, which enforces layout parity by construction.
 *
 * @dev Production changes:
 *      - Fixes critical repay accounting bug (no double-subtraction of repaid amounts)
 *      - Adds fair lender yield distribution via supply index (interest paid only)
 *      - Protocol fees are segregated; do not block LP principal withdrawals
 *      - Interest continues accruing after due date
 *      - Owner-only expiry for Approved requests
 *      - Optional public "mark overdue" for correct status transitions
 *      - Strict ERC20 transfers (reverts on fee-on-transfer style behavior)
 */
contract UnllooCore is UnllooStorage {
    using SafeERC20 for IERC20;
    using UnllooStatusArray for uint256[];

    // ============ Constructor ============
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Fallback: delegate to UnllooExt ============
    /**
     * @notice Forwards unrecognized calls to UnllooExt via delegatecall.
     * @dev The delegatecall runs Ext's bytecode in Core's storage context.
     *      msg.sender and address(this) are preserved. Reverts if extensionDelegate
     *      is the zero address (Ext not yet configured).
     */
    fallback() external payable {
        address ext = extensionDelegate;
        if (ext == address(0)) revert UnllooErrors.InvalidAddress(address(0));
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), ext, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    // ============ Receive: ETH accounting ============
    /**
     * @notice Accepts ETH and credits it to protocolFees[address(0)].
     * @dev Intentionally whenNotPaused nonReentrant to match legacy Unlloo.sol behavior.
     */
    receive() external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert UnllooErrors.InvalidAmount(0, 1, type(uint256).max);
        protocolFees[address(0)] += msg.value;
        emit IUnlloo.ETHReceived(msg.sender, msg.value, block.number);
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
    /**
     * @notice Initialize the protocol.
     * @dev Gains a sixth parameter (_extensionDelegate) compared to Unlloo.sol.
     *      All other parameters and validation logic are unchanged.
     * @param _defaultToken Default ERC20 token for the initial liquidity pool
     * @param blockTimeSecondsValue Block time in seconds for this chain (1-86400)
     * @param initialOwner Owner address (admin)
     * @param _defaultMinLoanAmount Minimum loan amount in token decimals
     * @param _defaultMaxLoanAmount Maximum loan amount in token decimals
     * @param _extensionDelegate Address of the deployed UnllooExt contract
     */
    function initialize(
        address _defaultToken,
        uint256 blockTimeSecondsValue,
        address initialOwner,
        uint256 _defaultMinLoanAmount,
        uint256 _defaultMaxLoanAmount,
        address _extensionDelegate
    ) public initializer {
        if (initialOwner == address(0)) revert UnllooErrors.InvalidOwner(initialOwner);
        if (_defaultToken == address(0)) revert UnllooErrors.InvalidDefaultToken(address(0));
        if (blockTimeSecondsValue == 0 || blockTimeSecondsValue > 86400)
            revert UnllooErrors.InvalidBlockTime(blockTimeSecondsValue);

        if (_defaultMinLoanAmount == 0 || _defaultMaxLoanAmount == 0) {
            revert UnllooErrors.InvalidPoolLoanLimits(_defaultMinLoanAmount, _defaultMaxLoanAmount);
        }
        if (_defaultMinLoanAmount >= _defaultMaxLoanAmount) {
            revert UnllooErrors.InvalidPoolLoanLimits(_defaultMinLoanAmount, _defaultMaxLoanAmount);
        }
        if (_extensionDelegate == address(0) || _extensionDelegate.code.length == 0)
            revert UnllooErrors.InvalidAddress(_extensionDelegate);

        __Ownable_init(initialOwner);
        __Pausable_init();
        __ReentrancyGuard_init();

        defaultToken = _defaultToken;
        blockTimeSeconds = blockTimeSecondsValue;

        _validateTokenDecimals(_defaultToken);

        pools[_defaultToken] = IUnlloo.LiquidityPool({ token: _defaultToken, totalLiquidity: 0, borrowedAmount: 0 });
        minLoanAmountPerPool[_defaultToken] = _defaultMinLoanAmount;
        maxLoanAmountPerPool[_defaultToken] = _defaultMaxLoanAmount;

        // supply index starts at 1e18
        poolSupplyIndex[_defaultToken] = 1e18;

        // Set default rate curve for default pool
        _poolRateCurve[_defaultToken] = IUnlloo.RateCurveParams({
            baseRateBps: DEFAULT_BASE_RATE_BPS,
            optimalUtilizationBps: DEFAULT_OPTIMAL_UTILIZATION_BPS,
            slope1Bps: DEFAULT_SLOPE1_BPS,
            slope2Bps: DEFAULT_SLOPE2_BPS,
            protocolFeeBps: DEFAULT_PROTOCOL_FEE_BPS
        });

        minReputation = 200;

        // Calculate blocks per day (multiply first, divide last to avoid precision loss)
        uint256 blocksPerDay = SECONDS_PER_DAY / blockTimeSecondsValue;
        if (blocksPerDay == 0) revert UnllooErrors.InvalidBlockTime(blockTimeSecondsValue);

        // Calculate duration constants (multiply first, divide last)
        minLoanDurationBlocks = blocksPerDay;
        maxLoanDurationBlocks = (SECONDS_PER_DAY * 60) / blockTimeSecondsValue; // 60 days
        approvedLoanExpiryBlocks = (SECONDS_PER_DAY * 30) / blockTimeSecondsValue; // 30 days
        cooldownBlocks = blocksPerDay;

        // Store extension delegate
        extensionDelegate = _extensionDelegate;

        // Initialize guarantor grace period to 7 days
        guarantorGracePeriodBlocks = (SECONDS_PER_DAY * 7) / blockTimeSecondsValue;
    }

    // ============ Extension Management ============
    /**
     * @notice Update the address of the UnllooExt contract.
     * @dev Owner-only. Emits ExtensionUpdated. In production this should be
     *      protected by a timelock to limit owner privilege on Ext swaps.
     * @param newExtension Address of the new UnllooExt deployment
     */
    function setExtension(address newExtension) external onlyOwner {
        if (newExtension == address(0) || newExtension.code.length == 0)
            revert UnllooErrors.InvalidAddress(newExtension);
        address old = extensionDelegate;
        extensionDelegate = newExtension;
        emit IUnlloo.ExtensionUpdated(old, newExtension, block.number);
    }

    // ============ Loan Request Functions ============
    /**
     * @notice Submit a new loan request to the protocol
     */
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
        if (openRequestCount[msg.sender] >= MAX_PENDING_LOANS_PER_USER)
            revert UnllooErrors.ExceedsMaxPendingLoans(msg.sender);
        if (_activeLoanByBorrower[msg.sender] != 0) revert UnllooErrors.HasActiveLoan(msg.sender);

        if (lastRequestBlock[msg.sender] > 0) {
            uint256 cooldownEnd = lastRequestBlock[msg.sender] + cooldownBlocks;
            if (block.number < cooldownEnd) revert UnllooErrors.CooldownNotExpired(msg.sender, cooldownEnd);
        }

        loanId = ++loanCounter;

        loans[loanId] = IUnlloo.Loan({
            loanId: loanId,
            borrower: msg.sender,
            status: IUnlloo.LoanStatus.Pending,
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
        _loansByStatus[IUnlloo.LoanStatus.Pending].add(
            _loanStatusIndex[IUnlloo.LoanStatus.Pending],
            loanId,
            IUnlloo.LoanStatus.Pending
        );

        openRequestCount[msg.sender] += 1;
        lastRequestBlock[msg.sender] = block.number;

        emit IUnlloo.LoanRequestSubmitted(
            loanId,
            msg.sender,
            walletReputation,
            loanAmount,
            loanDurationBlocks,
            block.number
        );
    }

    /**
     * @notice Owner-only expiry for Approved requests (prevents permanent openRequestCount lock)
     */
    function expireApprovedLoan(uint256 loanId) external onlyOwner loanExists(loanId) {
        IUnlloo.Loan storage loan = loans[loanId];
        if (loan.status != IUnlloo.LoanStatus.Approved)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Approved));

        uint256 expiryBlock = loan.approvalBlock + approvedLoanExpiryBlocks;
        if (block.number <= expiryBlock) {
            revert UnllooErrors.ApprovedLoanNotExpired(loanId, block.number, expiryBlock);
        }

        loan.status = IUnlloo.LoanStatus.Rejected;

        _loansByStatus[IUnlloo.LoanStatus.Approved].remove(
            _loanStatusIndex[IUnlloo.LoanStatus.Approved],
            loanId,
            IUnlloo.LoanStatus.Approved
        );
        _loansByStatus[IUnlloo.LoanStatus.Rejected].add(
            _loanStatusIndex[IUnlloo.LoanStatus.Rejected],
            loanId,
            IUnlloo.LoanStatus.Rejected
        );

        if (openRequestCount[loan.borrower] > 0) openRequestCount[loan.borrower] -= 1;

        emit IUnlloo.LoanRequestRejected(loanId, loan.borrower, block.number);
    }

    // ============ Borrowing Functions ============
    /**
     * @notice Execute borrowing on an approved loan
     */
    function borrow(
        uint256 loanId,
        uint256 tokenAmount
    ) external whenNotPaused nonReentrant loanExists(loanId) onlyBorrower(loanId) {
        IUnlloo.Loan storage loan = loans[loanId];

        if (loan.status != IUnlloo.LoanStatus.Approved)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Approved));
        if (tokenAmount == 0) revert UnllooErrors.InvalidAmount(tokenAmount, 1, type(uint256).max);

        uint256 expiryBlock = loan.approvalBlock + approvedLoanExpiryBlocks;
        if (block.number > expiryBlock)
            revert UnllooErrors.ApprovedLoanExpired(loanId, loan.approvalBlock, expiryBlock);

        if (_activeLoanByBorrower[msg.sender] != 0) revert UnllooErrors.HasActiveLoan(msg.sender);

        address token = loan.token;
        if (token == address(0) || pools[token].token == address(0)) revert UnllooErrors.InvalidPool(token);

        uint256 maxTokenAmount = getApprovedLoanAmount(loanId);
        if (tokenAmount > maxTokenAmount) revert UnllooErrors.InvalidAmount(tokenAmount, 1, maxTokenAmount);

        IUnlloo.LiquidityPool storage pool = pools[token];

        if (pool.borrowedAmount > pool.totalLiquidity) revert UnllooErrors.InsufficientLiquidity(tokenAmount, 0);
        uint256 freeLiquidity = pool.totalLiquidity - pool.borrowedAmount;
        if (tokenAmount > freeLiquidity) revert UnllooErrors.InsufficientLiquidity(tokenAmount, freeLiquidity);

        if (loan.loanDurationBlocks > MAX_BLOCKS_FOR_INTEREST) {
            revert UnllooErrors.InvalidDuration(loan.loanDurationBlocks, 1, MAX_BLOCKS_FOR_INTEREST);
        }

        // Calculate fixed borrow rate based on current utilization
        uint256 borrowRateBps = _calculateBorrowRate(token);

        loanInitialPrincipal[loanId] = tokenAmount;

        loan.status = IUnlloo.LoanStatus.Active;
        loan.principal = tokenAmount;
        loan.amountRepaid = 0;
        loan.startBlock = block.number;
        loan.deadlineBlock = block.number + loan.loanDurationBlocks;
        loan.protocolFee = 0;
        loan.interestAccrued = 0;
        loan.borrowRateBps = borrowRateBps; // Fixed rate for loan lifetime
        loan.lastAccrualBlock = block.number; // Initialize accrual tracking

        _loansByStatus[IUnlloo.LoanStatus.Approved].remove(
            _loanStatusIndex[IUnlloo.LoanStatus.Approved],
            loanId,
            IUnlloo.LoanStatus.Approved
        );
        _loansByStatus[IUnlloo.LoanStatus.Active].add(
            _loanStatusIndex[IUnlloo.LoanStatus.Active],
            loanId,
            IUnlloo.LoanStatus.Active
        );

        _activeLoanByBorrower[loan.borrower] = loanId;

        if (openRequestCount[loan.borrower] > 0) openRequestCount[loan.borrower] -= 1;

        pool.borrowedAmount += tokenAmount;
        activeLoansPerPool[token] += 1;

        _safeTransferExact(token, msg.sender, tokenAmount);

        // Calculate expected interest using simple interest for event
        // Formula: I = P * r * t where t = blocksElapsed / blocksPerYear
        // Multiply first, divide last to avoid precision loss:
        // expectedInterest = (tokenAmount * borrowRateBps * loanDurationBlocks * blockTimeSeconds) / (10000 * SECONDS_PER_YEAR)
        uint256 expectedInterest = (tokenAmount * borrowRateBps * loan.loanDurationBlocks * blockTimeSeconds) /
            (10000 * SECONDS_PER_YEAR);
        uint256 expectedTotalOwed = tokenAmount + expectedInterest;

        emit IUnlloo.LoanBorrowed(loanId, msg.sender, token, tokenAmount, expectedTotalOwed, block.number);
    }

    /**
     * @notice Get the maximum approved amount for a loan
     */
    function getApprovedLoanAmount(uint256 loanId) public view loanExists(loanId) returns (uint256 approvedAmount) {
        IUnlloo.Loan memory loan = loans[loanId];
        if (loan.status != IUnlloo.LoanStatus.Approved && loan.status != IUnlloo.LoanStatus.Pending) return 0;
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
    function markLoanOverdue(uint256 loanId) external loanExists(loanId) {
        IUnlloo.Loan storage loan = loans[loanId];
        if (loan.status != IUnlloo.LoanStatus.Active)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Active));
        // Sentinel check: loan not yet started (startBlock == 0) or invalid duration
        if (loan.startBlock == 0 || loan.loanDurationBlocks == 0)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Active));

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);
        if (block.number < deadline) revert UnllooErrors.InvalidDuration(block.number, deadline, type(uint256).max);

        _transitionToUnpaidDebt(loanId, loan, deadline);
    }

    /**
     * @notice Make a repayment on an active loan
     * @dev **Pause Behavior:** This function is intentionally NOT pausable to allow borrowers
     *      to repay debts during emergencies. Preventing repayments during pause could unfairly
     *      penalize borrowers with accruing interest while they cannot act.
     */
    function repay(uint256 loanId, uint256 amount) external nonReentrant loanExists(loanId) {
        IUnlloo.Loan storage loan = loans[loanId];

        _validateRepaymentConditions(loan, amount);

        // Accrue simple interest before any operations
        _accrueLoanInterest(loanId);

        // If overdue, transition to UnpaidDebt in storage
        _checkAndTransitionOverdue(loanId, loan);

        // Calculate payment amounts
        (uint256 payAmount, uint256 interestPayment, uint256 principalPayment) = _calculateRepaymentSplit(loan, amount);

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

        emit IUnlloo.LoanRepaid(loanId, msg.sender, loan.token, payAmount, newTotalDue, block.number);
    }

    // ============ Liquidity Pool Functions ============
    /**
     * @notice Deposit liquidity into a token pool to earn yield
     */
    function depositLiquidity(address token, uint256 amount) external whenNotPaused nonReentrant validPool(token) {
        if (amount == 0) revert UnllooErrors.InvalidAmount(amount, 1, type(uint256).max);

        uint256 allowance = IERC20(token).allowance(msg.sender, address(this));
        if (allowance < amount) revert UnllooErrors.InsufficientAllowance(amount, allowance);

        _distributePendingInterest(token);
        _updateLenderAccrual(msg.sender, token);

        IUnlloo.LenderPosition storage position = lenderPositions[msg.sender][token];
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

        emit IUnlloo.LiquidityDeposited(msg.sender, token, amount, block.number);
    }

    /**
     * @notice Withdraw liquidity (principal + earned interest) from a pool
     */
    function withdrawLiquidity(address token, uint256 amount) external whenNotPaused nonReentrant validPool(token) {
        if (amount == 0) revert UnllooErrors.InvalidAmount(amount, 1, type(uint256).max);

        _distributePendingInterest(token);
        _updateLenderAccrual(msg.sender, token);

        IUnlloo.LenderPosition storage position = lenderPositions[msg.sender][token];
        if (position.lender == address(0) || position.depositedAmount == 0)
            revert UnllooErrors.InvalidAmount(amount, 1, 0);
        if (amount > position.depositedAmount) revert UnllooErrors.InvalidAmount(amount, 1, position.depositedAmount);

        IUnlloo.LiquidityPool storage pool = pools[token];
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
        if (balance - totalPayout < protocolFees[token])
            revert UnllooErrors.NotEnoughCash(totalPayout, balance - protocolFees[token]);

        _safeTransferExact(token, msg.sender, totalPayout);

        emit IUnlloo.LiquidityWithdrawn(msg.sender, token, amount, interestToPay, totalPayout, block.number);
    }

    /**
     * @notice Get lender position with calculated interest
     */
    function getLenderPosition(
        address lender,
        address token
    ) external view returns (uint256 depositedAmount, uint256 accruedInterest, uint256 totalWithdrawable) {
        IUnlloo.LenderPosition memory position = lenderPositions[lender][token];
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

    // ============ Public: hasUnpaidDebt (thin wrapper over UnllooStorage internal) ============
    /**
     * @notice Check if a user has any unpaid debt.
     * @dev Public wrapper around the inherited _hasUnpaidDebt internal function from
     *      UnllooStorage. submitLoanRequest calls this directly. Ext's canSubmitRequest
     *      calls _hasUnpaidDebt directly (no cross-boundary call needed).
     * @param user Address to check
     * @return True if user has a loan in UnpaidDebt status (or is virtually overdue)
     */
    function hasUnpaidDebt(address user) public view returns (bool) {
        return _hasUnpaidDebt(user);
    }

    // ============ Internal: Simple Interest ============

    /// @notice Accrue simple interest on a loan
    /// @dev Simple interest formula: I = P * r * t
    ///      Updates loan.interestAccrued but NOT lastAccrualBlock.
    ///      lastAccrualBlock is only updated when interest is fully settled (in _processInterestPayment).
    ///      This ensures continuous interest accrual regardless of principal payments.
    /// @param loanId The loan ID to accrue interest on
    function _accrueLoanInterest(uint256 loanId) internal {
        IUnlloo.Loan storage loan = loans[loanId];
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
        uint256 interest = (loan.principal * loan.borrowRateBps * blocksElapsed * blockTimeSeconds) /
            (10000 * SECONDS_PER_YEAR);

        loan.interestAccrued += interest;
        // DO NOT update lastAccrualBlock here - it's only updated when interest is fully settled
    }

    /// @notice Get accrued interest for a loan (view function)
    /// @dev Delegates to the UnllooStorage shared _interestDue function.
    /// @param loanId The loan ID to calculate interest for
    /// @return Total accrued interest including any new interest since last accrual
    function _getAccruedInterest(uint256 loanId) internal view returns (uint256) {
        return _interestDue(loanId);
    }

    // ============ Internal: Repayment helpers ============

    /// @notice Validates all preconditions required for a valid repayment
    function _validateRepaymentConditions(IUnlloo.Loan storage loan, uint256 amount) internal view {
        if (loan.status != IUnlloo.LoanStatus.Active && loan.status != IUnlloo.LoanStatus.UnpaidDebt) {
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Active));
        }
        if (amount == 0) revert UnllooErrors.InvalidAmount(amount, 1, type(uint256).max);
        if (loan.token == address(0) || pools[loan.token].token == address(0)) {
            revert UnllooErrors.InvalidPool(loan.token);
        }
        // Sentinel check: loan not yet started (startBlock == 0)
        if (loan.startBlock == 0) {
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.Active));
        }
    }

    /// @dev Checks if loan is overdue and transitions to UnpaidDebt in storage if necessary
    function _checkAndTransitionOverdue(uint256 loanId, IUnlloo.Loan storage loan) internal {
        if (loan.status != IUnlloo.LoanStatus.Active) return;

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);

        if (block.number >= deadline) {
            _transitionToUnpaidDebt(loanId, loan, deadline);
        }
    }

    /// @notice Calculates how to split a repayment between interest and principal
    function _calculateRepaymentSplit(
        IUnlloo.Loan storage loan,
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
    function _processInterestPayment(IUnlloo.Loan storage loan, uint256 interestPayment) internal {
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
        if (loan.interestAccrued == 0) {
            loan.lastAccrualBlock = block.number;
        }
    }

    /// @notice Applies a principal payment to a loan and updates pool accounting
    function _applyPrincipalPayment(IUnlloo.Loan storage loan, uint256 principalPayment) internal {
        // Cap at actual principal to prevent underflow
        if (principalPayment > loan.principal) {
            principalPayment = loan.principal;
        }

        loan.principal -= principalPayment;

        // Update pool borrowedAmount
        IUnlloo.LiquidityPool storage pool = pools[loan.token];
        if (principalPayment > pool.borrowedAmount) {
            pool.borrowedAmount = 0;
        } else {
            pool.borrowedAmount -= principalPayment;
        }

        // DO NOT reset lastAccrualBlock here - it should only update when interest is fully settled
    }

    /// @notice Checks if loan is fully repaid and transitions to Repaid status if so
    function _checkAndFinalizeRepayment(
        uint256 loanId,
        IUnlloo.Loan storage loan
    ) internal returns (uint256 newTotalDue) {
        uint256 newAccrued = _getAccruedInterest(loanId);
        newTotalDue = loan.principal + newAccrued;

        // NOTE: We intentionally do NOT forgive principal "dust".
        if (loan.principal == 0 && newTotalDue == 0) {
            _finalizeRepaid(loanId, loan);
        }
    }

    // ============ Internal: Lender index ============
    /// @dev Distributes pending interest to the supply index
    function _distributePendingInterest(address token) internal {
        uint256 pending = poolUndistributedInterest[token];
        if (pending == 0) return;

        uint256 tl = pools[token].totalLiquidity;
        if (tl == 0) return;

        uint256 delta = (pending * INDEX_SCALE) / tl;
        if (delta == 0) return;

        uint256 distributed = (delta * tl) / INDEX_SCALE;
        uint256 dust = pending - distributed;
        poolUndistributedInterest[token] = dust;
        poolSupplyIndex[token] += delta;
    }

    function _updateLenderAccrual(address lender, address token) internal {
        uint256 idx = poolSupplyIndex[token];

        IUnlloo.LenderPosition memory pos = lenderPositions[lender][token];
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
    function _distributeInterestToLenders(address token, uint256 amount) internal {
        if (amount == 0) return;
        uint256 tl = pools[token].totalLiquidity;
        if (tl == 0) {
            poolUndistributedInterest[token] += amount;
            return;
        }

        uint256 delta = (amount * INDEX_SCALE) / tl;
        if (delta == 0) {
            poolUndistributedInterest[token] += amount;
            return;
        }

        uint256 distributed = (delta * tl) / INDEX_SCALE;
        uint256 dust = amount - distributed;
        poolUndistributedInterest[token] += dust;

        poolSupplyIndex[token] += delta;
    }

    // ============ Internal: Status transitions ============
    function _transitionToUnpaidDebt(uint256 loanId, IUnlloo.Loan storage loan, uint256 deadline) internal {
        if (loan.status != IUnlloo.LoanStatus.Active) return;

        loan.status = IUnlloo.LoanStatus.UnpaidDebt;
        loan.deadlineBlock = deadline;

        _loansByStatus[IUnlloo.LoanStatus.Active].remove(
            _loanStatusIndex[IUnlloo.LoanStatus.Active],
            loanId,
            IUnlloo.LoanStatus.Active
        );
        _loansByStatus[IUnlloo.LoanStatus.UnpaidDebt].add(
            _loanStatusIndex[IUnlloo.LoanStatus.UnpaidDebt],
            loanId,
            IUnlloo.LoanStatus.UnpaidDebt
        );

        unpaidDebtLoanCount[loan.borrower] += 1;

        if (_activeLoanByBorrower[loan.borrower] == loanId) _activeLoanByBorrower[loan.borrower] = 0;

        // per-pool counters
        address token = loan.token;
        if (activeLoansPerPool[token] > 0) activeLoansPerPool[token] -= 1;
        unpaidDebtLoansPerPool[token] += 1;

        emit IUnlloo.LoanMovedToUnpaidDebt(loanId, loan.borrower, loan.deadlineBlock, block.number);
    }

    function _finalizeRepaid(uint256 loanId, IUnlloo.Loan storage loan) internal {
        IUnlloo.LoanStatus beforeStatus = loan.status;
        loan.status = IUnlloo.LoanStatus.Repaid;

        if (beforeStatus == IUnlloo.LoanStatus.UnpaidDebt && unpaidDebtLoanCount[loan.borrower] > 0) {
            unpaidDebtLoanCount[loan.borrower] -= 1;
        }

        if (_activeLoanByBorrower[loan.borrower] == loanId) {
            _activeLoanByBorrower[loan.borrower] = 0;
        }

        // per-pool counters
        address token = loan.token;
        if (beforeStatus == IUnlloo.LoanStatus.Active) {
            if (activeLoansPerPool[token] > 0) activeLoansPerPool[token] -= 1;
        } else if (beforeStatus == IUnlloo.LoanStatus.UnpaidDebt) {
            if (unpaidDebtLoansPerPool[token] > 0) unpaidDebtLoansPerPool[token] -= 1;
        }

        _loansByStatus[beforeStatus].remove(_loanStatusIndex[beforeStatus], loanId, beforeStatus);
        _loansByStatus[IUnlloo.LoanStatus.Repaid].add(
            _loanStatusIndex[IUnlloo.LoanStatus.Repaid],
            loanId,
            IUnlloo.LoanStatus.Repaid
        );
    }

    // ============ Internal: Transfer helpers (strict ERC20) ============
    function _safeTransferFromExact(address token, address from, address to, uint256 amount) internal {
        uint256 beforeBal = IERC20(token).balanceOf(to);
        IERC20(token).safeTransferFrom(from, to, amount);
        uint256 afterBal = IERC20(token).balanceOf(to);
        if (afterBal - beforeBal != amount) revert UnllooErrors.UnsupportedTokenTransfer(token);
    }

    // ============ Internal Helper Functions ============
    function _getLoanLimits(
        address token
    ) internal view returns (uint256 minLoanAmountToken, uint256 maxLoanAmountToken) {
        minLoanAmountToken = minLoanAmountPerPool[token];
        maxLoanAmountToken = maxLoanAmountPerPool[token];
        if (minLoanAmountToken == 0 || maxLoanAmountToken == 0) {
            revert UnllooErrors.InvalidPoolLoanLimits(minLoanAmountToken, maxLoanAmountToken);
        }
    }

    // ============ Guarantor Functions ============

    /**
     * @notice Guarantor locks 100% collateral to back a borrower.
     * @dev Transfers collateralAmount from msg.sender to this contract.
     *      collateralAmount must be >= maxCoverageAmount (100% coverage required).
     * @param borrower Address of the borrower being backed
     * @param token ERC20 token address for the collateral (must be a valid pool token)
     * @param collateralAmount Amount to lock as collateral
     * @param maxCoverageAmount Maximum loan amount this bond will cover
     */
    function registerGuarantee(
        address borrower,
        address token,
        uint256 collateralAmount,
        uint256 maxCoverageAmount
    ) external whenNotPaused nonReentrant {
        if (msg.sender == borrower) revert UnllooErrors.CannotGuaranteeSelf();
        if (borrower == address(0)) revert UnllooErrors.InvalidAddress(borrower);
        _requireValidPool(token);
        if (collateralAmount == 0) revert UnllooErrors.InvalidAmount(collateralAmount, 1, type(uint256).max);
        if (maxCoverageAmount == 0) revert UnllooErrors.InvalidAmount(maxCoverageAmount, 1, type(uint256).max);
        if (collateralAmount < maxCoverageAmount)
            revert UnllooErrors.InsufficientBondCoverage(maxCoverageAmount, collateralAmount);

        IUnlloo.GuaranteeBond storage bond = guaranteeBonds[borrower][msg.sender];
        if (bond.active) revert UnllooErrors.GuaranteeAlreadyExists(msg.sender, borrower);

        uint256 allowance = IERC20(token).allowance(msg.sender, address(this));
        if (allowance < collateralAmount) revert UnllooErrors.InsufficientAllowance(collateralAmount, allowance);

        _safeTransferFromExact(token, msg.sender, address(this), collateralAmount);

        bond.guarantor = msg.sender;
        bond.borrower = borrower;
        bond.token = token;
        bond.lockedAmount = collateralAmount;
        bond.maxCoverageAmount = maxCoverageAmount;
        bond.active = true;

        _guaranteeIndex[msg.sender][borrower] = _guaranteesByGuarantor[msg.sender].length;
        _guaranteesByGuarantor[msg.sender].push(borrower);

        _guarantorIndex[borrower][msg.sender] = _guarantorsForBorrower[borrower].length;
        _guarantorsForBorrower[borrower].push(msg.sender);

        emit IUnlloo.GuaranteeRegistered(msg.sender, borrower, token, collateralAmount, maxCoverageAmount, block.number);
    }

    /**
     * @notice Guarantor removes their bond and reclaims locked collateral.
     * @dev Reverts if borrower has an active or unpaid loan — guarantor must stay until debt is cleared.
     * @param borrower Address of the backed borrower
     */
    function removeGuarantee(address borrower) external nonReentrant {
        IUnlloo.GuaranteeBond storage bond = guaranteeBonds[borrower][msg.sender];
        if (!bond.active) revert UnllooErrors.BondNotActive(msg.sender, borrower);

        if (_activeLoanByBorrower[borrower] != 0) revert UnllooErrors.BorrowerHasOpenLoan(borrower);
        if (unpaidDebtLoanCount[borrower] != 0) revert UnllooErrors.BorrowerHasOpenLoan(borrower);

        uint256 refundAmount = bond.lockedAmount;
        address token = bond.token;

        _removeGuaranteeFromArrays(msg.sender, borrower);
        delete guaranteeBonds[borrower][msg.sender];

        if (refundAmount > 0) {
            _safeTransferExact(token, msg.sender, refundAmount);
        }

        emit IUnlloo.GuaranteeRemoved(msg.sender, borrower, refundAmount, block.number);
    }

    /**
     * @notice Guarantor voluntarily covers a defaulted borrower's outstanding debt.
     * @dev The bond's locked collateral is used to repay — no additional token transfer needed.
     *      Any leftover collateral after full repayment is returned to the guarantor.
     * @param loanId ID of the Active or UnpaidDebt loan to cover
     */
    function guarantorCoverDebt(uint256 loanId) external nonReentrant loanExists(loanId) {
        IUnlloo.Loan storage loan = loans[loanId];

        if (loan.status != IUnlloo.LoanStatus.UnpaidDebt && loan.status != IUnlloo.LoanStatus.Active)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.UnpaidDebt));

        address borrower = loan.borrower;
        IUnlloo.GuaranteeBond storage bond = guaranteeBonds[borrower][msg.sender];
        if (!bond.active) revert UnllooErrors.BondNotActive(msg.sender, borrower);

        _accrueLoanInterest(loanId);
        _checkAndTransitionOverdue(loanId, loan);

        uint256 totalOwed = loan.principal + loan.interestAccrued;
        if (totalOwed == 0) revert UnllooErrors.InvalidAmount(0, 1, type(uint256).max);

        uint256 coverAmount = totalOwed > bond.lockedAmount ? bond.lockedAmount : totalOwed;

        (uint256 payAmount, uint256 interestPayment, uint256 principalPayment) = _calculateRepaymentSplit(loan, coverAmount);

        if (interestPayment > 0) _processInterestPayment(loan, interestPayment);
        loan.amountRepaid += payAmount;
        if (principalPayment > 0) _applyPrincipalPayment(loan, principalPayment);

        bond.lockedAmount -= payAmount;

        _checkAndFinalizeRepayment(loanId, loan);

        // If bond exhausted or loan fully repaid, close the bond
        if (bond.lockedAmount == 0 || loan.status == IUnlloo.LoanStatus.Repaid) {
            uint256 leftover = bond.lockedAmount;
            address token = bond.token;
            _removeGuaranteeFromArrays(msg.sender, borrower);
            delete guaranteeBonds[borrower][msg.sender];
            if (leftover > 0) {
                _safeTransferExact(token, msg.sender, leftover);
            }
        }

        emit IUnlloo.GuarantorCoveredDebt(loanId, msg.sender, borrower, payAmount, block.number);
    }

    /**
     * @notice Admin seizes a guarantor bond to cover a defaulted loan after the grace period.
     * @dev Only callable by owner. Grace period starts at loan.deadlineBlock.
     *      Uses the bond's locked collateral as repayment — no token transfer to contract needed.
     *      Any leftover collateral is returned to the guarantor.
     * @param loanId ID of the defaulted (UnpaidDebt) loan
     * @param guarantor Address of the guarantor whose bond to seize
     */
    function seizeGuarantorBond(uint256 loanId, address guarantor) external onlyOwner nonReentrant loanExists(loanId) {
        IUnlloo.Loan storage loan = loans[loanId];

        if (loan.status != IUnlloo.LoanStatus.UnpaidDebt && loan.status != IUnlloo.LoanStatus.Active)
            revert UnllooErrors.InvalidLoanStatus(uint8(loan.status), uint8(IUnlloo.LoanStatus.UnpaidDebt));

        address borrower = loan.borrower;
        IUnlloo.GuaranteeBond storage bond = guaranteeBonds[borrower][guarantor];
        if (!bond.active) revert UnllooErrors.BondNotActive(guarantor, borrower);

        uint256 deadline = loan.deadlineBlock != 0 ? loan.deadlineBlock : (loan.startBlock + loan.loanDurationBlocks);
        uint256 gracePeriodEnd = deadline + guarantorGracePeriodBlocks;
        if (block.number < gracePeriodEnd) revert UnllooErrors.GracePeriodNotExpired(block.number, gracePeriodEnd);

        _accrueLoanInterest(loanId);
        _checkAndTransitionOverdue(loanId, loan);

        uint256 totalOwed = loan.principal + loan.interestAccrued;
        uint256 seizeAmount = totalOwed > bond.lockedAmount ? bond.lockedAmount : totalOwed;

        (uint256 payAmount, uint256 interestPayment, uint256 principalPayment) = _calculateRepaymentSplit(loan, seizeAmount);

        if (interestPayment > 0) _processInterestPayment(loan, interestPayment);
        loan.amountRepaid += payAmount;
        if (principalPayment > 0) _applyPrincipalPayment(loan, principalPayment);

        bond.lockedAmount -= payAmount;

        uint256 leftover = bond.lockedAmount;
        address token = bond.token;

        _checkAndFinalizeRepayment(loanId, loan);

        _removeGuaranteeFromArrays(guarantor, borrower);
        delete guaranteeBonds[borrower][guarantor];

        if (leftover > 0) {
            _safeTransferExact(token, guarantor, leftover);
        }

        emit IUnlloo.GuarantorBondSeized(loanId, guarantor, borrower, payAmount, block.number);
    }

    // ============ Internal: Guarantor Helpers ============

    /**
     * @dev Swap-and-pop removal from both index arrays.
     *      Keeps O(1) removal without leaving gaps.
     */
    function _removeGuaranteeFromArrays(address guarantor, address borrower) internal {
        // Remove from _guaranteesByGuarantor
        address[] storage gArr = _guaranteesByGuarantor[guarantor];
        uint256 gIdx = _guaranteeIndex[guarantor][borrower];
        uint256 gLast = gArr.length - 1;
        if (gIdx != gLast) {
            address moved = gArr[gLast];
            gArr[gIdx] = moved;
            _guaranteeIndex[guarantor][moved] = gIdx;
        }
        gArr.pop();
        delete _guaranteeIndex[guarantor][borrower];

        // Remove from _guarantorsForBorrower
        address[] storage bArr = _guarantorsForBorrower[borrower];
        uint256 bIdx = _guarantorIndex[borrower][guarantor];
        uint256 bLast = bArr.length - 1;
        if (bIdx != bLast) {
            address moved = bArr[bLast];
            bArr[bIdx] = moved;
            _guarantorIndex[borrower][moved] = bIdx;
        }
        bArr.pop();
        delete _guarantorIndex[borrower][guarantor];
    }

}
