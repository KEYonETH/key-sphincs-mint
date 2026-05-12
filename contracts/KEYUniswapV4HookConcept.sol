// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Documentation-only placeholder for the KEY v4 hook route.
/// @dev This is intentionally NOT a production Uniswap v4 hook. Build the real hook against official v4-core/v4-periphery interfaces.
contract KEYUniswapV4HookConcept {
    address public immutable keyToken;
    address public immutable treasuryVault;
    string public constant purpose = "KEY mint treasury route can seed locked liquidity through a Uniswap v4 hook/pool manager integration.";

    event HookRoutePlanned(address indexed keyToken, address indexed treasuryVault, bytes32 indexed poolId, string memo);

    constructor(address keyToken_, address treasuryVault_) {
        keyToken = keyToken_;
        treasuryVault = treasuryVault_;
    }

    function publishRoute(bytes32 poolId, string calldata memo) external {
        emit HookRoutePlanned(keyToken, treasuryVault, poolId, memo);
    }
}
