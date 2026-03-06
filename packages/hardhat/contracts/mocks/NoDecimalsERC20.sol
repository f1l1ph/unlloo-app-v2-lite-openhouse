//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title NoDecimalsERC20
 * @notice ERC20 token that makes decimals() revert to test fallback behavior
 * @dev This token intentionally makes decimals() revert to test the catch block in Unlloo.sol
 */
contract NoDecimalsERC20 is ERC20 {
    bool public shouldRevertDecimals;

    constructor(
        string memory tokenName,
        string memory tokenSymbol
    ) ERC20(tokenName, tokenSymbol) {
        shouldRevertDecimals = true;
    }

    function decimals() public view override returns (uint8) {
        if (shouldRevertDecimals) {
            revert("Decimals not available");
        }
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
