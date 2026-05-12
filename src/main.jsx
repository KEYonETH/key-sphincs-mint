import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ethers } from 'ethers';
import './styles.css';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';
const MINT_GATE = import.meta.env.VITE_MINT_GATE_ADDRESS || ethers.ZeroAddress;
const ZERO = ethers.ZeroAddress;

const FALLBACK = {
  tokenomics: {
    token: 'KEY', maxSupply: 21_000_000, publicMintPool: 10_000_000, lpReserve: 10_000_000,
    treasuryReserve: 1_000_000, mintPriceEth: '0.001', walletCap: 3, estimatedMints: 15600, network: 'Ethereum'
  },
  stats: { mintedTokens: 5_322_502, ethRaised: 10.645, totalProofs: 0, byTier: {} },
  tiers: [
    { name: 'Normal Key', reward: 500, odds: '80%' },
    { name: 'Clean Key', reward: 750, odds: '15%' },
    { name: 'Golden Key', reward: 1500, odds: '4%' },
    { name: 'Quantum Key', reward: 5000, odds: '0.9%' },
    { name: 'Genesis Key', reward: 21000, odds: '0.1%' }
  ],
  formulas: {
    signatureHash: 'keccak256(signature)',
    rewardHash: 'keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)',
    proofId: 'keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId, KEY_PROOF_V1)'
  }
};

const GATE_ABI = [
  'function mintWithAttestation((address recipient,bytes32 publicKeyHash,bytes32 signatureHash,bytes32 rewardHash,uint256 rewardAmount,uint256 epoch,uint256 deadline) a, bytes signature) external payable'
];

const fmt = new Intl.NumberFormat('en-US');
function short(x) { return x ? `${x.slice(0, 6)}...${x.slice(-4)}` : 'not connected'; }
function bytesToHex(bytes) { return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(''); }
function isZeroAddress(addr) { return !addr || addr === ZERO || /^0x0{40}$/i.test(addr); }
function pct(n, d) { return Math.min(100, Math.max(0, (Number(n || 0) / Number(d || 1)) * 100)); }
function signingCommand(message) {
  return `$privateKey = "0xPRIVATEKEY"
@'
${message || 'PASTE_CANONICAL_MESSAGE_HERE'}
'@ | Set-Content -NoNewline .\\backend\\data\\message.txt
$message = Get-Content .\\backend\\data\\message.txt -Raw
$messageB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($message))
python .\\backend\\verifier\\sign_sphincsminus.py $privateKey $messageB64 .\\backend\\data\\key_sig.bin
$bytes = [System.IO.File]::ReadAllBytes(".\\backend\\data\\key_sig.bin")
$sigHex = "0x" + (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
$sigHex | Set-Clipboard
$sigHex`;
}

function useRoute() {
  const [route, setRoute] = useState(() => window.location.hash.replace('#/', '') || 'home');
  useEffect(() => {
    const on = () => setRoute(window.location.hash.replace('#/', '') || 'home');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (r) => { window.location.hash = `/${r}`; setRoute(r); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return [route, go];
}

function Header({ route, go, wallet, connect }) {
  const nav = ['home', 'mint', 'proof', 'tokenomics', 'vault', 'whitepaper'];
  return <header className="topbar">
    <div className="brand" onClick={() => go('home')}>
      <div className="brandIcon">⌁</div>
      <div><div className="brandName">KEY</div><div className="brandSub">SPHINCS Signature Mint</div></div>
    </div>
    <nav>{nav.map(n => <button key={n} className={route === n ? 'on' : ''} onClick={() => go(n)}>{n}</button>)}</nav>
    <button className="connect" onClick={connect}>{wallet ? short(wallet) : 'connect wallet'}</button>
  </header>;
}

function StatusLine({ mode }) {
  return <div className="status"><span />{mode === 'preview' ? 'Demo mode active — SPHINCS verification is skipped for local testing.' : 'Production verifier active — SPHINCS proof required.'}</div>;
}

function TopStats({ data }) {
  const t = data.tokenomics;
  return <section className="statStrip">
    <Stat label="mint price" value={`${t.mintPriceEth} ETH`} />
    <Stat label="public mint pool" value={`${fmt.format(t.publicMintPool)} KEY`} />
    <Stat label="lp reserve" value={`${fmt.format(t.lpReserve)} KEY`} />
    <Stat label="treasury reserve" value={`${fmt.format(t.treasuryReserve)} KEY`} />
    <Stat label="est. mints" value={`±${fmt.format(t.estimatedMints)}`} />
    <Stat label="network" value={t.network} />
  </section>;
}
function Stat({ label, value }) { return <div className="stat"><small>{label}</small><b>{value}</b></div>; }

function Card({ title, children, className = '' }) {
  return <section className={`card ${className}`}><div className="cardTitle">{title}</div>{children}</section>;
}

function ProgressModule({ data }) {
  const t = data.tokenomics;
  const minted = data.stats.mintedTokens || FALLBACK.stats.mintedTokens;
  const percent = pct(minted, t.publicMintPool);
  const remaining = Math.max(t.publicMintPool - minted, 0);
  return <Card title="mint progress" className="progressCard">
    <div className="progressHead">
      <h2>{fmt.format(minted)} / {fmt.format(t.publicMintPool)} KEY</h2>
      <span className="pill">{percent.toFixed(2)}%</span>
    </div>
    <div className="bar"><i style={{ width: `${percent}%` }} /></div>
    <div className="miniGrid three">
      <Metric label="total minted tokens" value={`${fmt.format(minted)} KEY`} />
      <Metric label="eth raised" value={`${Number(data.stats.ethRaised || 0).toFixed(3)} ETH`} />
      <Metric label="tokens remaining" value={`${fmt.format(remaining)} KEY`} />
    </div>
  </Card>;
}

function Metric({ label, value, note }) { return <div className="metric"><small>{label}</small><strong>{value}</strong>{note && <em>{note}</em>}</div>; }

function RewardTiers({ tiers }) {
  return <Card title="reward tiers" className="tiersCard"><div className="tierRows">
    {tiers.map((tier, idx) => <div className="tier" key={tier.name}>
      <span className={`keyDot k${idx}`}>◆</span><b>{tier.name}</b><span>{fmt.format(tier.reward)} KEY</span><small>{tier.odds}</small>
    </div>)}
  </div></Card>;
}

function MintFlow() {
  const steps = [
    ['Generate Key', 'Create a fresh SPHINCS-style public key hash.'],
    ['Sign Address', 'Bind wallet, key hash, epoch, and chain ID.'],
    ['Mint KEY', 'Backend verifies proof, reveals reward, then prepares mint approval.']
  ];
  return <Card title="mint flow"><div className="steps">{steps.map((s, i) => <div className="step" key={s[0]}><i>{i + 1}</i><div><b>{s[0]}</b><p>{s[1]}</p></div></div>)}</div></Card>;
}

function SignatureInfo() {
  return <Card title="signature minting" className="signatureInfo">
    <h3>How signature minting works</h3>
    <p>The wallet signature proves who is minting. The SPHINCS-style signature proves the key. The reward is derived from the verified signature hash, not from a backend random number.</p>
    <code>Not proof-of-work. Not fixed claim. Proof-of-Signature Hash.</code>
  </Card>;
}

function Home({ go, data }) {
  return <main className="page homeGrid">
    <section className="heroMini">
      <p className="eyebrow">not proof-of-work • proof-of-signature hash</p>
      <h1>Mint KEY with a post-quantum signature.</h1>
      <p>Wallet proves who you are. SPHINCS proves your key. The signature hash decides your reward.</p>
      <div className="homeExplain">
        <div><b>What is KEY?</b><p>KEY turns the SPHINCS signature idea into a simple Ethereum mint ritual. Create a key, sign your address, reveal a tier, and mint the KEY reward assigned by the hash.</p></div>
        <div className="explainTriplet">
          <span><b>Wallet</b><em>Proves ownership of the Ethereum address.</em></span>
          <span><b>Key</b><em>Creates a SPHINCS-style public key hash.</em></span>
          <span><b>Hash</b><em>Determines the reward tier.</em></span>
        </div>
      </div>
      <div className="heroActions"><button className="primary" onClick={() => go('mint')}>open mint</button><button className="ghost" onClick={() => go('whitepaper')}>read whitepaper</button></div>
    </section>
    <ProgressModule data={data} />
  </main>;
}

function Mint({ wallet, connect, data, refresh }) {
  const [amount, setAmount] = useState(1);
  const [publicKeyHash, setPublicKeyHash] = useState('');
  const [sphincsPublicKey, setSphincsPublicKey] = useState('');
  const [sphincsSignature, setSphincsSignature] = useState('');
  const [message, setMessage] = useState('');
  const [walletSignature, setWalletSignature] = useState('');
  const [signedEpoch, setSignedEpoch] = useState(0);
  const [signedChainId, setSignedChainId] = useState(Number(import.meta.env.VITE_CHAIN_ID || 1));
  const [proof, setProof] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const t = data.tokenomics;
  const hasKey = Boolean(publicKeyHash);
  const hasSigned = Boolean(walletSignature && message);
  const hasProof = Boolean(proof);

  function actionClass(done, active = false) {
    return `${done ? 'done ' : ''}${active ? 'active ' : ''}`.trim();
  }

  async function copyText(text, success) {
    try {
      if (!text) throw new Error('sign address first to create the canonical message');
      await navigator.clipboard.writeText(text);
      setNotice(success);
    } catch (e) { setNotice(e.message || 'Clipboard copy failed'); }
  }

  async function generateKey() {
    try {
      setBusy('key'); setNotice('');
      let nextPublicKey = '';
      let nextPublicKeyHash = '';
      if (data.mode === 'command') {
        const res = await fetch(`${BACKEND}/api/sphincs/key`, { method: 'POST' }).then(r => r.json());
        if (!res.ok) throw new Error(res.error);
        nextPublicKey = res.publicKey;
        nextPublicKeyHash = res.publicKeyHash;
      } else {
        nextPublicKeyHash = ethers.keccak256(bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
      }
      setSphincsPublicKey(nextPublicKey);
      setSphincsSignature('');
      setPublicKeyHash(nextPublicKeyHash);
      setProof(null);
      setMessage('');
      setWalletSignature('');
      setSignedEpoch(0);
      setNotice('Fresh SPHINCS key generated. Sign your address next.');
      return nextPublicKeyHash;
    } catch (e) {
      setNotice(e.message);
      throw e;
    } finally {
      setBusy('');
    }
  }

  async function fetchSphincsSignature() {
    const res = await fetch(`${BACKEND}/api/sphincs/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKeyHash, message })
    }).then(r => r.json());
    if (!res.ok) throw new Error(res.error);
    return res.signatureHex;
  }

  async function signAddress() {
    try {
      setBusy('signing'); setNotice('');
      const addr = wallet || await connect();
      if (!addr) throw new Error('connect wallet first');
      const pk = publicKeyHash || await generateKey();
      setPublicKeyHash(pk);
      const epoch = Math.floor(Date.now() / (1000 * 60 * 10));
      const chainId = Number(import.meta.env.VITE_CHAIN_ID || 1);
      const msgRes = await fetch(`${BACKEND}/api/message?recipient=${addr}&publicKeyHash=${pk}&epoch=${epoch}&chainId=${chainId}`).then(r => r.json());
      if (!msgRes.ok) throw new Error(msgRes.error);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const sig = await signer.signMessage(msgRes.message);
      setMessage(msgRes.message); setWalletSignature(sig); setSignedEpoch(msgRes.epoch); setSignedChainId(msgRes.chainId); setNotice('Address signed. Click Mint to reveal the KEY reward.');
    } catch (e) { setNotice(e.message); } finally { setBusy(''); }
  }

  async function requestAttestation() {
    if (!wallet) throw new Error('connect wallet first');
    if (!publicKeyHash || !walletSignature) throw new Error('generate key and sign first');
    let sphincsSignatureForRequest = sphincsSignature.trim();
    if (data.mode === 'command' && sphincsPublicKey.trim() && message && !sphincsSignatureForRequest) {
      setNotice('Creating SPHINCS signature...');
      sphincsSignatureForRequest = await fetchSphincsSignature();
      setSphincsSignature(sphincsSignatureForRequest);
    }
    if (data.mode === 'command' && (!sphincsPublicKey.trim() || !sphincsSignatureForRequest || !message)) {
      throw new Error('Real SPHINCS mode needs public key and signature hex before mint');
    }
    const epoch = signedEpoch || Math.floor(Date.now() / (1000 * 60 * 10));
    const chainId = signedChainId || Number(import.meta.env.VITE_CHAIN_ID || 1);
    const res = await fetch(`${BACKEND}/api/attest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: wallet,
        publicKeyHash,
        walletSignature,
        epoch,
        chainId,
        verifyingContract: MINT_GATE,
        sphincsPublicKey: sphincsPublicKey.trim(),
        sphincsSignature: sphincsSignatureForRequest,
        sphincsMessage: message
      })
    }).then(r => r.json());
    if (!res.ok) throw new Error(res.error);
    setProof(res);
    await refresh();
    return res;
  }

  async function mintKey() {
    try {
      setBusy('mint'); setNotice('');
      const mintProof = proof || await requestAttestation();
      if (isZeroAddress(MINT_GATE)) {
        setNotice(`${mintProof.tier.name}: ${fmt.format(mintProof.tier.reward)} KEY. Demo mode stops here because mint gate is not configured.`);
        return;
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const gate = new ethers.Contract(MINT_GATE, GATE_ABI, signer);
      const tx = await gate.mintWithAttestation(mintProof.typedData, mintProof.attestation, { value: ethers.parseEther(t.mintPriceEth) });
      setNotice(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      setNotice(`Mint confirmed: ${tx.hash}`); await refresh();
    } catch (e) { setNotice(e.shortMessage || e.message); } finally { setBusy(''); }
  }

  return <main className="page mintGrid">
    <div className="leftStack">
      <ProgressModule data={data} />
      <SignatureInfo />
      <div className="compactRow"><MintFlow /><RewardTiers tiers={data.tiers} /></div>
    </div>
    <aside className="mintPanel card">
      <div className="cardTitle">mint KEY</div>
      <div className="mintTop">
        <div className="amountBlock">
          <label>amount</label>
          <div className="amount"><button onClick={() => setAmount(Math.max(1, amount - 1))}>−</button><b>{amount}</b><button onClick={() => setAmount(Math.min(3, amount + 1))}>+</button></div>
        </div>
        <div className="miniFact"><span>price</span><b>{t.mintPriceEth} ETH</b></div>
        <div className="miniFact"><span>cap</span><b>{t.walletCap} mints</b></div>
      </div>
      <div className="resultStrip">
        <div><span>tier</span><b>{proof?.tier?.name || 'pending'}</b></div>
        <div><span>reward</span><b>{proof ? `${fmt.format(proof.tier.reward)} KEY` : 'pending'}</b></div>
      </div>
      <div className="buttonStack">
        <button className={`outline ${actionClass(hasKey, busy === 'key')}`} onClick={generateKey} disabled={busy}>{busy === 'key' ? 'Generating' : hasKey ? '✓ Key ready' : 'Generate key'}</button>
        <button className={`outline ${actionClass(hasSigned, busy === 'signing')}`} onClick={signAddress} disabled={busy}>{busy === 'signing' ? 'Signing' : hasSigned ? '✓ Signed' : 'Sign address'}</button>
        <button className={`primary ${actionClass(hasProof, busy === 'mint')}`} onClick={mintKey} disabled={busy}>{busy === 'mint' ? 'Minting' : hasProof ? '✓ Mint ready' : 'Mint KEY'}</button>
      </div>
      {notice && <p className="notice">{notice}</p>}
      <div className="proofConsole">
        <div className="consoleHead"><span>SPHINCS proof</span><b>{data.mode === 'preview' ? 'demo' : 'verified'}</b></div>
        <ProofLine label="key" value={hasKey ? 'Fresh single-use SPHINCS key prepared.' : 'Generate a fresh key before signing.'} />
        <ProofLine label="wallet" value={hasSigned ? 'Address signed and bound to the key hash.' : 'Sign address to bind wallet, epoch, and chain.'} />
        <ProofLine label="verifier" value={sphincsSignature ? 'Signature verified and attestation prepared.' : 'Mint prepares and verifies the SPHINCS signature.'} />
      </div>
      <div className="proofMini"><div><small>public key hash</small><code>{publicKeyHash || 'generate first'}</code></div><div><small>proof id</small><code>{proof?.proofId || 'mint first'}</code></div></div>
    </aside>
  </main>;
}

function ProofLine({ label, value }) {
  return <div className="proofLine"><small>{label}</small><code>{value}</code></div>;
}

function Proof({ data }) {
  const [proofs, setProofs] = useState([]);
  const [stats, setStats] = useState(data.stats || {});
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadProofs() {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND}/api/proofs?limit=25`).then(r => r.json());
      if (!res.ok) throw new Error(res.error);
      setProofs(res.proofs || []);
      setStats(res.stats || {});
      setSelected((res.proofs || [])[0] || null);
    } catch (e) {
      setNotice(e.message || 'Failed to load proofs');
    } finally {
      setLoading(false);
    }
  }

  async function copyProof(text, label) {
    try {
      await navigator.clipboard.writeText(text || '');
      setNotice(`${label} copied`);
    } catch (e) {
      setNotice(e.message || 'Copy failed');
    }
  }

  useEffect(() => { loadProofs(); }, []);

  return <main className="page proofExplorer">
    <section className="proofIntro card">
      <div>
        <div className="cardTitle">proof transparency</div>
        <h1>Proof Explorer</h1>
        <p>Every KEY mint creates a public proof record: wallet, public key hash, signature hash, reward hash, tier, epoch, and attestation signer.</p>
      </div>
      <button className="outline refreshBtn" onClick={loadProofs} disabled={loading}>{loading ? 'loading' : 'refresh'}</button>
    </section>

    <section className="proofStats">
      <Metric label="proof records" value={fmt.format(stats.totalProofs || 0)} />
      <Metric label="minted by proofs" value={`${fmt.format(stats.mintedTokens || 0)} KEY`} />
      <Metric label="eth raised" value={`${Number(stats.ethRaised || 0).toFixed(3)} ETH`} />
      <Metric label="verifier mode" value={data.mode || 'unknown'} />
    </section>

    {notice && <p className="notice proofNotice">{notice}</p>}

    <section className="proofGrid">
      <Card title="latest proofs" className="proofListCard">
        {loading && <div className="emptyState">Loading proof records...</div>}
        {!loading && !proofs.length && <div className="emptyState">No proof records yet. Mint once to create the first proof.</div>}
        <div className="proofList">
          {proofs.map((p) => <button key={p.proofId} className={`proofItem ${selected?.proofId === p.proofId ? 'on' : ''}`} onClick={() => setSelected(p)}>
            <span className="tierBadge">{p.tier?.name || 'Key'}</span>
            <b>{fmt.format(p.tier?.reward || 0)} KEY</b>
            <code>{short(p.recipient)}</code>
            <small>{p.createdAt ? new Date(p.createdAt).toLocaleString() : `epoch ${p.epoch}`}</small>
          </button>)}
        </div>
      </Card>

      <Card title="selected proof" className="proofDetailCard">
        {selected ? <>
          <div className="selectedHead">
            <div><span className="tierBadge strong">{selected.tier?.name}</span><h2>{fmt.format(selected.tier?.reward || 0)} KEY</h2></div>
            <button className="miniBtn" onClick={() => copyProof(selected.proofId, 'Proof ID')}>copy proof</button>
          </div>
          <div className="proofDetailTable">
            <DetailRow label="wallet" value={selected.recipient} />
            <DetailRow label="public key hash" value={selected.publicKeyHash} onCopy={() => copyProof(selected.publicKeyHash, 'Public key hash')} />
            <DetailRow label="signature hash" value={selected.signatureHash} onCopy={() => copyProof(selected.signatureHash, 'Signature hash')} />
            <DetailRow label="reward hash" value={selected.rewardHash} onCopy={() => copyProof(selected.rewardHash, 'Reward hash')} />
            <DetailRow label="proof id" value={selected.proofId} onCopy={() => copyProof(selected.proofId, 'Proof ID')} />
            <DetailRow label="epoch" value={String(selected.epoch)} />
            <DetailRow label="attestation signer" value={selected.attestationSigner} />
            <DetailRow label="SPHINCS verify" value={selected.sphincsVerification?.ok ? 'VALID' : 'unknown'} />
          </div>
          <pre className="proofFormula">{`signatureHash = keccak256(signature)
rewardHash = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)
roll = uint256(rewardHash) % 10000`}</pre>
        </> : <div className="emptyState">Select a proof to inspect its deterministic hashes.</div>}
      </Card>
    </section>
  </main>;
}

function DetailRow({ label, value, onCopy }) {
  return <div>
    <small>{label}</small>
    <code>{value}</code>
    {onCopy && <button className="miniBtn" onClick={onCopy}>copy</button>}
  </div>;
}

function Tokenomics({ data }) {
  const t = data.tokenomics;
  const averageReward = 638.5;
  return <main className="page"><Card title="token economics" className="article">
    <h1>Tokenomics</h1>
    <p>Designed for a public signature mint model: 10M KEY are distributed through signature minting, 10M KEY are reserved for liquidity, and 1M KEY is reserved for security, deployment, and operations.</p>
    <div className="allocGrid">
      <Metric label="max supply" value={`${fmt.format(t.maxSupply)} KEY`} note="immutable ERC20 ceiling" />
      <Metric label="public mint pool" value={`${fmt.format(t.publicMintPool)} KEY`} note="distributed by signature rewards" />
      <Metric label="lp reserve" value={`${fmt.format(t.lpReserve)} KEY`} note="reserved for Uniswap v4 liquidity" />
      <Metric label="treasury reserve" value={`${fmt.format(t.treasuryReserve)} KEY`} note="security, deployment, ops" />
    </div>
    <h2>Mint math</h2>
    <p>Mint price is fixed at <b>{t.mintPriceEth} ETH</b>. The weighted average reward is approximately <b>{averageReward} KEY</b>, so a 10,000,000 KEY public mint pool gives roughly <b>±15,600 successful mints</b>.</p>
    <RewardTiers tiers={data.tiers} />
    <h2>Fairness controls</h2>
    <ul><li>No hidden dynamic price in the frontend.</li><li>Wallet cap is 3 successful mints.</li><li>Public mint pool is capped at 10,000,000 KEY.</li><li>Public key hash and proof ID cannot be reused.</li><li>Reward tier is deterministic from the signature hash.</li></ul>
  </Card></main>;
}

function Vault({ data }) {
  const addresses = [
    ['KEY token', import.meta.env.VITE_KEY_TOKEN_ADDRESS || 'TBA'],
    ['Mint gate', MINT_GATE || 'TBA'],
    ['Treasury vault', import.meta.env.VITE_TREASURY_VAULT_ADDRESS || 'TBA'],
    ['LP reserve wallet', import.meta.env.VITE_LP_RESERVE_ADDRESS || 'TBA'],
    ['Uniswap v4 pool id', import.meta.env.VITE_UNISWAP_V4_POOL_ID || 'TBA'],
    ['Hook address', import.meta.env.VITE_UNISWAP_V4_HOOK_ADDRESS || 'TBA']
  ];
  return <main className="page"><Card title="vault & liquidity" className="article">
    <h1>Vault</h1>
    <p>The mint fee is sent to a treasury vault. After deployment, the vault route can be configured to seed or support locked liquidity with the LP reserve. This page should become the public transparency board for all treasury and liquidity actions.</p>
    <p>Mint fees are routed to the treasury vault. The vault is designed to support liquidity operations and transparency. After deployment, this page should show vault address, LP reserve address, pool ID, hook address, and liquidity lock proof.</p>
    <div className="flowLine"><span>User mint fee</span><i>→</i><span>MintGate</span><i>→</i><span>TreasuryVault</span><i>→</i><span>LP route</span><i>→</i><span>Uniswap v4 pool / hook</span></div>
    <div className="tableLite addresses">{addresses.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>)}</div>
    <h2>What to publish after launch</h2>
    <ul><li>Initial LP transaction hash.</li><li>Liquidity lock or custody proof.</li><li>Vault owner / multisig address.</li><li>Any treasury route transaction.</li><li>Hook source code and audit notes if a hook is used.</li></ul>
  </Card></main>;
}

function Whitepaper({ data }) {
  return <main className="page"><Card title="whitepaper" className="article whitepaper">
    <h1>KEY — SPHINCS Signature Mint</h1>
    <h2>KEY in one sentence</h2>
    <p>KEY is mined by signatures, not machines.</p>
    <h2>Abstract</h2>
    <p>KEY is a post-quantum themed ERC20 mint experiment on Ethereum. Instead of browser hash racing or a fixed claim, KEY uses a Proof-of-Signature Hash mechanism: a wallet creates a fresh key context, signs a deterministic message, reveals a reward tier from the resulting signature hash, and mints the approved KEY amount.</p>
    <h2>Why KEY is different</h2>
    <ul><li>Not browser hash racing.</li><li>Not a fixed token claim.</li><li>Reward is revealed from the signature hash.</li><li>Every mint can produce a proof record.</li><li>Inspired by hash-based signature flow: key → sign → verify.</li></ul>
    <h2>Reference, not clone</h2>
    <p>The project is inspired by the SPHINCS-style idea of hash-based post-quantum signatures: key generation, public key derivation, message signing, and verification. KEY does not copy the existing token flow. The mechanism is changed into a tiered mint where the signature hash determines the reward.</p>
    <h2>Mint lifecycle</h2>
    <ol><li>Generate a fresh public key hash.</li><li>Sign the canonical KEY mint message.</li><li>Backend verifies wallet ownership and, in production, verifies the SPHINCS signature through a configured verifier.</li><li>Backend signs an EIP-712 mint attestation.</li><li>Contract verifies attestation, recomputes tier, enforces caps, receives 0.001 ETH, and mints KEY.</li></ol>
    <h2>Core formula</h2>
    <pre>{`signatureHash = keccak256(signature)
rewardHash = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)
proofId = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId, KEY_PROOF_V1)`}</pre>
    <h2>Trust model</h2>
    <p>The backend is not allowed to invent arbitrary rewards because the contract recomputes the reward tier from the submitted reward hash. The backend is still trusted to verify the signature correctly, so production launch should publish proof records and allow independent re-verification.</p>
    <h2>Mainnet readiness</h2>
    <ul><li>Switch backend from preview mode to real SPHINCS verifier command mode.</li><li>Verify contract source on Etherscan.</li><li>Use a multisig for treasury and reserve ownership.</li><li>Publish proof snapshots and liquidity actions.</li><li>Audit the mint gate, token, vault, and hook route.</li></ul>
  </Card></main>;
}

function Footer() { return <footer>Proof-of-Signature Hash <span>•</span> Treasury flow can route into locked liquidity via Uniswap v4 hook <span>•</span> © 2026 KEY</footer>; }

function App() {
  const [route, go] = useRoute();
  const [wallet, setWallet] = useState('');
  const [data, setData] = useState(FALLBACK);

  async function refresh() {
    try {
      const res = await fetch(`${BACKEND}/api/status`).then(r => r.json());
      if (res.ok) setData({ ...FALLBACK, ...res, tokenomics: { ...FALLBACK.tokenomics, ...res.tokenomics }, stats: { ...FALLBACK.stats, ...res.stats }, tiers: res.tiers || FALLBACK.tiers });
    } catch { setData(FALLBACK); }
  }
  useEffect(() => { refresh(); }, []);

  async function connect() {
    if (!window.ethereum) { alert('Install MetaMask or another EVM wallet.'); return ''; }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send('eth_requestAccounts', []);
    const addr = ethers.getAddress(accounts[0]); setWallet(addr); return addr;
  }

  const page = useMemo(() => {
    if (route === 'mint') return <Mint wallet={wallet} connect={connect} data={data} refresh={refresh} />;
    if (route === 'proof') return <Proof data={data} />;
    if (route === 'tokenomics') return <Tokenomics data={data} />;
    if (route === 'vault') return <Vault data={data} />;
    if (route === 'whitepaper') return <Whitepaper data={data} />;
    return <Home go={go} data={data} />;
  }, [route, wallet, data]);

  return <><div className="shell"><Header route={route} go={go} wallet={wallet} connect={connect} /><StatusLine mode={data.mode} /><TopStats data={data} />{page}<Footer /></div></>;
}

createRoot(document.getElementById('root')).render(<App />);
