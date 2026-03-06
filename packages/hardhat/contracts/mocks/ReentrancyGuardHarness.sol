// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title ReentrancyGuardHarness
 * @notice Harness to cover ReentrancyGuardUpgradeable lines under solidity-coverage.
 */
contract ReentrancyGuardHarness is ReentrancyGuardUpgradeable {
    uint256 public counter;

    function init() external initializer {
        __ReentrancyGuard_init();
    }

    function enter() external nonReentrant {
        counter += 1;
    }

    function reenter() external nonReentrant {
        // External self-call while entered triggers ReentrancyGuardReentrantCall
        this.enter();
    }
}

