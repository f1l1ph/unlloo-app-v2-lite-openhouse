/**
 * Typechain compatibility shim.
 *
 * The old monolithic Unlloo.sol was split into UnllooCore + UnllooExt + UnllooStorage.
 * Tests written against the old contract can import from this file to get a combined type
 * that covers both Core (direct) and Ext (via delegatecall) selectors.
 *
 * Usage:  import { Unlloo, MockERC20 } from "../typechain-compat"
 *    or:  import { Unlloo, MockERC20 } from "../../typechain-compat"  (from helpers/)
 */
export * from "./typechain-types";
export type { UnllooCombined as Unlloo } from "./test/fixtures/UnllooTestFixture";
