import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../backend/lib/config.js';

const src = path.join(CONFIG.proofDataDir, 'proofs.jsonl');
const backupDir = process.env.PROOF_BACKUP_DIR || path.join(CONFIG.proofDataDir, 'backups');
const keep = Number(process.env.PROOF_BACKUP_KEEP || 30);
const out = path.join(backupDir, `proofs-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`);
if (!fs.existsSync(src)) {
  console.error('proof log not found:', src);
  process.exit(1);
}
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(src, out);

const backups = fs.readdirSync(backupDir)
  .filter((name) => /^proofs-backup-.*\.jsonl$/.test(name))
  .map((name) => ({
    name,
    file: path.join(backupDir, name),
    mtimeMs: fs.statSync(path.join(backupDir, name)).mtimeMs
  }))
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

for (const backup of backups.slice(Math.max(keep, 1))) {
  fs.rmSync(backup.file, { force: true });
}

console.log(JSON.stringify({
  ok: true,
  backup: out,
  retainedBackups: Math.min(backups.length, Math.max(keep, 1))
}, null, 2));
