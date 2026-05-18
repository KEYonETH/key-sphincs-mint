// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KEYMintGateV3} from "./KEYMintGateV3.sol";

/// @title KEY Mint Gate V4
/// @notice New mint gate instance for routing future mint fees into the treasury lock vault.
contract KEYMintGateV4 is KEYMintGateV3 {
    constructor(
        address token_,
        address treasuryVault_,
        address attestationSigner_,
        address legacyMintGate_,
        address[] memory additionalLegacyMintGates_
    ) KEYMintGateV3(
        token_,
        treasuryVault_,
        attestationSigner_,
        legacyMintGate_,
        additionalLegacyMintGates_
    ) {}
}
