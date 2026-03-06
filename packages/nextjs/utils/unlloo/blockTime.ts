/**
 * Utility functions for converting block times to human-readable format
 */

/**
 * Converts blocks to human-readable time format (days, hours, minutes)
 * @param blocks Number of blocks
 * @param blockTimeSeconds Block time in seconds
 * @returns Human-readable string like "2 days, 3 hours, 15 minutes"
 */
export function blocksToHumanReadable(blocks: bigint | number, blockTimeSeconds: bigint | number): string {
  const blocksNum = typeof blocks === "bigint" ? Number(blocks) : blocks;
  const blockTimeNum = typeof blockTimeSeconds === "bigint" ? Number(blockTimeSeconds) : blockTimeSeconds;

  if (blocksNum <= 0 || blockTimeNum <= 0) {
    return "0 minutes";
  }

  const totalSeconds = blocksNum * blockTimeNum;
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }
  if (parts.length === 0 && seconds > 0) {
    parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  }

  if (parts.length === 0) {
    return "0 minutes";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  // For 3+ parts, join with commas and "and" before the last one
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Converts blocks to days (simple conversion)
 * @param blocks Number of blocks
 * @param blockTimeSeconds Block time in seconds
 * @returns Number of days
 */
export function blocksToDays(blocks: bigint | number, blockTimeSeconds: bigint | number): number {
  const blocksNum = typeof blocks === "bigint" ? Number(blocks) : blocks;
  const blockTimeNum = typeof blockTimeSeconds === "bigint" ? Number(blockTimeSeconds) : blockTimeSeconds;
  const totalSeconds = blocksNum * blockTimeNum;
  return Math.round(totalSeconds / 86400); // 86400 = 24 * 60 * 60
}

/**
 * Converts blocks remaining to human-readable time format
 * @param blocksRemaining Number of blocks remaining
 * @param blockTimeSeconds Block time in seconds
 * @returns Human-readable string or "Overdue" if negative
 */
export function blocksRemainingToHumanReadable(
  blocksRemaining: bigint | number,
  blockTimeSeconds: bigint | number,
): string {
  const blocksNum = typeof blocksRemaining === "bigint" ? Number(blocksRemaining) : blocksRemaining;

  if (blocksNum <= 0) {
    return "Overdue";
  }

  return blocksToHumanReadable(blocksNum, blockTimeSeconds);
}

/**
 * Converts a block number difference to human-readable time format
 * @param startBlock Starting block number
 * @param endBlock Ending block number (or current block)
 * @param blockTimeSeconds Block time in seconds
 * @returns Human-readable string
 */
export function blockDifferenceToHumanReadable(
  startBlock: bigint | number,
  endBlock: bigint | number,
  blockTimeSeconds: bigint | number,
): string {
  const startNum = typeof startBlock === "bigint" ? Number(startBlock) : startBlock;
  const endNum = typeof endBlock === "bigint" ? Number(endBlock) : endBlock;
  const blocks = endNum - startNum;

  return blocksToHumanReadable(blocks, blockTimeSeconds);
}
