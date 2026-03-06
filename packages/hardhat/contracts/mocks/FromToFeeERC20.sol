//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title FromToFeeERC20
 * @notice ERC20 that applies a receiver-side fee only for (from == feeFrom && to == feeTo).
 * @dev Useful to model tokens that behave normally for most flows but break exact transfer
 *      assumptions for a specific payout surface (e.g., Unlloo -> owner).
 */
contract FromToFeeERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable feeBps;
    address public feeFrom;
    address public feeTo;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 feeBps_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        feeBps = feeBps_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setFeeFromTo(address from_, address to_) external {
        feeFrom = from_;
        feeTo = to_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);

        if (feeBps == 0 || from == address(0) || to == address(0)) return;
        if (from != feeFrom || to != feeTo) return;

        uint256 fee = (amount * feeBps) / 10000;
        if (fee > 0) _burn(to, fee);
    }
}

