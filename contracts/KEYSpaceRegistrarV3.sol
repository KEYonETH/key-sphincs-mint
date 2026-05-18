// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KEYSpaceRegistrarV2} from "./KEYSpaceRegistrarV2.sol";

/// @title KEYSPACE Registrar V3
/// @notice Same ten-mint claim rule as V2, with origin claims open immediately instead of waiting for mint-out.
contract KEYSpaceRegistrarV3 is KEYSpaceRegistrarV2 {
    constructor(
        address initialOwner,
        address keyToken_,
        address identity_,
        address primaryMintGate,
        address[] memory legacyMintGates
    ) KEYSpaceRegistrarV2(initialOwner, keyToken_, identity_, primaryMintGate, legacyMintGates) {
        originClaimsOpen = true;
        emit OriginClaimsOpenSet(true);
    }

    function setOriginClaimsOpen(bool open) external override onlyOwner {
        originClaimsOpen = open;
        emit OriginClaimsOpenSet(open);
    }

    function canOpenOriginClaims() public pure override returns (bool) {
        return true;
    }
}
