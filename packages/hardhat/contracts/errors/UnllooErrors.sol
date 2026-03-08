// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/**
 * @title UnllooErrors
 * @notice Shared error definitions for Unlloo contract and libraries
 * @dev Prevents duplicate error definitions and centralizes error management
 */
library UnllooErrors {
    // ============ Loan Errors ============
    error LoanNotFound(uint256 loanId);
    error LoanAlreadyInStatus(uint256 loanId, uint8 status);
    error NotBorrower(address caller, address borrower);
    error InvalidLoanStatus(uint8 current, uint8 required);

    // ============ Amount / Duration Errors ============
    error InvalidAmount(uint256 amount, uint256 min, uint256 max);
    error InvalidDuration(uint256 duration, uint256 min, uint256 max);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error NotEnoughCash(uint256 requested, uint256 available);

    // ============ Borrower Eligibility Errors ============
    error CooldownNotExpired(address user, uint256 cooldownEndBlock);
    error HasUnpaidDebt(address user);
    error HasActiveLoan(address user);
    error ExceedsMaxPendingLoans(address user);
    error InvalidReputation(uint16 reputation, uint16 min);

    // ============ Pool Errors ============
    error InvalidPool(address token);
    error PoolExists(address token);
    error PoolNotEmpty(address token);
    error ActiveLoansUsingPool(address token);
    error InvalidPoolLoanLimits(uint256 minAmount, uint256 maxAmount);

    // ============ Rate / Config Errors ============
    error InvalidBlockTime(uint256 blockTime);
    error InvalidRateCurveParam(address token, string paramName, uint256 value);

    // ============ Approval / Expiry Errors ============
    error ApprovedLoanExpired(uint256 loanId, uint256 approvalBlock, uint256 expiryBlock);
    error ApprovedLoanNotExpired(uint256 loanId, uint256 currentBlock, uint256 expiryBlock);
    error InsufficientAllowance(uint256 required, uint256 actual);

    // ============ Initialization Errors ============
    error InvalidOwner(address owner);
    error InvalidDefaultToken(address token);
    error InvalidAddress(address addr);

    // ============ Transfer Errors ============
    error UnsupportedTokenTransfer(address token);

    // ============ Guarantor Errors ============
    error GuaranteeAlreadyExists(address guarantor, address borrower);
    error GuaranteeNotFound(address guarantor, address borrower);
    error BorrowerHasOpenLoan(address borrower);
    error CannotGuaranteeSelf();
    error NotAGuarantor(address caller, address borrower);
}
