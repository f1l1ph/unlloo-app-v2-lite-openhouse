export const COVERAGE_GAS_LIMIT = 5_000_000n;
export const DEPLOYMENT_GAS_LIMIT = 15_000_000n; // Reduced to stay below Hardhat's transaction gas cap (16,777,216)

export const BLOCK_TIME_SECONDS = 2;
export const USDC_DECIMALS = 6;
export const PRICE_FEED_DECIMALS = 8;
export const USDC_PRICE = 1e8;

export const VALID_REPUTATION = 500;
export const MIN_REPUTATION = 200;
export const MAX_REPUTATION = 1000;

export const PROTOCOL_FEE_BPS = 2500;
export const MIN_BORROWER_RATE_BPS = 500;
export const MAX_BORROWER_RATE_BPS = 5000;

export const MIN_LOAN_AMOUNT_USD = 10;
export const MAX_LOAN_AMOUNT_USD = 100_000;

export const BLOCKS_PER_DAY = BigInt((24 * 60 * 60) / BLOCK_TIME_SECONDS);
export const BLOCKS_7_DAYS = BLOCKS_PER_DAY * 7n;
export const BLOCKS_30_DAYS = BLOCKS_PER_DAY * 30n;
export const BLOCKS_60_DAYS = BLOCKS_PER_DAY * 60n;
export const BLOCKS_PER_YEAR = BigInt((365 * 24 * 60 * 60) / BLOCK_TIME_SECONDS);

export const INDEX_SCALE = 10n ** 18n;

export const LoanStatus = {
  Pending: 0,
  Approved: 1,
  Active: 2,
  UnpaidDebt: 3,
  Rejected: 4,
  Repaid: 5,
} as const;

export type LoanStatusType = (typeof LoanStatus)[keyof typeof LoanStatus];

export function parseUSDC(amount: string | number): bigint {
  const [whole, decimal = ""] = String(amount).split(".");
  const paddedDecimal = decimal.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return BigInt(whole + paddedDecimal);
}

export function formatUSDC(amount: bigint): string {
  const str = amount.toString().padStart(USDC_DECIMALS + 1, "0");
  const whole = str.slice(0, -USDC_DECIMALS) || "0";
  const decimal = str.slice(-USDC_DECIMALS);
  return `${whole}.${decimal}`;
}
