//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title FromAddressFeeERC20
 * @notice Fee-on-transfer that only applies when `from == feeFrom`.
 * @dev This lets tests model tokens that behave "normally" on user->contract deposits
 *      but take a receiver-side fee on contract->user payouts.
 */
contract FromAddressFeeERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable feeBps;
    address public feeFrom;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 feeBps_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        feeBps = feeBps_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setFeeFrom(address from_) external {
        feeFrom = from_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);

        if (feeBps == 0 || from == address(0) || to == address(0)) return;
        if (from != feeFrom) return;

        uint256 fee = (amount * feeBps) / 10000;
        if (fee > 0) _burn(to, fee);
    }
}

