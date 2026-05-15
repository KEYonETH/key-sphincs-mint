import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { CONFIG } from './config.js';

const PREVIEW_STATUS = Object.freeze({
  live: false,
  phase: 'preview',
  keySupply: '21000000',
  identitySupply: '21000',
  claimed: 0,
  marketplaceLive: false,
  originClaimsOpen: false,
  mintRule: 'one mint per wallet',
  claimRule: 'one non-transferable Origin Claim Right per minting wallet',
  rankRules: {
    Genesis: { minLength: 3, reward: '21000' },
    Quantum: { minLength: 4, reward: '5000' },
    Golden: { minLength: 5, reward: '1500' },
    Clean: { minLength: 6, reward: '750' },
    Normal: { minLength: 7, reward: '500' }
  },
  nameRules: {
    pattern: '^[a-z]+$',
    alphabet: 'lowercase English letters a-z only',
    recommendedMaxLength: 16
  }
});

const PREVIEW_LISTINGS = Object.freeze([
  { name: 'ai.key', origin: 'Genesis Origin', keyBond: '21000', market: 'Auction Preview', paymentToken: 'ETH', status: 'Not Live' },
  { name: 'hash.key', origin: 'Quantum Origin', keyBond: '5000', exampleListing: '0.11', paymentToken: 'ETH', status: 'Preview' },
  { name: 'alpha.key', origin: 'Golden Origin', keyBond: '1500', exampleListing: '0.04', paymentToken: 'ETH', status: 'Preview' },
  { name: 'terminal.key', origin: 'Normal Origin', keyBond: '500', exampleListing: '0.006', paymentToken: 'ETH', status: 'Preview' }
]);

const mintGateAbi = [
  'event KeyMinted(address indexed minter, bytes32 indexed proofId, bytes32 indexed publicKeyHash, uint256 rewardAmount, uint8 rank)',
  'event Minted(address indexed recipient, bytes32 indexed proofId, bytes32 indexed publicKeyHash, bytes32 signatureHash, bytes32 rewardHash, uint256 rewardAmount, uint256 epoch, uint256 feePaid)'
];
const registrarAbi = [
  'event IdentityClaimed(address indexed owner, uint256 indexed tokenId, string name, uint8 originRank, uint256 keyBond)',
  'function originClaimsOpen() view returns (bool)'
];
const marketAbi = [
  'event IdentityListed(uint256 indexed tokenId, address indexed seller, uint256 price)',
  'event IdentityListingCancelled(uint256 indexed tokenId, address indexed seller)',
  'event IdentitySold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)',
  'function marketOpen() view returns (bool)'
];
const identityAbi = [
  'function identityOf(uint256 tokenId) view returns (tuple(string name,uint8 originRank,uint256 keyBond,address originWallet,bytes32 originProofId,bool melted))',
  'function nameOf(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)'
];
const RANK_NAMES = Object.freeze(['Normal', 'Clean', 'Golden', 'Quantum', 'Genesis']);
const KEYCARD_STYLES = Object.freeze({
  Normal: { accent: '#8f8a80', deep: '#3e3a35', glow: '#f2f0ea', soft: '#f7f5ef' },
  Clean: { accent: '#2f6f34', deep: '#173f1e', glow: '#e9f5e7', soft: '#f3fbf1' },
  Golden: { accent: '#d69b12', deep: '#3a2814', glow: '#fff1ba', soft: '#fff8df' },
  Quantum: { accent: '#7a5bdb', deep: '#37256f', glow: '#eee8ff', soft: '#f6f2ff' },
  Genesis: { accent: '#df6f91', deep: '#64223a', glow: '#ffe5ee', soft: '#fff2f6' }
});
const numberFormat = new Intl.NumberFormat('en-US');

function isZeroAddress(address) {
  return !address || address === ethers.ZeroAddress || /^0x0{40}$/i.test(address);
}

function normalizeName(name = '') {
  return String(name).trim().toLowerCase().replace(/\.key$/i, '');
}

function isValidKeyspaceName(name = '') {
  return /^[a-z]+$/.test(normalizeName(name));
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function metadataBaseUrl() {
  return String(
    process.env.API_BASE_URL ||
    process.env.KEYSPACE_PUBLIC_API_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.VITE_BACKEND_URL ||
    'https://api.key-sphincs.xyz'
  ).replace(/\/$/, '');
}

function siteBaseUrl() {
  return String(
    process.env.KEYSPACE_PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    'https://www.key-sphincs.xyz'
  ).replace(/\/$/, '');
}

function keyPerEthReference() {
  const direct = Number(String(process.env.KEYSPACE_KEY_PER_ETH || process.env.KEY_PER_ETH || '').replace(/,/g, ''));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const priceText = CONFIG.uniswapV4InitialPrice || '1 ETH = 500,000 KEY';
  const match = String(priceText).match(/1\s*ETH\s*=\s*([\d,._]+)\s*KEY/i);
  const parsed = match ? Number(match[1].replace(/[,_]/g, '')) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500_000;
}

function formatEth(value) {
  return Number(value).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function rankName(originRank) {
  return RANK_NAMES[Number(originRank)] || 'Unknown';
}

function normalizeRank(rank = 'Normal') {
  if (Number.isInteger(Number(rank)) && RANK_NAMES[Number(rank)]) return RANK_NAMES[Number(rank)];
  const label = String(rank)
    .replace(/\.key$/i, '')
    .replace(/\s+origin$/i, '')
    .replace(/\s+key$/i, '')
    .trim()
    .toLowerCase();
  return RANK_NAMES.find((name) => name.toLowerCase() === label) || 'Normal';
}

function sanitizeIdentityName(name = '') {
  const normalized = normalizeName(name);
  return isValidKeyspaceName(normalized) ? normalized : 'identity';
}

function formatKeyBond(value = '0') {
  const raw = String(value).replace(/\s*KEY$/i, '').replace(/,/g, '').trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return `${numberFormat.format(numeric)} KEY`;
  return `${String(value).replace(/\s*KEY$/i, '').trim()} KEY`;
}

function formatMintProof(value = '', tokenId = '') {
  const raw = String(value || '').trim();
  if (!raw || raw === ethers.ZeroHash) return `#${tokenId}`;
  if (raw.startsWith('#')) return raw;
  if (/^\d+$/.test(raw)) return `#${raw}`;
  if (/^0x[0-9a-f]{64}$/i.test(raw)) {
    return `#${(BigInt(raw) % 10000n).toString().padStart(4, '0')}`;
  }
  const compact = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return compact ? `#${compact}` : `#${tokenId}`;
}

function formatTokenId(tokenId = '') {
  return `#${String(tokenId).replace(/\D/g, '') || '0'}`;
}

function assertTokenId(tokenId) {
  const normalized = String(tokenId ?? '').trim();
  if (!/^\d+$/.test(normalized)) throw new Error('tokenId must be numeric');
  return normalized;
}

export function renderKeyIdentitySvg({ name, rank, keyBond, mintProof, tokenId }) {
  const normalizedTokenId = assertTokenId(tokenId);
  const normalizedRank = normalizeRank(rank);
  const style = KEYCARD_STYLES[normalizedRank] || KEYCARD_STYLES.Normal;
  const cleanName = sanitizeIdentityName(name);
  const displayName = escapeXml(`${cleanName}.key`);
  const nameSize = Math.max(54, Math.min(92, Math.floor(820 / Math.max(cleanName.length + 4, 9))));
  const origin = escapeXml(`${normalizedRank} Origin`);
  const bond = escapeXml(formatKeyBond(keyBond));
  const proof = escapeXml(formatMintProof(mintProof, normalizedTokenId));
  const id = escapeXml(formatTokenId(normalizedTokenId));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1122" height="1402" viewBox="0 0 1122 1402" role="img" aria-label="${displayName} KEYSPACE identity">
  <defs>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${style.glow}"/>
      <stop offset="0.28" stop-color="${style.accent}"/>
      <stop offset="0.55" stop-color="#fffdf6"/>
      <stop offset="1" stop-color="${style.deep}"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${style.soft}"/>
      <stop offset="0.45" stop-color="#fffaf0"/>
      <stop offset="1" stop-color="#f8efe0"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="30%" r="75%">
      <stop offset="0" stop-color="${style.glow}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="${style.deep}" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="1122" height="1402" fill="none"/>
  <rect x="144" y="84" width="834" height="1234" rx="48" fill="url(#frame)" filter="url(#shadow)"/>
  <rect x="166" y="106" width="790" height="1190" rx="38" fill="url(#paper)" stroke="#fff9e8" stroke-width="7"/>
  <rect x="184" y="124" width="754" height="1154" rx="30" fill="none" stroke="${style.accent}" stroke-width="2" opacity="0.78"/>
  <rect x="184" y="124" width="754" height="1154" rx="30" fill="url(#halo)" opacity="0.75"/>

  <text x="561" y="262" text-anchor="middle" font-family="IBM Plex Mono, Courier New, monospace" font-size="28" font-weight="700" letter-spacing="10" fill="${style.accent}">KEYSPACE IDENTITY</text>
  <line x1="286" y1="336" x2="520" y2="336" stroke="${style.accent}" stroke-width="1.3" opacity="0.35"/>
  <path d="M561 326 L571 336 L561 346 L551 336 Z" fill="${style.accent}"/>
  <line x1="602" y1="336" x2="836" y2="336" stroke="${style.accent}" stroke-width="1.3" opacity="0.35"/>

  <text x="561" y="548" text-anchor="middle" font-family="Georgia, Times New Roman, serif" font-size="${nameSize}" font-weight="500" letter-spacing="1" fill="${style.deep}">${displayName}</text>
  <text x="561" y="622" text-anchor="middle" font-family="IBM Plex Mono, Courier New, monospace" font-size="28" font-weight="700" letter-spacing="8" fill="${style.accent}">SPHINCS ORIGIN IDENTITY</text>
  <line x1="286" y1="702" x2="520" y2="702" stroke="${style.accent}" stroke-width="1.3" opacity="0.35"/>
  <path d="M561 692 L571 702 L561 712 L551 702 Z" fill="${style.accent}"/>
  <line x1="602" y1="702" x2="836" y2="702" stroke="${style.accent}" stroke-width="1.3" opacity="0.35"/>

  <rect x="222" y="774" width="678" height="362" rx="30" fill="#fffdf8" fill-opacity="0.6" stroke="${style.accent}" stroke-width="1.6"/>
  <g font-family="IBM Plex Mono, Courier New, monospace" font-size="29" fill="#17130d">
    <text x="272" y="845" letter-spacing="8">ORIGIN</text>
    <text x="848" y="845" text-anchor="end">${origin}</text>
    <line x1="260" y1="890" x2="862" y2="890" stroke="${style.accent}" stroke-width="2"/>
    <circle cx="260" cy="890" r="4" fill="${style.accent}"/><circle cx="862" cy="890" r="4" fill="${style.accent}"/>

    <text x="272" y="940" letter-spacing="8">KEYBOND</text>
    <text x="848" y="940" text-anchor="end">${bond}</text>
    <line x1="260" y1="984" x2="862" y2="984" stroke="${style.accent}" stroke-width="2"/>
    <circle cx="260" cy="984" r="4" fill="${style.accent}"/><circle cx="862" cy="984" r="4" fill="${style.accent}"/>

    <text x="272" y="1034" letter-spacing="8">MINT PROOF</text>
    <text x="848" y="1034" text-anchor="end">${proof}</text>
    <line x1="260" y1="1078" x2="862" y2="1078" stroke="${style.accent}" stroke-width="2"/>
    <circle cx="260" cy="1078" r="4" fill="${style.accent}"/><circle cx="862" cy="1078" r="4" fill="${style.accent}"/>

    <text x="272" y="1128" letter-spacing="8">TOKEN ID</text>
    <text x="848" y="1128" text-anchor="end">${id}</text>
  </g>

  <rect x="354" y="1182" width="414" height="58" rx="29" fill="#fffdf8" fill-opacity="0.7" stroke="${style.accent}" stroke-width="2"/>
  <text x="561" y="1221" text-anchor="middle" font-family="IBM Plex Mono, Courier New, monospace" font-size="22" font-weight="700" letter-spacing="7" fill="${style.accent}">KEY-BACKED IDENTITY</text>
</svg>`;
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function emptyState() {
  return {
    updatedAt: null,
    contractsLive: false,
    identityLive: false,
    registrarLive: false,
    marketLive: false,
    marketplaceLive: false,
    originClaimsOpen: false,
    mints: [],
    claims: [],
    listings: [],
    sales: []
  };
}

function safeAddress(value) {
  return ethers.isAddress(value || '') ? ethers.getAddress(value) : ethers.ZeroAddress;
}

function mintGateAddresses(primary) {
  return [primary, ...(CONFIG.legacyMintGateAddresses || [])]
    .map(safeAddress)
    .filter((address) => !isZeroAddress(address))
    .filter((address, index, addresses) => addresses.indexOf(address) === index);
}

export function createKeyspaceIndexer({ provider, dataDir = CONFIG.proofDataDir } = {}) {
  const cacheFile = path.join(dataDir, 'keyspace-index.json');
  let cache = loadCache();
  let pending = null;
  let expiresAt = 0;
  const ttlMs = Number(process.env.KEYSPACE_INDEX_TTL_MS || 30_000);

  function loadCache() {
    try {
      if (!fs.existsSync(cacheFile)) return emptyState();
      return { ...emptyState(), ...JSON.parse(fs.readFileSync(cacheFile, 'utf8')) };
    } catch {
      return emptyState();
    }
  }

  function saveCache(next) {
    ensureDir(cacheFile);
    fs.writeFileSync(cacheFile, JSON.stringify(next, null, 2));
  }

  async function hasCode(address) {
    if (!provider || isZeroAddress(address)) return false;
    try {
      return (await provider.getCode(address)) !== '0x';
    } catch {
      return false;
    }
  }

  async function queryEvents(address, abi, eventName, fromBlock, toBlock) {
    if (!provider || !(await hasCode(address))) return [];
    try {
      const contract = new ethers.Contract(address, abi, provider);
      return await contract.queryFilter(contract.filters[eventName](), fromBlock, toBlock);
    } catch (error) {
      console.warn(`[KEYSPACE indexer] ${eventName} unavailable: ${error.shortMessage || error.message}`);
      return [];
    }
  }

  async function queryBool(address, abi, functionName, fallback = false) {
    if (!provider || !(await hasCode(address))) return fallback;
    try {
      const contract = new ethers.Contract(address, abi, provider);
      return Boolean(await contract[functionName]());
    } catch (error) {
      console.warn(`[KEYSPACE indexer] ${functionName} unavailable: ${error.shortMessage || error.message}`);
      return fallback;
    }
  }

  async function readIdentity(tokenId) {
    const normalizedTokenId = String(tokenId);
    if (!provider || isZeroAddress(CONFIG.keyIdentityAddress)) return null;
    try {
      const contract = new ethers.Contract(CONFIG.keyIdentityAddress, identityAbi, provider);
      const [displayName, details, owner] = await Promise.all([
        contract.nameOf(normalizedTokenId),
        contract.identityOf(normalizedTokenId),
        contract.ownerOf(normalizedTokenId)
      ]);
      return {
        owner,
        tokenId: normalizedTokenId,
        name: displayName,
        rawName: details.name ?? details[0],
        originRank: Number(details.originRank ?? details[1] ?? 0),
        keyBond: ethers.formatEther(details.keyBond ?? details[2] ?? 0n),
        originWallet: details.originWallet ?? details[3],
        originProofId: details.originProofId ?? details[4],
        mintProof: details.originProofId ?? details[4],
        melted: Boolean(details.melted ?? details[5])
      };
    } catch {
      return null;
    }
  }

  function previewIdentity(tokenId) {
    if (String(tokenId) !== '421') return null;
    return {
      owner: ethers.ZeroAddress,
      tokenId: '421',
      name: 'alpha.key',
      rawName: 'alpha',
      originRank: 2,
      keyBond: '1500',
      originWallet: ethers.ZeroAddress,
      originProofId: '8842',
      mintProof: '8842',
      melted: false,
      preview: true
    };
  }

  async function identityForToken(tokenId, state) {
    const normalizedTokenId = assertTokenId(tokenId);
    return await readIdentity(normalizedTokenId) ||
      state.claims.find((claim) => claim.tokenId === normalizedTokenId) ||
      previewIdentity(normalizedTokenId);
  }

  async function refresh() {
    if (!provider) {
      cache = { ...emptyState(), updatedAt: new Date().toISOString() };
      saveCache(cache);
      return cache;
    }

    const addresses = {
      mintGate: safeAddress(CONFIG.keyMintGateAddress || CONFIG.mintGateAddress),
      identity: safeAddress(CONFIG.keyIdentityAddress),
      registrar: safeAddress(CONFIG.keyRegistrarAddress),
      market: safeAddress(CONFIG.keyMarketAddress)
    };
    const latest = await provider.getBlockNumber();
    const defaultRange = Number(process.env.KEYSPACE_INDEX_BLOCK_RANGE || 250_000);
    const fromBlock = Number(process.env.KEYSPACE_INDEX_FROM_BLOCK || Math.max(0, latest - defaultRange));
    const gateAddresses = mintGateAddresses(addresses.mintGate);
    const [mintGateLiveResults, identityLive, registrarLive, marketLive] = await Promise.all([
      Promise.all(gateAddresses.map((address) => hasCode(address))),
      hasCode(addresses.identity),
      hasCode(addresses.registrar),
      hasCode(addresses.market)
    ]);
    const liveMintGates = gateAddresses.filter((_, index) => mintGateLiveResults[index]);
    const contractsLive = identityLive && registrarLive && marketLive;
    const [originClaimsOpen, marketplaceLive] = await Promise.all([
      queryBool(addresses.registrar, registrarAbi, 'originClaimsOpen', false),
      queryBool(addresses.market, marketAbi, 'marketOpen', false)
    ]);
    const gateEvents = await Promise.all(liveMintGates.map(async (address) => {
      const [keyMinted, minted] = await Promise.all([
        queryEvents(address, mintGateAbi, 'KeyMinted', fromBlock, latest),
        queryEvents(address, mintGateAbi, 'Minted', fromBlock, latest)
      ]);
      return { keyMinted, minted };
    }));
    const keyMinted = gateEvents.flatMap((events) => events.keyMinted);
    const minted = gateEvents.flatMap((events) => events.minted);
    const mints = [
      ...keyMinted.map((event) => ({
        minter: event.args.minter,
        proofId: event.args.proofId,
        publicKeyHash: event.args.publicKeyHash,
        rewardAmount: ethers.formatEther(event.args.rewardAmount || 0n),
        rank: Number(event.args.rank || 0),
        txHash: event.transactionHash,
        blockNumber: event.blockNumber
      })),
      ...minted.map((event) => ({
        minter: event.args.recipient,
        proofId: event.args.proofId,
        publicKeyHash: event.args.publicKeyHash,
        rewardAmount: ethers.formatEther(event.args.rewardAmount || 0n),
        txHash: event.transactionHash,
        blockNumber: event.blockNumber
      }))
    ];

    const [claimed, listed, cancelled, sold] = await Promise.all([
      registrarLive ? queryEvents(addresses.registrar, registrarAbi, 'IdentityClaimed', fromBlock, latest) : [],
      marketLive ? queryEvents(addresses.market, marketAbi, 'IdentityListed', fromBlock, latest) : [],
      marketLive ? queryEvents(addresses.market, marketAbi, 'IdentityListingCancelled', fromBlock, latest) : [],
      marketLive ? queryEvents(addresses.market, marketAbi, 'IdentitySold', fromBlock, latest) : []
    ]);

    const sales = sold.map((event) => ({
      tokenId: event.args.tokenId?.toString(),
      seller: event.args.seller,
      buyer: event.args.buyer,
      price: ethers.formatEther(event.args.price || 0n),
      paymentToken: 'ETH',
      txHash: event.transactionHash,
      blockNumber: event.blockNumber
    }));

    const activeListings = new Map();
    const marketEvents = [
      ...listed.map((event) => ({ type: 'listed', event })),
      ...cancelled.map((event) => ({ type: 'cancelled', event })),
      ...sold.map((event) => ({ type: 'sold', event }))
    ].sort((a, b) => {
      if (a.event.blockNumber !== b.event.blockNumber) return a.event.blockNumber - b.event.blockNumber;
      return Number(a.event.index ?? a.event.logIndex ?? 0) - Number(b.event.index ?? b.event.logIndex ?? 0);
    });
    for (const { type, event } of marketEvents) {
      const tokenId = event.args.tokenId?.toString();
      if (!tokenId) continue;
      if (type === 'listed') {
        activeListings.set(tokenId, {
          tokenId,
          seller: event.args.seller,
          price: ethers.formatEther(event.args.price || 0n),
          paymentToken: 'ETH',
          txHash: event.transactionHash,
          blockNumber: event.blockNumber
        });
      } else {
        activeListings.delete(tokenId);
      }
    }
    const listings = [...activeListings.values()];

    cache = {
      updatedAt: new Date().toISOString(),
      contractsLive,
      identityLive,
      registrarLive,
      marketLive,
      marketplaceLive,
      originClaimsOpen,
      addresses,
      mints,
      claims: claimed.map((event) => ({
        owner: event.args.owner,
        tokenId: event.args.tokenId?.toString(),
        name: `${normalizeName(event.args.name)}.key`,
        originRank: Number(event.args.originRank || 0),
        keyBond: ethers.formatEther(event.args.keyBond || 0n),
        txHash: event.transactionHash,
        blockNumber: event.blockNumber
      })),
      listings,
      sales
    };
    saveCache(cache);
    return cache;
  }

  async function snapshot({ force = false } = {}) {
    const now = Date.now();
    if (!force && cache.updatedAt && now < expiresAt) return cache;
    if (!pending) {
      pending = refresh()
        .then((next) => {
          expiresAt = Date.now() + ttlMs;
          return next;
        })
        .catch((error) => {
          console.warn(`[KEYSPACE indexer] refresh failed: ${error.message}`);
          return cache;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  }

  async function status(options) {
    const state = await snapshot(options);
    const live = Boolean(state.originClaimsOpen || state.marketplaceLive);
    return {
      ...PREVIEW_STATUS,
      live,
      phase: live ? 'active' : 'preview',
      claimed: state.registrarLive ? state.claims.length : 0,
      marketplaceLive: state.marketplaceLive,
      originClaimsOpen: state.originClaimsOpen,
      contractsLive: state.contractsLive,
      identityLive: state.identityLive,
      registrarLive: state.registrarLive,
      marketLive: state.marketLive,
      updatedAt: state.updatedAt
    };
  }

  async function wallet(address, options) {
    const owner = ethers.getAddress(address);
    const state = await snapshot(options);
    const lower = owner.toLowerCase();
    return {
      ok: true,
      contractsLive: state.contractsLive,
      address: owner,
      mints: state.mints.filter((mint) => mint.minter?.toLowerCase() === lower),
      identities: state.claims.filter((claim) => claim.owner?.toLowerCase() === lower),
      listings: state.listings.filter((listing) => listing.seller?.toLowerCase() === lower)
    };
  }

  async function name(name, options) {
    const normalized = normalizeName(name);
    const state = await snapshot(options);
    const identity = state.claims.find((claim) => normalizeName(claim.name) === normalized) || null;
    return {
      ok: true,
      contractsLive: state.contractsLive,
      name: `${normalized}.key`,
      validName: isValidKeyspaceName(normalized),
      identity,
      status: state.contractsLive ? (identity ? 'claimed' : 'unknown') : 'preview',
      error: normalized && !isValidKeyspaceName(normalized) ? 'Only lowercase letters a-z are allowed.' : null
    };
  }

  async function listings(options) {
    const state = await snapshot(options);
    return {
      ok: true,
      contractsLive: state.contractsLive,
      marketplaceLive: state.marketplaceLive,
      listings: state.marketLive ? state.listings : [],
      previewExamples: state.marketplaceLive ? [] : PREVIEW_LISTINGS
    };
  }

  async function sales(options) {
    const state = await snapshot(options);
    return {
      ok: true,
      contractsLive: state.contractsLive,
      marketplaceLive: state.marketplaceLive,
      sales: state.marketLive ? state.sales : []
    };
  }

  async function metadata(tokenId, options) {
    const normalizedTokenId = assertTokenId(tokenId);
    const state = await snapshot(options);
    const identity = await identityForToken(normalizedTokenId, state);
    const displayName = identity?.name || `KEYSPACE Preview #${normalizedTokenId}`;
    const originLabel = identity ? `${normalizeRank(identity.originRank)} Origin` : 'Preview';
    const keyBond = identity ? formatKeyBond(identity.keyBond) : 'Preview';
    const mintProof = identity ? formatMintProof(identity.mintProof || identity.originProofId, normalizedTokenId) : formatTokenId(normalizedTokenId);
    return {
      name: displayName,
      description: 'A SPHINCS Origin Identity backed by KEY.',
      image: `${metadataBaseUrl()}/api/keyspace/image/${normalizedTokenId}.svg`,
      external_url: `${siteBaseUrl()}/#/keyspace/${normalizedTokenId}`,
      attributes: [
        { trait_type: 'Origin', value: originLabel },
        { trait_type: 'KeyBond', value: keyBond },
        { trait_type: 'Mint Proof', value: mintProof },
        { trait_type: 'Token ID', value: formatTokenId(normalizedTokenId) },
        { trait_type: 'Identity Type', value: 'SPHINCS Origin' }
      ]
    };
  }

  async function image(tokenId, options) {
    const normalizedTokenId = assertTokenId(tokenId);
    const state = await snapshot(options);
    const identity = await identityForToken(normalizedTokenId, state) || {
      name: 'identity.key',
      originRank: 0,
      keyBond: '0',
      mintProof: normalizedTokenId
    };
    return renderKeyIdentitySvg({
      name: identity.name || identity.rawName,
      rank: identity.originRank,
      keyBond: identity.keyBond,
      mintProof: identity.mintProof || identity.originProofId,
      tokenId: normalizedTokenId
    });
  }

  function quote(keyAmount = '500') {
    const amount = Number(String(keyAmount).replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Invalid KEY amount' };
    }
    const keyPerEth = keyPerEthReference();
    const ethEstimate = amount / keyPerEth;
    return {
      ok: true,
      keyAmount: String(amount),
      keyPerEth: String(keyPerEth),
      ethEstimate: formatEth(ethEstimate),
      source: 'configured KEY/ETH reference price',
      liveOracle: false,
      note: 'Estimate only. KEYSPACE primary listings are ETH-native; OpenSea ETH listings still require owner-signed marketplace orders.'
    };
  }

  return { status, wallet, name, listings, sales, metadata, image, quote, snapshot };
}
