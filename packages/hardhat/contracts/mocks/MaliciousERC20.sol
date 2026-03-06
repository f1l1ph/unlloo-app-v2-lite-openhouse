//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MaliciousERC20
 * @notice Malicious ERC20 token for testing reentrancy attacks
 * @dev This token attempts reentrancy attacks on transfer and transferFrom
 */
contract MaliciousERC20 is ERC20 {
    uint8 private immutable _decimals;
    address public targetContract;
    bytes public callData;
    bool public attackEnabled;
    uint256 public attackCount;
    uint256 public maxAttackCount;

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        uint8 decimals_
    ) ERC20(tokenName, tokenSymbol) {
        _decimals = decimals_;
        attackEnabled = false;
        attackCount = 0;
        maxAttackCount = 1;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function setAttackTarget(address target, bytes memory data) external {
        targetContract = target;
        callData = data;
    }

    function enableAttack(uint256 maxCount) external {
        attackEnabled = true;
        maxAttackCount = maxCount;
        attackCount = 0;
    }

    function disableAttack() external {
        attackEnabled = false;
        attackCount = 0;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        // Attempt reentrancy attack if enabled
        if (attackEnabled && attackCount < maxAttackCount && targetContract != address(0)) {
            attackCount++;
            (bool success, ) = targetContract.call(callData);
            // Don't revert on failure, just attempt the attack
            success; // silence unused variable warning
        }
    }
}
