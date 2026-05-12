// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KEY Token
/// @notice Minimal fixed-supply ERC20 for KEY Signature Minting.
contract KEYToken {
    string public constant name = "KEY";
    string public constant symbol = "KEY";
    uint8 public constant decimals = 18;

    uint256 public constant MAX_SUPPLY = 21_000_000 ether;
    uint256 public constant PUBLIC_MINT_POOL = 10_000_000 ether;
    uint256 public constant LP_RESERVE = 10_000_000 ether;
    uint256 public constant TREASURY_RESERVE = 1_000_000 ether;

    address public owner;
    address public mintGate;
    uint256 public totalSupply;
    uint256 public publicMintedByGate;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MintGateSet(address indexed gate);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyMintGate() {
        require(msg.sender == mintGate, "not mint gate");
        _;
    }

    constructor(address lpReserveRecipient, address treasuryReserveRecipient) {
        require(lpReserveRecipient != address(0), "bad lp recipient");
        require(treasuryReserveRecipient != address(0), "bad treasury recipient");
        owner = msg.sender;
        _mint(lpReserveRecipient, LP_RESERVE);
        _mint(treasuryReserveRecipient, TREASURY_RESERVE);
    }

    function setMintGate(address gate) external onlyOwner {
        require(gate != address(0), "bad gate");
        mintGate = gate;
        emit MintGateSet(gate);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function mintByGate(address to, uint256 amount) external onlyMintGate {
        require(publicMintedByGate + amount <= PUBLIC_MINT_POOL, "public pool filled");
        publicMintedByGate += amount;
        _mint(to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "bad to");
        require(balanceOf[from] >= amount, "balance");
        unchecked { balanceOf[from] -= amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "bad to");
        require(totalSupply + amount <= MAX_SUPPLY, "max supply");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
