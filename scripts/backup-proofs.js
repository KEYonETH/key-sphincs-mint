import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../backend/lib/config.js';

const src = path.join(CONFIG.proofDataDir, 'proofs.jsonl');
const out = path.join(CONFIG.proofDataDir, `proofs-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`);
if (!fs.existsSync(src)) {
  console.error('proof log not found:', src);
  process.exit(1);
}
fs.copyFileSync(src, out);
console.log(JSON.stringify({ ok: true, backup: out }, null, 2));
