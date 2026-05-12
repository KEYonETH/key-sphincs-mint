import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ethers } from 'ethers';
import { CONFIG } from './config.js';

const execFileAsync = promisify(execFile);
const hexPattern = /^0x[0-9a-fA-F]+$/;

function splitCommand(command) {
  const parts = [];
  let current = '';
  let quote = '';

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (quote) throw new Error('SPHINCS_VERIFY_COMMAND has an unterminated quote');
  if (current) parts.push(current);
  return parts;
}

function replacePlaceholders(command, payload) {
  return command
    .replaceAll('{pubkey}', payload.sphincsPublicKey || '')
    .replaceAll('{message_b64}', Buffer.from(payload.sphincsMessage || '', 'utf8').toString('base64'))
    .replaceAll('{signature}', payload.sphincsSignature || '');
}

export function buildCanonicalMessage({ recipient, publicKeyHash, epoch, chainId }) {
  return [
    'KEY Signature Mint',
    `wallet=${ethers.getAddress(recipient)}`,
    `publicKeyHash=${publicKeyHash}`,
    `epoch=${epoch}`,
    `chainId=${chainId}`,
    'purpose=Proof-of-Signature Hash'
  ].join('\n');
}

export async function verifyWalletOwnership({ recipient, publicKeyHash, epoch, chainId, walletSignature, message }) {
  const canonical = message || buildCanonicalMessage({ recipient, publicKeyHash, epoch, chainId });
  const recovered = ethers.verifyMessage(canonical, walletSignature);
  if (ethers.getAddress(recovered) !== ethers.getAddress(recipient)) {
    throw new Error('wallet signature does not match recipient');
  }
  return { ok: true, message: canonical, recovered };
}

export async function verifySphincsProof(payload) {
  const mode = CONFIG.sphincsVerifyMode;

  if (mode === 'preview') {
    // Preview mode is for UI/backend development only. It checks shape and produces deterministic hashes.
    // Mainnet should use mode=command with an external verifier from your chosen SPHINCS implementation.
    if (!payload.publicKeyHash || !payload.walletSignature) throw new Error('missing preview proof fields');
    return { ok: true, mode, note: 'preview mode: SPHINCS verification not enforced' };
  }

  if (mode === 'command') {
    if (!CONFIG.sphincsVerifyCommand) throw new Error('SPHINCS_VERIFY_COMMAND is required');
    if (!payload.sphincsPublicKey || !payload.sphincsSignature || !payload.sphincsMessage) {
      throw new Error('sphincsPublicKey, sphincsSignature, and sphincsMessage are required in command mode');
    }
    if (!hexPattern.test(payload.sphincsPublicKey) || payload.sphincsPublicKey.length % 2 !== 0) {
      throw new Error('sphincsPublicKey must be 0x-prefixed even-length hex');
    }
    if (!hexPattern.test(payload.sphincsSignature) || payload.sphincsSignature.length % 2 !== 0) {
      throw new Error('sphincsSignature must be 0x-prefixed even-length hex');
    }
    const derivedPublicKeyHash = ethers.keccak256(payload.sphincsPublicKey);
    if (derivedPublicKeyHash.toLowerCase() !== payload.publicKeyHash.toLowerCase()) {
      throw new Error('publicKeyHash does not match keccak256(sphincsPublicKey)');
    }
    if (payload.canonicalMessage && payload.sphincsMessage !== payload.canonicalMessage) {
      throw new Error('sphincsMessage must match the canonical mint message');
    }
    const command = replacePlaceholders(CONFIG.sphincsVerifyCommand, payload);
    const [bin, ...args] = splitCommand(command);
    if (!bin) throw new Error('SPHINCS_VERIFY_COMMAND is empty');
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      const out = `${stdout}\n${stderr}`.toLowerCase();
      if (out.includes('invalid') || (!out.includes('valid') && !out.includes('verified') && !out.includes('true'))) {
        throw new Error(`SPHINCS verifier rejected proof: ${(stdout || stderr || 'no verifier output').trim()}`);
      }
      return { ok: true, mode, stdout: stdout.trim() };
    } catch (error) {
      const stdout = error.stdout ? String(error.stdout).trim() : '';
      const stderr = error.stderr ? String(error.stderr).trim() : '';
      const detail = [stdout, stderr, error.message].filter(Boolean).join(' | ');
      throw new Error(`SPHINCS verifier command failed: ${detail}`);
    }
  }

  throw new Error(`unsupported SPHINCS_VERIFY_MODE: ${mode}`);
}
