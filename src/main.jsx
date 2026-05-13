import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ethers } from 'ethers';
import './styles.css';

const BACKEND = import.meta.env.VITE_BACKEND_URL
  || (window.location.hostname === 'key-sphincs.xyz' || window.location.hostname === 'www.key-sphincs.xyz'
    ? 'https://api.key-sphincs.xyz'
    : 'http://localhost:8787');
const MINT_GATE = import.meta.env.VITE_MINT_GATE_ADDRESS || ethers.ZeroAddress;
const ZERO = ethers.ZeroAddress;

const FALLBACK = {
  tokenomics: {
    token: 'KEY', maxSupply: 21_000_000, publicMintPool: 10_000_000, lpReserve: 10_000_000,
    treasuryReserve: 1_000_000, mintPriceEth: '0.001', walletCap: 3, estimatedMints: 15600, network: 'Ethereum'
  },
  stats: { mintedTokens: 0, ethRaised: 0, totalProofs: 0, byTier: {} },
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
function configuredMintGate(data) { return !isZeroAddress(data?.mintGate) ? data.mintGate : MINT_GATE; }
function configuredChainId(data) { return Number(data?.chainId || import.meta.env.VITE_CHAIN_ID || 1); }
function chainHex(chainId) { return `0x${Number(chainId).toString(16)}`; }
function chainName(chainId) { return Number(chainId) === 1 ? 'Ethereum Mainnet' : `chain ${chainId}`; }
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

async function ensureWalletChain(expectedChainId) {
  if (!window.ethereum) throw new Error('Install MetaMask or another EVM wallet.');
  const expected = Number(expectedChainId || 1);
  const current = Number(await window.ethereum.request({ method: 'eth_chainId' }));
  if (current === expected) return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex(expected) }]
    });
  } catch (error) {
    if (error?.code === 4902 && expected === 1) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x1',
          chainName: 'Ethereum Mainnet',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://cloudflare-eth.com'],
          blockExplorerUrls: ['https://etherscan.io']
        }]
      });
      return;
    }
    throw new Error(`Switch MetaMask to ${chainName(expected)} before minting KEY.`);
  }
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
  const nav = ['home', 'mint', 'proof', 'vault', 'whitepaper'];
  return <header className="topbar">
    <div className="brand" onClick={() => go('home')}>
      <div className="brandIcon"><img src="/key-logo.png" alt="KEY" /></div>
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
      <span className={`keyDot k${idx}`} /><b>{tier.name}</b><span>{fmt.format(tier.reward)} KEY</span><small>{tier.odds}</small>
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
    <h3>How minting works</h3>
    <p>Generate a key, sign your address, then mint. The backend verifies the signature and the hash assigns the reward.</p>
    <code>Not proof-of-work. Proof-of-Signature Hash.</code>
  </Card>;
}

function Home({ go, data }) {
  return <main className="page homeGrid">
    <section className="heroMini">
      <p className="eyebrow">proof-of-signature hash</p>
      <h1>Mint KEY with a signature hash.</h1>
      <p>Wallet proves who you are. SPHINCS proves your key. The signature hash decides your reward.</p>
      <div className="homeExplain">
        <span><b>Wallet</b><em>Proves the minter.</em></span>
        <span><b>Key</b><em>Creates the public hash.</em></span>
        <span><b>Hash</b><em>Selects the reward tier.</em></span>
      </div>
      <div className="heroActions"><button className="primary" onClick={() => go('mint')}>open mint</button><button className="ghost" onClick={() => go('whitepaper')}>read whitepaper</button></div>
    </section>
    <ProgressModule data={data} />
  </main>;
}

function Mint({ wallet, connect, data, refresh }) {
  const [publicKeyHash, setPublicKeyHash] = useState('');
  const [sphincsPublicKey, setSphincsPublicKey] = useState('');
  const [sphincsSignature, setSphincsSignature] = useState('');
  const [message, setMessage] = useState('');
  const [walletSignature, setWalletSignature] = useState('');
  const [signedEpoch, setSignedEpoch] = useState(0);
  const [signedChainId, setSignedChainId] = useState(configuredChainId(data));
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
      const chainId = configuredChainId(data);
      await ensureWalletChain(chainId);
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
    const chainId = signedChainId || configuredChainId(data);
    const mintGateAddress = configuredMintGate(data);
    const res = await fetch(`${BACKEND}/api/attest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: wallet,
        publicKeyHash,
        walletSignature,
        epoch,
        chainId,
        verifyingContract: mintGateAddress,
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
      const mintGateAddress = configuredMintGate(data);
      if (isZeroAddress(mintGateAddress)) {
        setNotice(`${mintProof.tier.name}: ${fmt.format(mintProof.tier.reward)} KEY. Demo mode stops here because mint gate is not configured.`);
        return;
      }
      await ensureWalletChain(mintProof.typedData?.domain?.chainId || configuredChainId(data));
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const gate = new ethers.Contract(mintGateAddress, GATE_ABI, signer);
      const tx = await gate.mintWithAttestation(mintProof.typedData, mintProof.attestation, { value: ethers.parseEther(t.mintPriceEth) });
      setNotice(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      setNotice(`Mint confirmed: ${tx.hash}`); await refresh();
    } catch (e) { setNotice(e.shortMessage || e.message); } finally { setBusy(''); }
  }

  return <main className="page mintPage">
    <ProgressModule data={data} />
    <section className="mintStack">
    <div className="mintPanel card">
      <div className="cardTitle">mint KEY</div>
      <div className="mintFacts">
        <div><small>price</small><b>{t.mintPriceEth} ETH</b></div>
        <div><small>limit</small><b>{t.walletCap} mints per wallet</b></div>
        <div><small>mode</small><b>{data.mode === 'preview' ? 'demo' : 'real SPHINCS'}</b></div>
      </div>
      <div className="resultStrip">
        <div><span>tier</span><b>{proof?.tier?.name || 'pending'}</b></div>
        <div><span>reward</span><b>{proof ? `${fmt.format(proof.tier.reward)} KEY` : 'pending'}</b></div>
      </div>
      <div className="buttonStack">
        <button className={`outline ${actionClass(hasKey, busy === 'key')}`} onClick={generateKey} disabled={busy}>{busy === 'key' ? 'Generating' : hasKey ? 'Key ready' : 'Generate key'}</button>
        <button className={`outline ${actionClass(hasSigned, busy === 'signing')}`} onClick={signAddress} disabled={busy}>{busy === 'signing' ? 'Signing' : hasSigned ? 'Signed' : 'Sign address'}</button>
        <button className={`primary ${actionClass(hasProof, busy === 'mint')}`} onClick={mintKey} disabled={busy}>{busy === 'mint' ? 'Minting' : hasProof ? 'Mint ready' : 'Mint KEY'}</button>
      </div>
      {notice && <p className="notice">{notice}</p>}
      <div className="proofConsole">
        <div className="consoleHead"><span>SPHINCS proof</span><b>{data.mode === 'preview' ? 'demo' : 'verified'}</b></div>
        <ProofLine label="key" value={hasKey ? 'Fresh single-use SPHINCS key prepared.' : 'Generate a fresh key before signing.'} />
        <ProofLine label="wallet" value={hasSigned ? 'Address signed and bound to the key hash.' : 'Sign address to bind wallet, epoch, and chain.'} />
        <ProofLine label="verifier" value={sphincsSignature ? 'Signature verified and attestation prepared.' : 'Mint prepares and verifies the SPHINCS signature.'} />
      </div>
      <div className="keyReveal">
        <div>
          <small>public key</small>
          <code>{sphincsPublicKey || (data.mode === 'preview' ? 'preview mode uses generated key hash only' : 'generate key first')}</code>
        </div>
        <div>
          <small>public key hash</small>
          <code>{publicKeyHash || 'generate first'}</code>
        </div>
        <div>
          <small>proof id</small>
          <code>{proof?.proofId || 'mint first'}</code>
        </div>
      </div>
    </div>
    <div className="mintSupport"><SignatureInfo /><RewardTiers tiers={data.tiers} /></div>
    </section>
  </main>;
}

function ProofLine({ label, value }) {
  return <div className="proofLine"><small>{label}</small><code title={value}>{value}</code></div>;
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
  const liquidity = data.liquidity || {};
  const addresses = liquidity.addresses || {};
  const balances = liquidity.balances || {};
  const controls = liquidity.controls || {};
  const noPool = !liquidity.poolId || liquidity.poolId === 'TBA' || liquidity.poolId === 'not created';
  const noHook = !liquidity.hookAddress || isZeroAddress(liquidity.hookAddress);
  const txLink = liquidity.initializeTx ? `https://etherscan.io/tx/${liquidity.initializeTx}` : '';
  const addressRows = [
    ['KEY token', addresses.token || import.meta.env.VITE_KEY_TOKEN_ADDRESS || 'TBA'],
    ['Mint gate', addresses.mintGate || MINT_GATE || 'TBA'],
    ['Treasury vault', addresses.treasuryVault || import.meta.env.VITE_TREASURY_VAULT_ADDRESS || 'TBA'],
    ['Uniswap v4 PoolManager', liquidity.poolManager || '0x000000000004444c5dc75cB358380D2e3dE08A90'],
    ['LP reserve wallet', addresses.lpReserve || import.meta.env.VITE_LP_RESERVE_ADDRESS || 'TBA'],
    ['Treasury reserve wallet', addresses.treasuryReserve || import.meta.env.VITE_TREASURY_RESERVE_ADDRESS || 'TBA'],
    ['Contract owner', addresses.contractOwner || import.meta.env.VITE_CONTRACT_OWNER_ADDRESS || 'TBA']
  ];
  const value = (n, unit) => Number.isFinite(Number(n)) ? `${fmt.format(Number(n))} ${unit}` : `0 ${unit}`;
  const etherscan = (v) => ethers.isAddress(v) ? `https://etherscan.io/address/${v}` : '';
  return <main className="page"><Card title="vault & liquidity" className="article">
    <h1>Vault</h1>
    <p>Mint fees are held by the treasury vault. Reserve wallets, pool status, and liquidity actions are published here before trading is enabled.</p>
    <div className="vaultStatusGrid">
      <Metric label="official trading" value={noPool ? 'not launched' : 'liquidity pending'} note={noPool ? 'no official KEY pool yet' : 'pool exists, LP has not been added'} />
      <Metric label="uniswap v4 pool" value={noPool ? 'not created' : 'created'} note={liquidity.poolId || 'pending'} />
      <Metric label="hook" value={noHook ? 'none' : 'configured'} note={noHook ? 'normal v4 pool planned first' : short(liquidity.hookAddress)} />
      <Metric label="vault ETH" value={value(balances.vaultETH, 'ETH')} note="mint fees currently held by vault" />
    </div>
    {!noPool && <div className="tableLite addresses poolDetails">
      <div><b>Pool ID</b><span>{liquidity.poolId}</span></div>
      <div><b>Pair</b><span>{liquidity.pair || 'KEY/WETH'}</span></div>
      <div><b>Initial price</b><span>{liquidity.initialPrice || '1 ETH = 500,000 KEY'}</span></div>
      <div><b>Fee</b><span>{liquidity.fee === '10000' ? '1%' : liquidity.fee || 'TBA'}</span></div>
      <div><b>Tick spacing</b><span>{liquidity.tickSpacing || '200'}</span></div>
      {txLink && <div><b>Initialize tx</b><span>{liquidity.initializeTx}</span><a href={txLink} target="_blank" rel="noreferrer">etherscan</a></div>}
    </div>}
    <h2>Public addresses</h2>
    <div className="tableLite addresses">{addressRows.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span>{etherscan(v) && <a href={etherscan(v)} target="_blank" rel="noreferrer">etherscan</a>}</div>)}</div>
    <h2>Control surface</h2>
    <p>Minted KEY stays inside user wallets and cannot be taken back by the project. The team only controls reserves, vault routing, verifier policy, and when official liquidity is published.</p>
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

function Footer() { return <footer>KEY <span>•</span> Proof-of-Signature Hash <span>•</span> Ethereum</footer>; }

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
    await ensureWalletChain(configuredChainId(data));
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send('eth_requestAccounts', []);
    const addr = ethers.getAddress(accounts[0]); setWallet(addr); return addr;
  }

  const page = useMemo(() => {
    if (route === 'mint') return <Mint wallet={wallet} connect={connect} data={data} refresh={refresh} />;
    if (route === 'proof') return <Proof data={data} />;
    if (route === 'vault') return <Vault data={data} />;
    if (route === 'whitepaper') return <Whitepaper data={data} />;
    return <Home go={go} data={data} />;
  }, [route, wallet, data]);

  return <><div className="shell"><Header route={route} go={go} wallet={wallet} connect={connect} /><StatusLine mode={data.mode} />{route === 'home' && <TopStats data={data} />}{page}<Footer /></div></>;
}

createRoot(document.getElementById('root')).render(<App />);
