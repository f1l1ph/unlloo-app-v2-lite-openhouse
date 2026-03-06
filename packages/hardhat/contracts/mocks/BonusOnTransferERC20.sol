//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title BonusOnTransferERC20
 * @notice ERC20 that mints a small bonus to the receiver on each transfer.
 * @dev Receiver balance increases by `amount + bonus`, breaking "exact transfer" assumptions.
 */
contract BonusOnTransferERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable bonus; // fixed bonus per transfer in smallest units

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 bonus_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        bonus = bonus_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);

        // Apply bonus only on transfers (not mint/burn).
        if (bonus == 0 || from == address(0) || to == address(0)) return;
        _mint(to, bonus);
    }
}

