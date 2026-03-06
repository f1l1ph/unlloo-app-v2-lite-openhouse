// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title ReentrancyGuardUpgradeable
 * @notice Minimal upgradeable reentrancy guard compatible with proxy deployments.
 * @dev This is a compatibility shim for OpenZeppelin Contracts Upgradeable v5.5+
 *      where ReentrancyGuardUpgradeable was deprecated/removed.
 *
 *      API is intentionally aligned with OZ's historical ReentrancyGuardUpgradeable:
 *      - __ReentrancyGuard_init()
 *      - __ReentrancyGuard_init_unchained()
 *      - nonReentrant modifier
 */
abstract contract ReentrancyGuardUpgradeable is Initializable {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write emits an extra SLOAD to first read the slot's
    // contents, replace the bits taken up by the boolean, and then write back.
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    error ReentrancyGuardReentrantCall();

    function __ReentrancyGuard_init() internal onlyInitializing {
        __ReentrancyGuard_init_unchained();
    }

    function __ReentrancyGuard_init_unchained() internal onlyInitializing {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuardReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // Gap for future upgrades (keep consistent with OZ pattern)
    uint256[49] private __gap;
}
