// Token operations
export { mintAndApproveUSDC, mintTokens, approveTokens } from "./tokenHelpers";

// Loan operations
export {
  submitLoanRequestHelper,
  createAndApproveLoan,
  setupCompleteBorrow,
  repayFully,
  repayPartial,
  type LoanSetupResult,
} from "./loanHelpers";

// Liquidity operations
export {
  depositLiquidity,
  withdrawLiquidity,
  withdrawAllLiquidity,
  getLenderPosition,
  getPoolUtilization,
  getFreeLiquidity,
  type LenderPosition,
} from "./liquidityHelpers";

// Calculations and verification
export {
  calculateExpectedInterest,
  calculateProtocolFee,
  calculateLenderSurplus,
  getContractBalanceAccounting,
  verifyEconomicBalance,
  verifyInterestDistribution,
  assertNoDuplicates,
  type BalanceAccounting,
} from "./calculationHelpers";
