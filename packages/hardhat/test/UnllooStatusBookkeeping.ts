import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20 } from "../typechain-types";
import { setupUnllooTestFixture, UnllooTestContext, UnllooCombined } from "./fixtures/UnllooTestFixture";
import * as constants from "./fixtures/constants";
import { mintAndApproveUSDC, repayFully, assertNoDuplicates } from "./helpers";

describe("Unlloo - Status Arrays & Per-Pool Counters Integrity", function () {
  let ctx: UnllooTestContext;
  let unlloo: UnllooCombined;
  let usdc: MockERC20;
  let usdcAddr: string;
  let owner: HardhatEthersSigner;
  let borrowers: HardhatEthersSigner[];
  let lenders: HardhatEthersSigner[];

  beforeEach(async function () {
    ctx = await setupUnllooTestFixture();
    unlloo = ctx.unlloo;
    usdc = ctx.usdc;
    usdcAddr = ctx.usdcAddress;
    owner = ctx.owner;

    const signers = await ethers.getSigners();
    // Use 6 distinct borrowers to avoid per-user constraints
    borrowers = [ctx.borrower1, ctx.borrower2, signers[5], signers[6], signers[7], signers[8]];
    lenders = [ctx.lender1, ctx.lender2];

    // Seed liquidity
    const liquidity = ethers.parseUnits("100000", constants.USDC_DECIMALS);
    for (const lender of lenders) {
      await mintAndApproveUSDC(usdc, lender, liquidity, ctx.unllooAddress);
      await unlloo.connect(lender).depositLiquidity(usdcAddr, liquidity, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
    }
  });

  it("Should keep loansByStatus arrays disjoint and counters consistent through transitions", async function () {
    const duration = await unlloo.minLoanDurationBlocks();
    const loanAmount = ethers.parseUnits("1000", constants.USDC_DECIMALS);

    // Create 4 loans (Pending -> Approved)
    const loanIds: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      await unlloo.connect(borrowers[i]).submitLoanRequest(constants.VALID_REPUTATION, usdcAddr, loanAmount, duration, {
        gasLimit: constants.COVERAGE_GAS_LIMIT,
      });
      const loanId = await unlloo.loanCounter();
      loanIds.push(loanId);
    }

    // Verify: Pending list has 4 unique loans
    const pending0 = await unlloo.loansByStatus(constants.LoanStatus.Pending);
    assertNoDuplicates(pending0, "Pending");
    expect(pending0.length).to.equal(4);

    // Approve all 4
    for (const id of loanIds) {
      await unlloo.connect(owner).approveLoanRequest(id, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    }

    // Verify: Pending empty, Approved has 4
    const pending1 = await unlloo.loansByStatus(constants.LoanStatus.Pending);
    const approved1 = await unlloo.loansByStatus(constants.LoanStatus.Approved);
    expect(pending1.length).to.equal(0);
    assertNoDuplicates(approved1, "Approved");
    expect(approved1.length).to.equal(4);

    // Borrow 2 loans -> Active should be 2
    await unlloo.connect(borrowers[0]).borrow(loanIds[0], loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });
    await unlloo.connect(borrowers[1]).borrow(loanIds[1], loanAmount, { gasLimit: constants.COVERAGE_GAS_LIMIT });

    const active = await unlloo.loansByStatus(constants.LoanStatus.Active);
    assertNoDuplicates(active, "Active");
    expect(active.length).to.equal(2);
    expect(await unlloo.activeLoansPerPool(usdcAddr)).to.equal(2);
    expect(await unlloo.unpaidDebtLoansPerPool(usdcAddr)).to.equal(0);

    // Mark one overdue -> Active--, UnpaidDebt++
    await mine(Number(duration) + 1);
    await unlloo.markLoanOverdue(loanIds[0], { gasLimit: constants.COVERAGE_GAS_LIMIT });

    const active2 = await unlloo.loansByStatus(constants.LoanStatus.Active);
    const unpaid = await unlloo.loansByStatus(constants.LoanStatus.UnpaidDebt);
    expect(active2.length).to.equal(1);
    expect(unpaid.length).to.equal(1);
    expect(await unlloo.activeLoansPerPool(usdcAddr)).to.equal(1);
    expect(await unlloo.unpaidDebtLoansPerPool(usdcAddr)).to.equal(1);

    // Repay overdue loan -> should move to Repaid, decrement unpaid counter
    await repayFully(unlloo, usdc, borrowers[0], loanIds[0]);

    const repaid = await unlloo.loansByStatus(constants.LoanStatus.Repaid);
    expect(repaid.map(x => x.toString())).to.include(loanIds[0].toString());
    expect(await unlloo.unpaidDebtLoansPerPool(usdcAddr)).to.equal(0);

    // Final verification: no ID appears in multiple status lists
    const allLists: Array<{ name: string; ids: bigint[] }> = [
      { name: "Pending", ids: await unlloo.loansByStatus(constants.LoanStatus.Pending) },
      { name: "Approved", ids: await unlloo.loansByStatus(constants.LoanStatus.Approved) },
      { name: "Active", ids: await unlloo.loansByStatus(constants.LoanStatus.Active) },
      { name: "UnpaidDebt", ids: await unlloo.loansByStatus(constants.LoanStatus.UnpaidDebt) },
      { name: "Repaid", ids: await unlloo.loansByStatus(constants.LoanStatus.Repaid) },
      { name: "Rejected", ids: await unlloo.loansByStatus(constants.LoanStatus.Rejected) },
    ];

    const seen = new Map<string, string>();
    for (const list of allLists) {
      assertNoDuplicates(list.ids, list.name);
      for (const id of list.ids) {
        const key = id.toString();
        const prev = seen.get(key);
        expect(prev ?? list.name, `loanId ${key} appears in multiple status arrays`).to.equal(list.name);
        seen.set(key, list.name);
      }
    }
  });
});
