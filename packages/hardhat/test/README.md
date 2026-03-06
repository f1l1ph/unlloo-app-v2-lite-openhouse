# Unlloo Test Suite

This directory contains the comprehensive test suite for the Unlloo lending protocol smart contracts.

## Test Architecture

### Shared Infrastructure

```
test/
├── fixtures/
│   ├── constants.ts       # Centralized test constants
│   └── UnllooTestFixture.ts # Shared test fixture setup
├── helpers/
│   ├── index.ts           # Helper exports
│   ├── tokenHelpers.ts    # Token minting/approval utilities
│   ├── loanHelpers.ts     # Loan creation/management utilities
│   ├── liquidityHelpers.ts # Liquidity pool utilities
│   └── calculationHelpers.ts # Interest/fee calculation utilities
```

### Test Files by Domain

| File | Focus Area | Description |
|------|------------|-------------|
| `Unlloo.ts` | Core Functionality | Main test file covering deployment, loan lifecycle, liquidity pools, admin functions |
| `UnllooApprovedExpiry.ts` | Loan Expiry | Tests for `expireApprovedLoan()` admin escape hatch |
| `UnllooComprehensiveTests.ts` | Edge Cases | Comprehensive reentrancy, state transitions, boundary tests |
| `UnllooCoverageImprovements.ts` | Coverage | Tests targeting specific coverage gaps and negative cases |
| `UnllooEconomy.ts` | Economics | Economic balance, protocol fees, fairness verification |
| `UnllooEdgeCasesAndMathematicalVerification.ts` | Math | Mathematical correctness verification |
| `UnllooETHPath.ts` | ETH Handling | Native ETH receive/withdraw functionality |
| `UnllooIntegrationAndStressTests.ts` | Integration | Multi-actor scenarios, stress tests, gas optimization |
| `UnllooMultiPool.ts` | Multi-Token | Token isolation across multiple liquidity pools |
| `UnllooSecurityExploits.ts` | Security | White-hat attack vector testing |
| `UnllooSecurityHardeningFuzz.ts` | Adversarial | Adversarial tokens, reentrancy, pseudo-fuzz |
| `UnllooStatusBookkeeping.ts` | State | `loansByStatus` array integrity verification |
| `UnllooSupplyIndexFairness.ts` | Lender Yield | Supply index and interest distribution fairness |
| `UnllooSurplusCalculation.ts` | Surplus | Withdrawal surplus calculation correctness |
| `UnllooVariableRateSemantics.ts` | Fixed Rates | Proof that rates are fixed at borrow time |
| `UnllooViewFunctionsAndEvents.ts` | Views & Events | View function accuracy and event emission |

## Usage

### Running All Tests
```bash
yarn test
```

### Running Specific Test File
```bash
yarn test test/Unlloo.ts
```

### Running with Coverage
```bash
yarn coverage
```

### Running with Gas Report
```bash
REPORT_GAS=true yarn test
```

## Writing New Tests

### 1. Import the Fixture and Helpers

```typescript
import { setupUnllooTestFixture, UnllooTestContext } from "./fixtures/UnllooTestFixture";
import { mintAndApproveUSDC, setupCompleteBorrow, repayFully } from "./helpers";
import * as constants from "./fixtures/constants";
```

### 2. Use the Fixture in beforeEach

```typescript
describe("My New Test Suite", function () {
  let ctx: UnllooTestContext;

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
  });

  it("should test something", async function () {
    const { unlloo, usdc, borrower1, lender1, owner } = ctx;
    // Use helpers for common operations
    const { loanId } = await setupCompleteBorrow(unlloo, usdc, borrower1, lender1, owner);
    // ... assertions
  });
});
```

### 3. Available Helpers

#### Token Helpers
- `mintAndApproveUSDC(token, user, amount, spender)` - Mint and approve tokens
- `mintTokens(token, user, amount)` - Just mint
- `approveTokens(token, user, spender, amount)` - Just approve

#### Loan Helpers
- `submitLoanRequestHelper(unlloo, token, borrower, reputation, amountUSD, durationBlocks)` - Submit loan request
- `createAndApproveLoan(unlloo, token, borrower, owner, reputation?, amountUSD?, durationBlocks?)` - Create & approve
- `setupCompleteBorrow(unlloo, token, borrower, lender, owner, loanAmountUSD?, liquidityAmount?, durationBlocks?)` - Full borrow setup
- `repayFully(unlloo, token, borrower, loanId)` - Full repayment
- `repayPartial(unlloo, token, borrower, loanId, amount)` - Partial repayment

#### Liquidity Helpers
- `depositLiquidity(unlloo, token, lender, amount)` - Deposit
- `withdrawLiquidity(unlloo, token, lender, amount)` - Withdraw
- `getLenderPosition(unlloo, lender, token)` - Get position details
- `getPoolUtilization(unlloo, token)` - Get utilization rate
- `getFreeLiquidity(unlloo, token)` - Get available liquidity

#### Calculation Helpers
- `calculateExpectedInterest(principal, blocksElapsed, rateBps)` - Simple interest
- `calculateProtocolFee(interest, feeBps?)` - Protocol fee
- `calculateLenderSurplus(interest, feeBps?)` - Lender share
- `verifyEconomicBalance(unlloo, token, tokenAddress, description)` - Verify balance
- `assertNoDuplicates(ids, label)` - Check array uniqueness

## Constants

All test constants are centralized in `fixtures/constants.ts`:

```typescript
// Gas limits
COVERAGE_GAS_LIMIT  // 5,000,000n
DEPLOYMENT_GAS_LIMIT // 20,000,000n

// Token config
USDC_DECIMALS       // 6
BLOCK_TIME_SECONDS  // 2

// Reputation
VALID_REPUTATION    // 500
MIN_REPUTATION      // 200
MAX_REPUTATION      // 1000

// Loan amounts
MIN_LOAN_AMOUNT_USD // 10
MAX_LOAN_AMOUNT_USD // 100,000

// Block constants
BLOCKS_PER_DAY      // ~43,200
BLOCKS_30_DAYS
BLOCKS_60_DAYS
BLOCKS_PER_YEAR

// Loan status enum
LoanStatus.Pending   // 0
LoanStatus.Approved  // 1
LoanStatus.Active    // 2
LoanStatus.UnpaidDebt // 3
LoanStatus.Rejected  // 4
LoanStatus.Repaid    // 5
```

