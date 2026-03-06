//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title MockPriceFeed
 * @notice Mock Chainlink price feed for testing purposes
 * @dev Implements AggregatorV3Interface to ensure compatibility with PriceOracle
 */
contract MockPriceFeed is AggregatorV3Interface {
    int256 private _price;
    uint256 private _updatedAt;
    uint8 private immutable _decimals;
    uint80 private _roundId;
    uint80 private _answeredInRound;

    constructor(int256 initialPrice, uint8 decimals_) {
        _price = initialPrice;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
        _roundId = 1;
        _answeredInRound = 1;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, _price, block.timestamp, _updatedAt, _answeredInRound);
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external pure override returns (string memory) {
        return "Mock USDC/USD Price Feed";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 roundId_)
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (roundId_, _price, block.timestamp, _updatedAt, _answeredInRound);
    }

    // Test helpers
    function setPrice(int256 newPrice) external {
        _price = newPrice;
        _updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 newUpdatedAt) external {
        _updatedAt = newUpdatedAt;
    }

    function setPriceWithTimestamp(int256 newPrice, uint256 newUpdatedAt) external {
        _price = newPrice;
        _updatedAt = newUpdatedAt;
    }

    function setRoundId(uint80 newRoundId) external {
        _roundId = newRoundId;
    }

    function setAnsweredInRound(uint80 newAnsweredInRound) external {
        _answeredInRound = newAnsweredInRound;
    }
}

