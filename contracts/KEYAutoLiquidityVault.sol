// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20AutoLiquidity {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWETHAutoLiquidity is IERC20AutoLiquidity {
    function deposit() external payable;
}

interface IKEYMintOutSource {
    function mintOutReached() external view returns (bool);
}

/// @title KEY Auto Liquidity Vault
/// @notice Holds mint fee ETH and LP reserve KEY, then executes owner-prepared Uniswap v4 liquidity migration after mint-out.
contract KEYAutoLiquidityVault {
    address public owner;
    address public mintGate;
    address public keyToken;
    address public liquidityManager;
    address public positionManager;
    bool public emergencyUnlocked;
    bool public liquidityFinalized;
    bool private locked;

    uint256 public totalMintFeesReceived;
    uint256 public totalDirectEthReceived;
    uint256 public totalEthFinalizedToLiquidity;
    uint256 public totalKeyFinalizedToLiquidity;
    uint256 public totalEthWithdrawn;
    uint256 public totalKeyWithdrawn;

    address public liquidityTarget;
    uint256 public liquidityEthValue;
    bytes public liquidityCalldata;
    string public liquidityMemo;

    mapping(address => uint256) public mintFeesByMinter;

    event MintFeeLocked(address indexed minter, uint256 amount);
    event DirectEthReceived(address indexed sender, uint256 amount);
    event OwnerSet(address indexed oldOwner, address indexed newOwner);
    event MintGateSet(address indexed mintGate);
    event KeyTokenSet(address indexed keyToken);
    event LiquidityManagerSet(address indexed liquidityManager);
    event PositionManagerSet(address indexed positionManager);
    event EmergencyUnlockedSet(bool emergencyUnlocked);
    event TokenApproved(address indexed token, address indexed spender, uint256 amount);
    event EthWrapped(address indexed weth, uint256 amount);
    event LiquidityPlanSet(address indexed target, uint256 ethValue, string memo);
    event LiquidityFinalized(address indexed target, uint256 ethValue, uint256 keyBefore, uint256 keyAfter, string memo);
    event EthWithdrawn(address indexed recipient, uint256 amount, string memo);
    event TokenWithdrawn(address indexed token, address indexed recipient, uint256 amount, string memo);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOwnerOrManager() {
        require(msg.sender == owner || msg.sender == liquidityManager, "not allowed");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "locked");
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialOwner, address initialLiquidityManager, address initialPositionManager) {
        require(initialOwner != address(0), "bad owner");
        owner = initialOwner;
        liquidityManager = initialLiquidityManager;
        positionManager = initialPositionManager;
        emit OwnerSet(address(0), initialOwner);
        emit LiquidityManagerSet(initialLiquidityManager);
        emit PositionManagerSet(initialPositionManager);
    }

    receive() external payable {
        totalDirectEthReceived += msg.value;
        emit DirectEthReceived(msg.sender, msg.value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        emit OwnerSet(owner, newOwner);
        owner = newOwner;
    }

    function setMintGate(address gate) external onlyOwner {
        require(gate != address(0), "bad gate");
        mintGate = gate;
        emit MintGateSet(gate);
    }

    function setKeyToken(address token) external onlyOwner {
        require(token != address(0), "bad token");
        keyToken = token;
        emit KeyTokenSet(token);
    }

    function setLiquidityManager(address manager) external onlyOwner {
        liquidityManager = manager;
        emit LiquidityManagerSet(manager);
    }

    function setPositionManager(address manager) external onlyOwner {
        require(manager != address(0), "bad position manager");
        positionManager = manager;
        emit PositionManagerSet(manager);
    }

    function setEmergencyUnlocked(bool unlocked_) external onlyOwner {
        emergencyUnlocked = unlocked_;
        emit EmergencyUnlockedSet(unlocked_);
    }

    function depositMintFee(address minter) external payable {
        require(msg.sender == mintGate, "only mint gate");
        totalMintFeesReceived += msg.value;
        mintFeesByMinter[minter] += msg.value;
        emit MintFeeLocked(minter, msg.value);
    }

    function approveToken(address token, address spender, uint256 amount) external onlyOwner {
        require(token != address(0) && spender != address(0), "bad approve");
        require(IERC20AutoLiquidity(token).approve(spender, amount), "approve failed");
        emit TokenApproved(token, spender, amount);
    }

    function wrapEth(address weth, uint256 amount) external onlyOwnerOrManager nonReentrant {
        require(weth != address(0), "bad weth");
        require(canFinalizeLiquidity() || emergencyUnlocked, "mint not finished");
        require(amount <= address(this).balance, "insufficient eth");
        IWETHAutoLiquidity(weth).deposit{value: amount}();
        emit EthWrapped(weth, amount);
    }

    function approveKeyToPositionManager(uint256 amount) external onlyOwner {
        require(keyToken != address(0), "key token not set");
        require(positionManager != address(0), "position manager not set");
        require(IERC20AutoLiquidity(keyToken).approve(positionManager, amount), "approve failed");
        emit TokenApproved(keyToken, positionManager, amount);
    }

    function setLiquidityPlan(address target, uint256 ethValue, bytes calldata callData, string calldata memo) external onlyOwner {
        require(target != address(0), "bad target");
        require(ethValue <= address(this).balance, "insufficient eth");
        liquidityTarget = target;
        liquidityEthValue = ethValue;
        liquidityCalldata = callData;
        liquidityMemo = memo;
        emit LiquidityPlanSet(target, ethValue, memo);
    }

    function canFinalizeLiquidity() public view returns (bool) {
        if (mintGate == address(0)) return false;
        try IKEYMintOutSource(mintGate).mintOutReached() returns (bool reached) {
            return reached;
        } catch {
            return false;
        }
    }

    function finalizeLiquidity() external nonReentrant onlyOwnerOrManager {
        require(!liquidityFinalized, "already finalized");
        require(canFinalizeLiquidity() || emergencyUnlocked, "mint not finished");
        require(liquidityTarget != address(0), "plan not set");
        require(liquidityCalldata.length != 0, "calldata not set");
        require(liquidityEthValue <= address(this).balance, "insufficient eth");

        uint256 keyBefore = keyToken == address(0) ? 0 : IERC20AutoLiquidity(keyToken).balanceOf(address(this));
        liquidityFinalized = true;
        totalEthFinalizedToLiquidity += liquidityEthValue;
        (bool ok, bytes memory result) = liquidityTarget.call{value: liquidityEthValue}(liquidityCalldata);
        if (!ok) {
            liquidityFinalized = false;
            totalEthFinalizedToLiquidity -= liquidityEthValue;
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        uint256 keyAfter = keyToken == address(0) ? 0 : IERC20AutoLiquidity(keyToken).balanceOf(address(this));
        if (keyBefore > keyAfter) totalKeyFinalizedToLiquidity += keyBefore - keyAfter;
        emit LiquidityFinalized(liquidityTarget, liquidityEthValue, keyBefore, keyAfter, liquidityMemo);
    }

    function emergencyWithdrawEth(address payable recipient, uint256 amount, string calldata memo) external onlyOwner nonReentrant {
        require(emergencyUnlocked, "emergency locked");
        require(recipient != address(0), "bad recipient");
        require(amount <= address(this).balance, "insufficient eth");
        totalEthWithdrawn += amount;
        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "eth transfer failed");
        emit EthWithdrawn(recipient, amount, memo);
    }

    function emergencyWithdrawToken(address token, address recipient, uint256 amount, string calldata memo) external onlyOwner nonReentrant {
        require(emergencyUnlocked, "emergency locked");
        require(token != address(0) && recipient != address(0), "bad withdraw");
        require(IERC20AutoLiquidity(token).transfer(recipient, amount), "token transfer failed");
        if (token == keyToken) totalKeyWithdrawn += amount;
        emit TokenWithdrawn(token, recipient, amount, memo);
    }
}
