//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title FeeOnTransferERC20
 * @notice ERC20 that takes a fee from the receiver amount.
 * @dev Sender balance decreases by `amount`, receiver gets `amount - fee`.
 *      This breaks "exact transfer" assumptions and should be rejected by Unlloo.
 */
contract FeeOnTransferERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable feeBps; // e.g. 100 = 1%

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 feeBps_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        feeBps = feeBps_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);

        // Apply fee only on transfers (not mint/burn).
        if (feeBps == 0 || from == address(0) || to == address(0)) return;

        uint256 fee = (amount * feeBps) / 10000;
        if (fee > 0) {
            // Burn fee from receiver so receiver net is (amount - fee).
            _burn(to, fee);
        }
    }
}

