//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title RevertingMaliciousERC20
 * @notice Malicious ERC20 for reentrancy tests that REVERTS if the reentrant call fails.
 * @dev Useful to assert outer Unlloo call reverts due to reentrancy guard.
 */
contract RevertingMaliciousERC20 is ERC20 {
    uint8 private immutable _decimals;
    address public targetContract;
    bytes public callData;
    bool public attackEnabled;
    uint256 public attackCount;
    uint256 public maxAttackCount;

    constructor(string memory tokenName, string memory tokenSymbol, uint8 decimals_) ERC20(tokenName, tokenSymbol) {
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

        if (attackEnabled && attackCount < maxAttackCount && targetContract != address(0)) {
            attackCount++;
            (bool success, bytes memory ret) = targetContract.call(callData);
            // Make the reentrancy attempt visible by reverting on failure.
            if (!success) {
                // Bubble revert reason if present (best-effort)
                if (ret.length > 0) {
                    assembly {
                        revert(add(ret, 0x20), mload(ret))
                    }
                }
                revert("REENTRANCY_CALLBACK_FAILED");
            }
        }
    }
}

