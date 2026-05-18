// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KEY Treasury Lock Vault
/// @notice Locks ETH mint fees until the owner unlocks them for manual LP routing or withdrawal.
contract KEYTreasuryLockVault {
    address public owner;
    address public mintGate;
    address public liquidityManager;
    bool public unlocked;
    uint256 public totalMintFeesReceived;
    uint256 public totalDirectEthReceived;
    uint256 public totalEthRouted;
    uint256 public totalEthWithdrawn;

    mapping(address => uint256) public mintFeesByMinter;

    event MintFeeLocked(address indexed minter, uint256 amount);
    event DirectEthReceived(address indexed sender, uint256 amount);
    event MintGateSet(address indexed mintGate);
    event LiquidityManagerSet(address indexed liquidityManager);
    event UnlockedSet(bool unlocked);
    event EthRoutedToLiquidity(address indexed manager, uint256 amount, string memo);
    event EthWithdrawn(address indexed recipient, uint256 amount, string memo);
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
        totalDirectEthReceived += msg.value;
        emit DirectEthReceived(msg.sender, msg.value);
    }

    function setMintGate(address gate) external onlyOwner {
        require(gate != address(0), "bad gate");
        mintGate = gate;
        emit MintGateSet(gate);
    }

    function setLiquidityManager(address manager) external onlyOwner {
        liquidityManager = manager;
        emit LiquidityManagerSet(manager);
    }

    function setUnlocked(bool open) external onlyOwner {
        unlocked = open;
        emit UnlockedSet(open);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function depositMintFee(address minter) external payable {
        require(msg.sender == mintGate, "only mint gate");
        totalMintFeesReceived += msg.value;
        mintFeesByMinter[minter] += msg.value;
        emit MintFeeLocked(minter, msg.value);
    }

    function lockedBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function routeEthToLiquidity(uint256 amount, string calldata memo) external onlyOwnerOrManager {
        require(unlocked, "vault locked");
        require(liquidityManager != address(0), "manager not set");
        require(amount <= address(this).balance, "insufficient eth");
        totalEthRouted += amount;
        (bool ok, ) = payable(liquidityManager).call{value: amount}("");
        require(ok, "eth transfer failed");
        emit EthRoutedToLiquidity(liquidityManager, amount, memo);
    }

    function withdrawEth(address payable recipient, uint256 amount, string calldata memo) external onlyOwner {
        require(unlocked, "vault locked");
        require(recipient != address(0), "bad recipient");
        require(amount <= address(this).balance, "insufficient eth");
        totalEthWithdrawn += amount;
        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "eth transfer failed");
        emit EthWithdrawn(recipient, amount, memo);
    }
}
