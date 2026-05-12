import crypto from 'node:crypto';

export class ChallengeStore {
  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.map = new Map();
    setInterval(() => this.gc(), 60_000).unref?.();
  }

  issue({ recipient, publicKeyHash, epoch, chainId, message }) {
    const nonce = '0x' + crypto.randomBytes(16).toString('hex');
    const id = crypto.createHash('sha256').update(`${recipient}:${publicKeyHash}:${nonce}:${Date.now()}`).digest('hex');
    const expiresAt = Date.now() + this.ttlMs;
    const row = { id, nonce, recipient: recipient.toLowerCase(), publicKeyHash: publicKeyHash.toLowerCase(), epoch, chainId, message, expiresAt, used: false };
    this.map.set(id, row);
    return row;
  }

  consume(id, recipient) {
    const row = this.map.get(id);
    if (!row) throw new Error('challenge not found');
    if (row.used) throw new Error('challenge already used');
    if (Date.now() > row.expiresAt) throw new Error('challenge expired');
    if (row.recipient !== recipient.toLowerCase()) throw new Error('challenge recipient mismatch');
    row.used = true;
    return row;
  }

  gc() {
    const now = Date.now();
    for (const [id, row] of this.map.entries()) if (row.used || row.expiresAt < now) this.map.delete(id);
  }
}
