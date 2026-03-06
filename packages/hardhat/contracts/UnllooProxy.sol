// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title UnllooProxy
 * @notice Proxy contract for Unlloo implementation
 * @dev Uses ERC1967 proxy pattern for upgradeability
 */
contract UnllooProxy is ERC1967Proxy {
    /**
     * @notice Initialize proxy with implementation and initialization data
     * @param implementation Address of the Unlloo implementation contract
     * @param data Encoded initialization data for the implementation
     */
    constructor(address implementation, bytes memory data) ERC1967Proxy(implementation, data) {}
}
