// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title KEY Treasury Vault
/// @notice Receives mint fees and publishes route events for liquidity transparency.
contract KEYTreasuryVault {
    address public owner;
    address public mintGate;
    address public liquidityManager;
    uint256 public totalMintFeesReceived;
    uint256 public totalEthRouted;

    event MintFeeReceived(address indexed minter, uint256 amount);
    event MintGateSet(address indexed mintGate);
    event LiquidityManagerSet(address indexed liquidityManager);
    event EthRoutedToLiquidity(address indexed manager, uint256 amount, string memo);
    event TokenRoutedToLiquidity(address indexed token, address indexed manager, uint256 amount, string memo);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOwnerOrManager() {
        require(msg.sender == owner || msg.sender == liquidityManager, "not allowed");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "bad owner");
        owner = initialOwner;
    }

    receive() external payable {
        totalMintFeesReceived += msg.value;
        emit MintFeeReceived(msg.sender, msg.value);
    }

    function setMintGate(address gate) external onlyOwner {
        require(gate != address(0), "bad gate");
        mintGate = gate;
        emit MintGateSet(gate);
    }

    function setLiquidityManager(address manager) external onlyOwner {
        require(manager != address(0), "bad manager");
        liquidityManager = manager;
        emit LiquidityManagerSet(manager);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function depositMintFee(address minter) external payable {
        require(msg.sender == mintGate, "only mint gate");
        totalMintFeesReceived += msg.value;
        emit MintFeeReceived(minter, msg.value);
    }

    function routeEthToLiquidity(uint256 amount, string calldata memo) external onlyOwnerOrManager {
        require(liquidityManager != address(0), "manager not set");
        require(amount <= address(this).balance, "insufficient eth");
        totalEthRouted += amount;
        (bool ok, ) = payable(liquidityManager).call{value: amount}("");
        require(ok, "eth transfer failed");
        emit EthRoutedToLiquidity(liquidityManager, amount, memo);
    }

    function routeTokenToLiquidity(address token, uint256 amount, string calldata memo) external onlyOwnerOrManager {
        require(liquidityManager != address(0), "manager not set");
        require(IERC20Like(token).transfer(liquidityManager, amount), "token transfer failed");
        emit TokenRoutedToLiquidity(token, liquidityManager, amount, memo);
    }
}
