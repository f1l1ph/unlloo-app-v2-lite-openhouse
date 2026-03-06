import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../../typechain-types";
import { COVERAGE_GAS_LIMIT } from "../fixtures/constants";

export async function mintAndApproveUSDC(
  token: MockERC20,
  user: HardhatEthersSigner,
  amount: bigint,
  spender: string,
): Promise<void> {
  await token.mint(user.address, amount, { gasLimit: COVERAGE_GAS_LIMIT });
  await token.connect(user).approve(spender, amount, { gasLimit: COVERAGE_GAS_LIMIT });
}

export async function mintTokens(token: MockERC20, user: HardhatEthersSigner, amount: bigint): Promise<void> {
  await token.mint(user.address, amount, { gasLimit: COVERAGE_GAS_LIMIT });
}

export async function approveTokens(
  token: MockERC20,
  user: HardhatEthersSigner,
  spender: string,
  amount: bigint,
): Promise<void> {
  await token.connect(user).approve(spender, amount, { gasLimit: COVERAGE_GAS_LIMIT });
}
