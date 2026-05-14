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
  { name: 'ai.key', origin: 'Genesis Origin', keyBond: '21000', market: 'Auction Preview', status: 'Not Live' },
  { name: 'hash.key', origin: 'Quantum Origin', keyBond: '5000', exampleListing: '55000', status: 'Preview' },
  { name: 'alpha.key', origin: 'Golden Origin', keyBond: '1500', exampleListing: '20000', status: 'Preview' },
  { name: 'terminal.key', origin: 'Normal Origin', keyBond: '500', exampleListing: '3000', status: 'Preview' }
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

function isZeroAddress(address) {
  return !address || address === ethers.ZeroAddress || /^0x0{40}$/i.test(address);
}

function normalizeName(name = '') {
  return String(name).trim().toLowerCase().replace(/\.key$/i, '');
}

function isValidKeyspaceName(name = '') {
  return /^[a-z]+$/.test(normalizeName(name));
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
    const state = await snapshot(options);
    const identity = state.claims.find((claim) => claim.tokenId === String(tokenId)) || null;
    const displayName = identity?.name || `KEYSPACE Preview #${tokenId}`;
    return {
      name: displayName,
      description: state.contractsLive
        ? 'KEYSPACE .key identity metadata.'
        : 'Preview metadata only. KEYSPACE contracts are not live yet.',
      image: null,
      contractsLive: state.contractsLive,
      attributes: [
        { trait_type: 'Status', value: state.contractsLive ? 'Indexed' : 'Preview' },
        { trait_type: 'Origin Rank', value: identity?.originRank ?? 'Preview' },
        { trait_type: 'KeyBond', value: identity?.keyBond ?? 'Preview' }
      ]
    };
  }

  return { status, wallet, name, listings, sales, metadata, snapshot };
}
