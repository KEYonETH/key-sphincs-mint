import 'dotenv/config';
import { ProofStore } from '../backend/lib/store.js';
import { CONFIG } from '../backend/lib/config.js';

const store = new ProofStore(CONFIG.proofDataDir);
const snapshot = store.exportSnapshot({ exportedAt: new Date().toISOString(), format: 'KEY_PROOF_SNAPSHOT_V1' });
console.log(JSON.stringify({ ok: true, file: `${CONFIG.proofDataDir}/snapshot.json`, stats: snapshot.stats }, null, 2));
