import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ethers } from 'ethers';
import { CONFIG, TOKENOMICS, TIERS } from './lib/config.js';
import { ProofStore } from './lib/store.js';
import { ChallengeStore } from './lib/challengeStore.js';
import { verifyWalletOwnership, verifySphincsProof, buildCanonicalMessage } from './lib/sphincsVerifier.js';
import { computeSignatureHash, signMintAttestation } from './lib/attestation.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
const allowedOrigins = CONFIG.corsOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  }
}));
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({
  windowMs: 60_000,
  max: Number(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE || 300),
  standardHeaders: true,
  legacyHeaders: false
}));

const attestLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.ATTEST_RATE_LIMIT_PER_MINUTE || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many mint attempts. Please wait a minute and try again.' }
});

const sphincsKeyLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.SPHINCS_KEY_RATE_LIMIT_PER_MINUTE || 12),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many key generations. Please wait a minute and try again.' }
});

const sphincsSignLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.SPHINCS_SIGN_RATE_LIMIT_PER_MINUTE || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many signature requests. Please wait a minute and try again.' }
});

const attestationPrivateKey = process.env.SIGNER_PRIVATE_KEY;
if (!attestationPrivateKey || !attestationPrivateKey.startsWith('0x')) {
  console.warn('[KEY backend] SIGNER_PRIVATE_KEY not set. A random preview signer will be used. Do not use this on mainnet.');
}
const signer = new ethers.Wallet(attestationPrivateKey || ethers.Wallet.createRandom().privateKey);
const store = new ProofStore(CONFIG.proofDataDir);
const challenges = new ChallengeStore(CONFIG.challengeTtlMs);
const assistedSphincsKeys = new Map();
const ASSISTED_KEY_TTL_MS = 30 * 60 * 1000;
const rpcUrl = process.env.MAINNET_RPC_URL || process.env.RPC_URL || process.env.ETH_RPC_URL || '';
const chainProvider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl, CONFIG.chainId) : null;
const STATS_CACHE_TTL_MS = Number(process.env.STATS_CACHE_TTL_MS || 15_000);
const PROOFS_CACHE_TTL_MS = Number(process.env.PROOFS_CACHE_TTL_MS || 15_000);
const LIQUIDITY_CACHE_TTL_MS = Number(process.env.LIQUIDITY_CACHE_TTL_MS || 30_000);
const CACHE_STALE_MS = Number(process.env.CACHE_STALE_MS || 120_000);
const PROOF_CACHE_MAX_RECORDS = Number(process.env.PROOF_CACHE_MAX_RECORDS || 10_000);
const mintGateStatsAbi = [
  'function publicMinted() view returns (uint256)',
  'function walletMints(address) view returns (uint256)',
  'function usedProofId(bytes32) view returns (bool)'
];
const tokenStatsAbi = [
  'function publicMintedByGate() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)',
  'function mintGate() view returns (address)'
];
const treasuryVaultStatsAbi = [
  'function totalMintFeesReceived() view returns (uint256)',
  'function totalEthRouted() view returns (uint256)',
  'function owner() view returns (address)',
  'function mintGate() view returns (address)',
  'function liquidityManager() view returns (address)'
];

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hexAny = z.string().regex(/^0x[0-9a-fA-F]+$/);
const address = z.string().refine((v) => ethers.isAddress(v), 'invalid address');

const ChallengeSchema = z.object({
  recipient: address,
  publicKeyHash: hex32,
  epoch: z.number().int().nonnegative(),
  chainId: z.number().int().positive().default(CONFIG.chainId)
});

const AttestSchema = z.object({
  recipient: address,
  publicKeyHash: hex32,
  walletSignature: hexAny,
  epoch: z.number().int().nonnegative(),
  chainId: z.number().int().positive().default(CONFIG.chainId),
  verifyingContract: address.default(CONFIG.mintGateAddress),
  challengeId: z.string().optional(),
  sphincsPublicKey: z.string().optional(),
  sphincsSignature: z.string().optional(),
  sphincsMessage: z.string().optional()
});

function assertConfiguredChain(chainId) {
  if (Number(chainId) !== Number(CONFIG.chainId)) {
    throw new Error(`chainId must be ${CONFIG.chainId}`);
  }
}

function createSemaphore(max) {
  let active = 0;
  const queue = [];

  return async function runExclusive(task) {
    if (active >= max) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  };
}

const runSphincsJob = createSemaphore(Number(process.env.SPHINCS_CONCURRENCY || 2));

function createAsyncCache(label, loader, ttlMs, staleMs = CACHE_STALE_MS) {
  let cached = null;
  let expiresAt = 0;
  let staleUntil = 0;
  let pending = null;

  async function get({ force = false } = {}) {
    const now = Date.now();
    if (!force && cached && now < expiresAt) return cached;
    if (pending) return pending;

    pending = Promise.resolve()
      .then(loader)
      .then((value) => {
        cached = value;
        expiresAt = Date.now() + ttlMs;
        staleUntil = expiresAt + staleMs;
        return value;
      })
      .catch((error) => {
        if (cached && Date.now() < staleUntil) {
          console.warn(`[KEY backend] serving stale ${label}: ${error.message}`);
          return cached;
        }
        throw error;
      })
      .finally(() => {
        pending = null;
      });

    return pending;
  }

  return {
    get,
    clear() {
      cached = null;
      expiresAt = 0;
      staleUntil = 0;
    }
  };
}

function clearLiveCaches() {
  statsCache.clear();
  proofListCache.clear();
  liquidityCache.clear();
  statusCache.clear();
}

function saveCanonicalMessage(message) {
  fs.mkdirSync(CONFIG.proofDataDir, { recursive: true });
  fs.writeFileSync(path.join(CONFIG.proofDataDir, 'message.txt'), message, 'utf8');
}

function pythonCommand() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

async function runPython(scriptName, args = []) {
  const python = pythonCommand();
  const script = path.join(PROJECT_ROOT, 'backend', 'verifier', scriptName);
  return runSphincsJob(() => execFileAsync(python, [script, ...args], { cwd: PROJECT_ROOT, timeout: 120_000 }));
}

function cleanupAssistedKeys() {
  const now = Date.now();
  for (const [hash, item] of assistedSphincsKeys.entries()) {
    if (now - item.createdAt > ASSISTED_KEY_TTL_MS) assistedSphincsKeys.delete(hash);
  }
}

async function deriveSphincsPublicKey(privateKey) {
  const python = pythonCommand();
  const script = path.join(PROJECT_ROOT, 'backend', 'vendor', 'sphincsminus', 'sphincs_minus.py');
  const result = await runSphincsJob(() => execFileAsync(python, [script, 'privtopub', privateKey], {
    cwd: path.dirname(script),
    timeout: 120_000
  }));
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/0x[0-9a-fA-F]+/);
  if (!match) throw new Error('could not derive SPHINCS public key');
  return match[0];
}

async function signAssistedSphincs(privateKey, message) {
  const messageB64 = Buffer.from(message, 'utf8').toString('base64');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-sphincs-'));
  const sigFile = path.join(tempDir, 'signature.bin');
  try {
    await runPython('sign_sphincsminus.py', [privateKey, messageB64, sigFile]);
    return `0x${fs.readFileSync(sigFile).toString('hex')}`;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function liveStatsUncached() {
  const proofStats = store.stats();
  if (!chainProvider || CONFIG.mintGateAddress === ethers.ZeroAddress) {
    return { ...proofStats, source: 'proofs' };
  }

  try {
    let publicMinted = 0n;
    let totalMintFeesReceived = 0n;

    if (CONFIG.mintGateAddress !== ethers.ZeroAddress) {
      const mintGate = new ethers.Contract(CONFIG.mintGateAddress, mintGateStatsAbi, chainProvider);
      publicMinted = await mintGate.publicMinted();
    } else if (CONFIG.keyTokenAddress !== ethers.ZeroAddress) {
      const token = new ethers.Contract(CONFIG.keyTokenAddress, tokenStatsAbi, chainProvider);
      publicMinted = await token.publicMintedByGate();
    }

    if (CONFIG.treasuryVaultAddress !== ethers.ZeroAddress) {
      const vault = new ethers.Contract(CONFIG.treasuryVaultAddress, treasuryVaultStatsAbi, chainProvider);
      totalMintFeesReceived = await vault.totalMintFeesReceived();
    }
    const mintPriceWei = ethers.parseEther(TOKENOMICS.mintPriceEth);
    const successfulMints = mintPriceWei > 0n ? Number(totalMintFeesReceived / mintPriceWei) : 0;
    const confirmedProofs = await listMintedProofsUncached(PROOF_CACHE_MAX_RECORDS, 0);
    const confirmedByTier = {};
    for (const proof of confirmedProofs) {
      confirmedByTier[proof.tier.name] = (confirmedByTier[proof.tier.name] || 0) + 1;
    }

    return {
      totalProofs: successfulMints,
      attestationRecords: proofStats.totalProofs,
      mintedTokens: Number(ethers.formatEther(publicMinted)),
      ethRaised: Number(ethers.formatEther(totalMintFeesReceived)),
      byTier: confirmedByTier,
      attestationByTier: proofStats.byTier,
      source: 'chain',
      lastUpdated: new Date().toISOString()
    };
  } catch {
    return {
      ...proofStats,
      source: 'proofs',
      chainError: 'live chain stats unavailable'
    };
  }
}

async function optionalCall(contract, method, fallback, ...args) {
  try {
    return await contract[method](...args);
  } catch {
    return fallback;
  }
}

async function liveLiquidityStateUncached() {
  const poolId = CONFIG.uniswapV4PoolId || 'not created';
  const hookAddress = CONFIG.uniswapV4HookAddress || ethers.ZeroAddress;
  const state = {
    status: poolId && poolId !== 'TBA' && poolId !== 'not created' ? 'pool configured' : 'not launched',
    trading: 'pool initialized; trading starts after official liquidity is added',
    poolId,
    hookAddress,
    poolManager: CONFIG.uniswapV4PoolManager,
    initializeTx: CONFIG.uniswapV4InitializeTx,
    pair: 'KEY/WETH',
    initialPrice: CONFIG.uniswapV4InitialPrice || '1 ETH = 500,000 KEY',
    fee: CONFIG.uniswapV4Fee || '10000',
    tickSpacing: CONFIG.uniswapV4TickSpacing || '200',
    hookStatus: isZeroAddressLike(hookAddress) ? 'none' : 'configured',
    custody: 'LP reserve and treasury reserve are held by configured reserve wallets. User-minted KEY stays in user wallets.',
    addresses: {
      token: CONFIG.keyTokenAddress,
      mintGate: CONFIG.mintGateAddress,
      treasuryVault: CONFIG.treasuryVaultAddress,
      lpReserve: CONFIG.lpReserveAddress,
      treasuryReserve: CONFIG.treasuryReserveAddress,
      contractOwner: CONFIG.contractOwnerAddress
    },
    balances: {},
    controls: {}
  };

  if (!chainProvider) return state;

  try {
    if (CONFIG.keyTokenAddress !== ethers.ZeroAddress) {
      const token = new ethers.Contract(CONFIG.keyTokenAddress, tokenStatsAbi, chainProvider);
      state.controls.tokenOwner = await optionalCall(token, 'owner', ethers.ZeroAddress);
      state.controls.tokenMintGate = await optionalCall(token, 'mintGate', ethers.ZeroAddress);
      state.balances.totalSupplyKEY = Number(ethers.formatEther(await optionalCall(token, 'totalSupply', 0n)));
      if (CONFIG.lpReserveAddress !== ethers.ZeroAddress) {
        state.balances.lpReserveKEY = Number(ethers.formatEther(await optionalCall(token, 'balanceOf', 0n, CONFIG.lpReserveAddress)));
      }
      if (CONFIG.treasuryReserveAddress !== ethers.ZeroAddress) {
        state.balances.treasuryReserveKEY = Number(ethers.formatEther(await optionalCall(token, 'balanceOf', 0n, CONFIG.treasuryReserveAddress)));
      }
    }

    if (CONFIG.treasuryVaultAddress !== ethers.ZeroAddress) {
      const vault = new ethers.Contract(CONFIG.treasuryVaultAddress, treasuryVaultStatsAbi, chainProvider);
      state.controls.vaultOwner = await optionalCall(vault, 'owner', ethers.ZeroAddress);
      state.controls.vaultMintGate = await optionalCall(vault, 'mintGate', ethers.ZeroAddress);
      state.controls.liquidityManager = await optionalCall(vault, 'liquidityManager', ethers.ZeroAddress);
      state.balances.vaultETH = Number(ethers.formatEther(await chainProvider.getBalance(CONFIG.treasuryVaultAddress)));
      state.balances.totalMintFeesReceivedETH = Number(ethers.formatEther(await optionalCall(vault, 'totalMintFeesReceived', 0n)));
      state.balances.totalEthRoutedETH = Number(ethers.formatEther(await optionalCall(vault, 'totalEthRouted', 0n)));
    }
  } catch {
    state.error = 'live liquidity state unavailable';
  }

  return state;
}

function isZeroAddressLike(address) {
  return !address || address === 'TBA' || address === 'not created' || address === ethers.ZeroAddress || /^0x0{40}$/i.test(address);
}

async function listMintedProofsUncached(limit, offset) {
  const localProofs = store.list(Math.min(Math.max(limit + offset, 100), PROOF_CACHE_MAX_RECORDS), 0);
  if (!chainProvider || CONFIG.mintGateAddress === ethers.ZeroAddress) {
    return localProofs.slice(offset, offset + limit);
  }

  const mintGate = new ethers.Contract(CONFIG.mintGateAddress, mintGateStatsAbi, chainProvider);
  const checks = await Promise.allSettled(localProofs.map(async (proof) => ({
    proof,
    minted: await mintGate.usedProofId(proof.proofId)
  })));
  return checks
    .filter((result) => result.status === 'fulfilled' && result.value.minted)
    .map((result) => result.value.proof)
    .slice(offset, offset + limit);
}

const statsCache = createAsyncCache('stats', liveStatsUncached, STATS_CACHE_TTL_MS);
const liquidityCache = createAsyncCache('liquidity', liveLiquidityStateUncached, LIQUIDITY_CACHE_TTL_MS);
const proofListCache = createAsyncCache(
  'proof list',
  () => listMintedProofsUncached(PROOF_CACHE_MAX_RECORDS, 0),
  PROOFS_CACHE_TTL_MS
);

async function liveStats(options) {
  return statsCache.get(options);
}

async function liveLiquidityState(options) {
  return liquidityCache.get(options);
}

async function listMintedProofs(limit, offset, options) {
  if (options?.force) proofListCache.clear();
  const proofs = await proofListCache.get(options);
  return proofs.slice(offset, offset + limit);
}

async function countWalletMints(recipient) {
  if (!chainProvider || CONFIG.mintGateAddress === ethers.ZeroAddress) {
    return store.countWallet(recipient);
  }

  const mintGate = new ethers.Contract(CONFIG.mintGateAddress, mintGateStatsAbi, chainProvider);
  const count = await mintGate.walletMints(recipient);
  return Number(count);
}

async function publicStatus() {
  const chainId = CONFIG.chainId;
  const currentEpoch = Math.floor(Date.now() / (1000 * 60 * 10));
  return {
    ok: true,
    project: 'KEY',
    mode: CONFIG.sphincsVerifyMode,
    signer: signer.address,
    mintGate: CONFIG.mintGateAddress,
    chainId,
    currentEpoch,
    tokenomics: TOKENOMICS,
    tiers: TIERS,
    stats: await liveStats(),
    liquidity: await liveLiquidityState(),
    formulas: {
      signatureHash: 'keccak256(signature)',
      rewardHash: 'keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)',
      proofId: 'keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId, KEY_PROOF_V1)'
    }
  };
}

const statusCache = createAsyncCache('status', publicStatus, STATS_CACHE_TTL_MS);

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/status', async (req, res) => res.json(await statusCache.get({ force: req.query.refresh === '1' })));
app.get('/api/stats', async (req, res) => {
  const options = { force: req.query.refresh === '1' };
  res.json({
    ok: true,
    stats: await liveStats(options),
    tokenomics: TOKENOMICS,
    liquidity: await liveLiquidityState(options)
  });
});

app.get('/api/message', (req, res) => {
  try {
    const recipient = req.query.recipient;
    const publicKeyHash = req.query.publicKeyHash;
    const epoch = Number(req.query.epoch || Math.floor(Date.now() / (1000 * 60 * 10)));
    const chainId = Number(req.query.chainId || CONFIG.chainId);
    if (!ethers.isAddress(recipient)) throw new Error('recipient query is required');
    if (!/^0x[0-9a-fA-F]{64}$/.test(publicKeyHash)) throw new Error('publicKeyHash query must be bytes32');
    assertConfiguredChain(chainId);
    const message = buildCanonicalMessage({ recipient, publicKeyHash, epoch, chainId });
    saveCanonicalMessage(message);
    res.json({ ok: true, message, epoch, chainId });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/challenge', (req, res) => {
  try {
    const input = ChallengeSchema.parse(req.body);
    assertConfiguredChain(input.chainId);
    const message = buildCanonicalMessage(input);
    saveCanonicalMessage(message);
    const challenge = challenges.issue({ ...input, message });
    res.json({ ok: true, challenge });
  } catch (error) {
    const message = error?.errors?.[0]?.message || error.message || 'unknown error';
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/attest', attestLimiter, async (req, res) => {
  try {
    const input = AttestSchema.parse(req.body);
    const recipient = ethers.getAddress(input.recipient);
    const verifyingContract = ethers.getAddress(input.verifyingContract);
    const chainId = input.chainId;
    assertConfiguredChain(chainId);

    if (CONFIG.mintGateAddress !== ethers.ZeroAddress && verifyingContract !== CONFIG.mintGateAddress) {
      throw new Error('verifyingContract does not match configured MINT_GATE_ADDRESS');
    }

    if ((await countWalletMints(recipient)) >= TOKENOMICS.walletCap) {
      throw new Error(`wallet cap reached: ${TOKENOMICS.walletCap} mints`);
    }

    let canonicalMessage = buildCanonicalMessage({ recipient, publicKeyHash: input.publicKeyHash, epoch: input.epoch, chainId });
    if (input.challengeId) {
      const challenge = challenges.consume(input.challengeId, recipient);
      canonicalMessage = challenge.message;
    }

    await verifyWalletOwnership({
      recipient,
      publicKeyHash: input.publicKeyHash,
      epoch: input.epoch,
      chainId,
      walletSignature: input.walletSignature,
      message: canonicalMessage
    });

    const sphincsVerification = await verifySphincsProof({ ...input, canonicalMessage });
    const rawSignature = input.sphincsSignature || input.walletSignature;
    const signatureHash = computeSignatureHash(rawSignature);

    const signed = await signMintAttestation({
      signer,
      recipient,
      publicKeyHash: input.publicKeyHash,
      signatureHash,
      epoch: input.epoch,
      chainId,
      verifyingContract
    });

    const record = store.add({
      recipient,
      publicKeyHash: input.publicKeyHash,
      signatureHash,
      rewardHash: signed.rewardHash,
      proofId: signed.proofId,
      tier: signed.tier,
      epoch: input.epoch,
      chainId,
      verifyingContract,
      attestation: signed.attestation,
      typedData: signed.value,
      attestationSigner: signer.address,
      canonicalMessage,
      sphincsVerification,
      mode: CONFIG.sphincsVerifyMode
    });
    clearLiveCaches();

    res.json({ ok: true, ...record });
  } catch (error) {
    const message = error?.errors?.[0]?.message || error.message || 'unknown error';
    res.status(400).json({ ok: false, error: message });
  }
});

app.get('/api/proofs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const options = { force: req.query.refresh === '1' };
  res.json({ ok: true, proofs: await listMintedProofs(limit, offset, options), stats: await liveStats(options) });
});

app.get('/api/proofs/:id', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ ok: false, error: 'proof not found' });
  res.json({ ok: true, proof: record });
});

app.post('/api/export', async (_req, res) => {
  const snapshot = store.exportSnapshot({ exportedAt: new Date().toISOString(), status: await statusCache.get() });
  res.json({ ok: true, snapshot });
});

app.post('/api/sphincs/key', sphincsKeyLimiter, async (_req, res) => {
  try {
    cleanupAssistedKeys();
    const privateKey = `0x${crypto.randomBytes(32).toString('hex')}`;
    const publicKey = await deriveSphincsPublicKey(privateKey);
    const publicKeyHash = ethers.keccak256(publicKey);
    assistedSphincsKeys.set(publicKeyHash.toLowerCase(), {
      privateKey,
      publicKey,
      createdAt: Date.now()
    });
    res.json({ ok: true, publicKey, publicKeyHash, expiresInSeconds: Math.floor(ASSISTED_KEY_TTL_MS / 1000) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.stderr?.trim() || error.message });
  }
});

app.post('/api/sphincs/sign', sphincsSignLimiter, async (req, res) => {
  try {
    cleanupAssistedKeys();
    const schema = z.object({
      publicKeyHash: hex32,
      message: z.string().min(1)
    });
    const input = schema.parse(req.body);
    const keyId = input.publicKeyHash.toLowerCase();
    const item = assistedSphincsKeys.get(keyId);
    if (!item) throw new Error('SPHINCS key expired or not generated in this session');
    const keyHashLine = `publicKeyHash=${input.publicKeyHash}`;
    const purposeLine = 'purpose=Proof-of-Signature Hash';
    if (!input.message.includes(keyHashLine) || !input.message.includes(purposeLine)) {
      throw new Error('SPHINCS message does not match generated key');
    }
    const signatureHex = await signAssistedSphincs(item.privateKey, input.message);
    assistedSphincsKeys.delete(keyId);
    res.json({ ok: true, publicKey: item.publicKey, signatureHex });
  } catch (error) {
    const message = error?.errors?.[0]?.message || error.stderr?.trim() || error.message || 'unknown error';
    res.status(400).json({ ok: false, error: message });
  }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'not found' }));

app.listen(CONFIG.port, () => {
  console.log(`[KEY backend] http://localhost:${CONFIG.port}`);
  console.log(`[KEY backend] attestation signer ${signer.address}`);
  console.log(`[KEY backend] SPHINCS_VERIFY_MODE=${CONFIG.sphincsVerifyMode}`);
});
