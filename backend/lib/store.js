import fs from 'node:fs';
import path from 'node:path';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export class ProofStore {
  constructor(dir) {
    this.dir = dir;
    ensureDir(dir);
    this.proofLog = path.join(dir, 'proofs.jsonl');
    this.snapshot = path.join(dir, 'snapshot.json');
    this.records = new Map();
    this.byWallet = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.proofLog)) return;
    const lines = fs.readFileSync(this.proofLog, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        this.records.set(record.proofId.toLowerCase(), record);
        this.records.set(record.publicKeyHash.toLowerCase(), record);
        const wallet = record.recipient.toLowerCase();
        const arr = this.byWallet.get(wallet) || [];
        arr.push(record.proofId.toLowerCase());
        this.byWallet.set(wallet, arr);
      } catch {}
    }
  }

  add(record) {
    const normalized = {
      ...record,
      createdAt: record.createdAt || new Date().toISOString()
    };
    const proofKey = normalized.proofId.toLowerCase();
    const pkKey = normalized.publicKeyHash.toLowerCase();
    if (this.records.has(proofKey)) throw new Error('proof already exists');
    if (this.records.has(pkKey)) throw new Error('public key already used');
    this.records.set(proofKey, normalized);
    this.records.set(pkKey, normalized);
    const wallet = normalized.recipient.toLowerCase();
    const arr = this.byWallet.get(wallet) || [];
    arr.push(proofKey);
    this.byWallet.set(wallet, arr);
    fs.appendFileSync(this.proofLog, JSON.stringify(normalized) + '\n');
    return normalized;
  }

  get(id) {
    if (!id) return null;
    return this.records.get(id.toLowerCase()) || null;
  }

  list(limit = 50, offset = 0) {
    const unique = [];
    const seen = new Set();
    for (const record of this.records.values()) {
      if (seen.has(record.proofId)) continue;
      seen.add(record.proofId);
      unique.push(record);
    }
    unique.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return unique.slice(offset, offset + limit);
  }

  countWallet(address) {
    return (this.byWallet.get(address.toLowerCase()) || []).length;
  }

  stats() {
    const unique = this.list(1_000_000, 0);
    const mintedTokens = unique.reduce((sum, p) => sum + Number(p.tier.reward), 0);
    const ethRaised = unique.length * 0.001;
    const byTier = {};
    for (const p of unique) byTier[p.tier.name] = (byTier[p.tier.name] || 0) + 1;
    return {
      totalProofs: unique.length,
      mintedTokens,
      ethRaised: Number(ethRaised.toFixed(6)),
      byTier,
      lastUpdated: new Date().toISOString()
    };
  }

  exportSnapshot(extra = {}) {
    const payload = { ...extra, stats: this.stats(), proofs: this.list(1_000_000, 0) };
    fs.writeFileSync(this.snapshot, JSON.stringify(payload, null, 2));
    return payload;
  }
}
