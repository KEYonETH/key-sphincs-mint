// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title KEY Reserve Timelock
/// @notice Optional simple lockbox for LP reserve or treasury reserve tokens.
contract KEYReserveTimelock {
    address public immutable token;
    address public immutable beneficiary;
    uint256 public immutable releaseTime;

    event Released(address indexed beneficiary, uint256 amount);

    constructor(address token_, address beneficiary_, uint256 releaseTime_) {
        require(token_ != address(0), "bad token");
        require(beneficiary_ != address(0), "bad beneficiary");
        require(releaseTime_ > block.timestamp, "release in past");
        token = token_;
        beneficiary = beneficiary_;
        releaseTime = releaseTime_;
    }

    function release() external {
        require(block.timestamp >= releaseTime, "not released");
        uint256 amount = IERC20Transfer(token).balanceOf(address(this));
        require(amount > 0, "empty");
        require(IERC20Transfer(token).transfer(beneficiary, amount), "transfer failed");
        emit Released(beneficiary, amount);
    }
}
