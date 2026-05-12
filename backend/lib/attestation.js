import { ethers } from 'ethers';
import { CONFIG, tierFromRewardHash } from './config.js';

export const ATTESTATION_TYPES = {
  MintAttestation: [
    { name: 'recipient', type: 'address' },
    { name: 'publicKeyHash', type: 'bytes32' },
    { name: 'signatureHash', type: 'bytes32' },
    { name: 'rewardHash', type: 'bytes32' },
    { name: 'rewardAmount', type: 'uint256' },
    { name: 'epoch', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
};

export function domain(verifyingContract = CONFIG.mintGateAddress, chainId = CONFIG.chainId) {
  return {
    name: 'KEYMintGate',
    version: '1',
    chainId,
    verifyingContract
  };
}

export function computeSignatureHash(rawSignature) {
  if (rawSignature && /^0x[0-9a-fA-F]+$/.test(rawSignature)) return ethers.keccak256(rawSignature);
  return ethers.id(String(rawSignature || ''));
}

export function computeRewardHash({ recipient, publicKeyHash, signatureHash, epoch, chainId }) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['address', 'bytes32', 'bytes32', 'uint256', 'uint256'],
      [recipient, publicKeyHash, signatureHash, epoch, chainId]
    )
  );
}

export function computeProofId({ recipient, publicKeyHash, signatureHash, epoch, chainId }) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['address', 'bytes32', 'bytes32', 'uint256', 'uint256', 'string'],
      [recipient, publicKeyHash, signatureHash, epoch, chainId, 'KEY_PROOF_V1']
    )
  );
}

export async function signMintAttestation({ signer, recipient, publicKeyHash, signatureHash, epoch, chainId, verifyingContract }) {
  const rewardHash = computeRewardHash({ recipient, publicKeyHash, signatureHash, epoch, chainId });
  const tier = tierFromRewardHash(rewardHash);
  const rewardAmount = ethers.parseEther(String(tier.reward)).toString();
  const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
  const value = { recipient, publicKeyHash, signatureHash, rewardHash, rewardAmount, epoch, deadline };
  const attestation = await signer.signTypedData(domain(verifyingContract, chainId), ATTESTATION_TYPES, value);
  return {
    value,
    attestation,
    tier,
    rewardHash,
    proofId: computeProofId({ recipient, publicKeyHash, signatureHash, epoch, chainId })
  };
}
