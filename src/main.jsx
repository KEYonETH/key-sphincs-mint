import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ethers } from 'ethers';
import './styles.css';

function backendUrl() {
  const host = window.location.hostname;
  if (host === 'key-sphincs.xyz' || host === 'www.key-sphincs.xyz') {
    return 'https://api.key-sphincs.xyz';
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';
}

const BACKEND = backendUrl();
const MINT_GATE = import.meta.env.VITE_MINT_GATE_ADDRESS || ethers.ZeroAddress;
const KEY_TOKEN = import.meta.env.VITE_KEY_TOKEN_ADDRESS || '0x75e463F6aDfB96Fbf2588e05aD73F87bC9126EB2';
const KEY_IDENTITY = import.meta.env.VITE_KEY_IDENTITY_ADDRESS || '0xb7f018eFe48a51a5F8f03A1483B9C1ad08bCC741';
const KEY_REGISTRAR = import.meta.env.VITE_KEY_REGISTRAR_ADDRESS || '0x3cC9Ecc0c16842f7f6B4C721B7E1D6f706e149F6';
const KEY_MARKET = import.meta.env.VITE_KEY_MARKET_ADDRESS || '0xa1CA92697940230f6Ea0eE8700c3dBF3ec2DBc8c';
const ZERO = ethers.ZeroAddress;

const FALLBACK = {
  tokenomics: {
    token: 'KEY', maxSupply: 21_000_000, publicMintPool: 10_000_000, lpReserve: 10_000_000,
    treasuryReserve: 1_000_000, mintPriceEth: '0.001', walletCap: 1, estimatedMints: 15600, network: 'Ethereum'
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
const ERC20_ABI = [
  'function approve(address spender,uint256 amount) external returns (bool)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)'
];
const REGISTRAR_ABI = [
  'function claimOrigin(address mintGate,(address recipient,bytes32 publicKeyHash,bytes32 signatureHash,bytes32 rewardHash,uint256 rewardAmount,uint256 epoch,uint256 deadline) attestation,bytes signature,string name) external returns (uint256)'
];
const IDENTITY_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function approve(address to,uint256 tokenId) external',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner,address operator) view returns (bool)',
  'function nameOf(uint256 tokenId) view returns (string)'
];
const MARKET_ABI = [
  'function listIdentity(uint256 tokenId,uint256 price) external',
  'function buyIdentity(uint256 tokenId) external payable',
  'function cancelListing(uint256 tokenId) external',
  'function getListing(uint256 tokenId) view returns (address seller,uint256 price)'
];
const ROUTES = ['home', 'mint', 'keyspace', 'marketplace', 'proof', 'vault', 'whitepaper'];
const NAV_LABELS = { marketplace: 'market' };
const ALLOWED_WALLETS = {
  metamask: 'MetaMask',
  phantom: 'Phantom',
  coinbase: 'Coinbase Wallet',
  rainbow: 'Rainbow',
  dogeshit: 'Dogeshit Wallet'
};
let activeInjectedProvider = null;

const fmt = new Intl.NumberFormat('en-US');
function short(x) { return x ? `${x.slice(0, 6)}...${x.slice(-4)}` : 'not connected'; }
function bytesToHex(bytes) { return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(''); }
function isZeroAddress(addr) { return !addr || addr === ZERO || /^0x0{40}$/i.test(addr); }
function configuredMintGate(data) { return !isZeroAddress(data?.mintGate) ? data.mintGate : MINT_GATE; }
function configuredChainId(data) { return Number(data?.chainId || import.meta.env.VITE_CHAIN_ID || 1); }
function chainHex(chainId) { return `0x${Number(chainId).toString(16)}`; }
function chainName(chainId) { return Number(chainId) === 1 ? 'Ethereum Mainnet' : `chain ${chainId}`; }
function pct(n, d) { return Math.min(100, Math.max(0, (Number(n || 0) / Number(d || 1)) * 100)); }
function rankKeyFromTier(tierName = '') { return String(tierName).replace(/\s*Key$/i, ''); }
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

async function ensureWalletChain(expectedChainId, injected = window.ethereum) {
  if (!injected) throw new Error('Install MetaMask or another EVM wallet.');
  const expected = Number(expectedChainId || 1);
  const current = Number(await injected.request({ method: 'eth_chainId' }));
  if (current === expected) return;

  try {
    await injected.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex(expected) }]
    });
  } catch (error) {
    if (error?.code === 4902 && expected === 1) {
      await injected.request({
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

function walletType(detail) {
  const provider = detail?.provider || detail;
  const info = detail?.info || provider?.info || {};
  const label = `${info.name || ''} ${info.rdns || ''}`.toLowerCase();
  const hasLabel = Boolean(label.trim());
  const blocked = ['keplr', 'backpack', 'compass', 'rabby', 'brave', 'okx', 'trust', 'zerion'];
  if (blocked.some((name) => label.includes(name))) return '';
  if (label.includes('dogeshit') || label.includes('doge')) return 'dogeshit';
  if (label.includes('phantom')) return 'phantom';
  if (label.includes('coinbase')) return 'coinbase';
  if (label.includes('rainbow')) return 'rainbow';
  if (label.includes('metamask')) return 'metamask';
  if (!hasLabel && provider?.isPhantom) return 'phantom';
  if (!hasLabel && provider?.isCoinbaseWallet) return 'coinbase';
  if (!hasLabel && (provider?._metamask || provider?.isMetaMask)) return 'metamask';
  return '';
}

function walletEntry(detail) {
  const provider = detail?.provider || detail;
  if (!provider?.request) return null;
  const type = walletType(detail);
  if (!type) return null;
  return {
    uuid: type,
    type,
    name: ALLOWED_WALLETS[type],
    icon: detail?.info?.icon || provider?.info?.icon || '',
    provider
  };
}

function windowWalletDetails() {
  const details = [];
  const eth = window.ethereum;
  if (eth?.providers?.length) eth.providers.forEach((provider) => details.push({ provider, info: provider.info || {} }));
  else if (eth?.request) details.push({ provider: eth, info: eth.info || {} });
  if (window.phantom?.ethereum?.request) details.push({ provider: window.phantom.ethereum, info: { name: 'Phantom' } });
  if (window.coinbaseWalletExtension?.request) details.push({ provider: window.coinbaseWalletExtension, info: { name: 'Coinbase Wallet' } });
  return details;
}

function walletKey(item) {
  return item?.type || item?.uuid || String(item?.provider || '');
}

function uniqueWallets(items) {
  const wallets = new Map();
  items.forEach((item) => {
    const key = walletKey(item);
    const current = wallets.get(key);
    if (!current || (!current.icon && item.icon)) wallets.set(key, item);
  });
  return Array.from(wallets.values());
}

function currentEthereum() {
  return activeInjectedProvider || window.ethereum;
}

function cleanRoute(value = '') {
  const normalized = String(value).replace(/^#?\/*/, '').split(/[?#/]/)[0] || 'home';
  return ROUTES.includes(normalized) ? normalized : 'home';
}

function routeFromLocation() {
  if (window.location.hash.startsWith('#/')) return cleanRoute(window.location.hash);
  return cleanRoute(window.location.pathname);
}

function useRoute() {
  const [route, setRoute] = useState(routeFromLocation);
  useEffect(() => {
    const on = () => {
      const next = routeFromLocation();
      setRoute(next);
      if (window.location.hash.startsWith('#/')) {
        window.history.replaceState(null, '', `/${next}`);
      }
    };
    on();
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  const go = (r) => {
    const next = cleanRoute(r);
    window.history.pushState(null, '', `/${next}`);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return [route, go];
}

function Header({ route, go, wallet, connect, walletProviders, walletMenu, setWalletMenu }) {
  const nav = ROUTES;
  const walletLabel = wallet ? short(wallet) : 'connect';
  return <header className="topbar">
    <div className="brand" onClick={() => go('home')}>
      <div className="brandIcon"><img src="/key-logo.svg" alt="KEY" /></div>
      <div><div className="brandName">KEY</div><div className="brandSub">SPHINCS Signature Mint</div></div>
    </div>
    <nav>{nav.map(n => <button key={n} className={route === n ? 'on' : ''} onClick={() => go(n)}>{NAV_LABELS[n] || n}</button>)}</nav>
    <div className="walletSlot">
      <button className="connect" onClick={() => {
        if (!wallet && walletProviders.length > 1) setWalletMenu((open) => !open);
        else connect(walletProviders[0]);
      }}>{walletLabel}</button>
      {walletMenu && !wallet && <div className="walletMenu">
        {walletProviders.length ? walletProviders.map((provider) => <button key={provider.uuid || provider.name} onClick={() => connect(provider)}>
          <span className={`walletIcon ${provider.icon ? '' : 'empty'}`}>{provider.icon && <img src={provider.icon} alt="" />}</span>
          <span className="walletName">{provider.name}</span>
        </button>) : <button onClick={() => connect()}>No supported wallet</button>}
      </div>}
    </div>
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
      <div className="keyspaceTeaser">
        <b>After Mint: KEYSPACE</b>
        <p>Mint KEY once to reveal your Key Rank. After mint-out, claim one .key identity backed by your KEY reward and trade it with ETH.</p>
        <button className="miniBtn" onClick={() => go('keyspace')}>Open KEYSPACE</button>
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
  const mintLimitText = Number(t.walletCap) === 1 ? '1 mint per wallet' : `${t.walletCap} mint limit`;
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
      await ensureWalletChain(chainId, currentEthereum());
      const msgRes = await fetch(`${BACKEND}/api/message?recipient=${addr}&publicKeyHash=${pk}&epoch=${epoch}&chainId=${chainId}`).then(r => r.json());
      if (!msgRes.ok) throw new Error(msgRes.error);
      const provider = new ethers.BrowserProvider(currentEthereum());
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
      await ensureWalletChain(mintProof.typedData?.domain?.chainId || configuredChainId(data), currentEthereum());
      const provider = new ethers.BrowserProvider(currentEthereum());
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
        <div><small>limit</small><b>{mintLimitText}</b></div>
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
    <div className="mintSupport"><SignatureInfo /><RewardTiers tiers={data.tiers} /><Card title="KEYSPACE note" className="keyspaceNote"><p>Each wallet can mint KEY once. Your reward tier becomes your Key Rank for KEYSPACE. Higher ranks unlock shorter .key identities after mint-out.</p></Card></div>
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

function KeyIdentityCard({ name, rank, origin, keyBond, mintProof, tokenId, className = '' }) {
  const nameChars = Math.max(6, String(name).length);
  const valueChars = Math.max(
    String(origin).length,
    String(keyBond).length,
    String(mintProof).length,
    String(tokenId).length,
    8
  );
  return <div className={`webKeyCard ${rank.toLowerCase()} ${className}`} style={{ '--name-chars': nameChars, '--value-chars': valueChars }}>
    <div className="webKeyCardInner">
      <div className="cardTop">KEYSPACE IDENTITY</div>
      <div className="cardRule"><span /><i /><span /></div>
      <div className="cardIdentity">
        <b>{name}</b>
      </div>
      <div className="cardSub">SPHINCS ORIGIN IDENTITY</div>
      <div className="cardRule mid"><span /><i /><span /></div>
      <div className="cardDetails">
        <span>ORIGIN</span><b>{origin}</b>
        <span>KEYBOND</span><b>{keyBond}</b>
        <span>MINT PROOF</span><b>{mintProof}</b>
        <span>TOKEN ID</span><b>{tokenId}</b>
      </div>
      <div className="cardFooter">KEY-BACKED IDENTITY</div>
    </div>
  </div>;
}

const KEYSPACE_STATIC_STATUS = {
  live: false,
  phase: 'preview',
  keySupply: '21000000',
  identitySupply: '21000',
  claimed: 0,
  marketplaceLive: false,
  originClaimsOpen: false,
  contractsLive: false
};

const KEYSPACE_BASE_RANK_RULES = [
  { key: 'Normal', title: 'Normal Key', short: 'Normal', reward: 500, min: 7, claim: '7+ letters', bond: '500 KEY', origin: 'Normal Origin' },
  { key: 'Clean', title: 'Clean Key', short: 'Clean', reward: 750, min: 6, claim: '6+ letters', bond: '750 KEY', origin: 'Clean Origin' },
  { key: 'Golden', title: 'Golden Key', short: 'Golden', reward: 1500, min: 5, claim: '5+ letters', bond: '1,500 KEY', origin: 'Golden Origin' },
  { key: 'Quantum', title: 'Quantum Key', short: 'Quantum', reward: 5000, min: 4, claim: '4+ letters', bond: '5,000 KEY', origin: 'Quantum Origin' },
  { key: 'Genesis', title: 'Genesis Key', short: 'Genesis', reward: 21000, min: 3, claim: '3+ letters', bond: '21,000 KEY', origin: 'Genesis Origin' }
];

const KEYSPACE_LISTINGS = [
  { name: 'ai.key', rank: 'Genesis', origin: 'Genesis Origin', keyBond: '21,000 KEY', mintProof: '#0001', tokenId: '#1', price: 'Auction', owner: 'Origin preview' },
  { name: 'hash.key', rank: 'Quantum', origin: 'Quantum Origin', keyBond: '5,000 KEY', mintProof: '#4004', tokenId: '#404', price: '0.11 ETH', owner: 'Preview seller' },
  { name: 'alpha.key', rank: 'Golden', origin: 'Golden Origin', keyBond: '1,500 KEY', mintProof: '#8842', tokenId: '#421', price: '0.04 ETH', owner: 'Preview seller' },
  { name: 'cipher.key', rank: 'Clean', origin: 'Clean Origin', keyBond: '750 KEY', mintProof: '#0206', tokenId: '#206', price: '0.012 ETH', owner: 'Preview seller' },
  { name: 'terminal.key', rank: 'Normal', origin: 'Normal Origin', keyBond: '500 KEY', mintProof: '#0107', tokenId: '#107', price: '0.006 ETH', owner: 'Preview seller' }
];

function keyspaceRankRules(tiers = []) {
  return KEYSPACE_BASE_RANK_RULES.map((rule) => {
    const tier = tiers.find((t) => t.name.toLowerCase() === rule.title.toLowerCase());
    return tier ? { ...rule, title: tier.name, reward: tier.reward, bond: `${fmt.format(tier.reward)} KEY` } : rule;
  });
}

function Keyspace({ tiers, wallet, connect, data }) {
  const staticStatus = KEYSPACE_STATIC_STATUS;
  const rankRules = keyspaceRankRules(tiers);
  const flow = [
    ['Mint KEY', 'SPHINCS signature hash reveals your reward tier and Key Rank.'],
    ['Claim identity', 'After mint-out, one Origin Claim unlocks one .key identity.'],
    ['Trade with ETH', 'The identity can be listed, bought, and sold with ETH while its KeyBond stays locked inside.']
  ];
  const listings = KEYSPACE_LISTINGS;
  const heroCard = listings[2];

  const [rank, setRank] = useState('Normal');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [keyspaceStatus, setKeyspaceStatus] = useState(staticStatus);
  const [keyQuote, setKeyQuote] = useState(null);
  const selected = rankRules.find((r) => r.key === rank) || rankRules[0];
  const keySupply = fmt.format(Number(keyspaceStatus.keySupply || staticStatus.keySupply));
  const identitySupply = fmt.format(Number(keyspaceStatus.identitySupply || staticStatus.identitySupply));

  useEffect(() => {
    let alive = true;
    fetch(`${BACKEND}/api/keyspace/status`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('KEYSPACE status unavailable')))
      .then((status) => {
        if (alive) setKeyspaceStatus({ ...staticStatus, ...status });
      })
      .catch(() => {
        if (alive) setKeyspaceStatus(staticStatus);
      });
    fetch(`${BACKEND}/api/keyspace/quote/500`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('KEYSPACE quote unavailable')))
      .then((quote) => {
        if (alive) setKeyQuote(quote);
      })
      .catch(() => {
        if (alive) setKeyQuote(null);
      });
    return () => { alive = false; };
  }, []);

  function previewClaim() {
    const raw = name.trim().toLowerCase();
    const valid = /^[a-z]+$/.test(raw);
    const eligible = valid && raw.length >= selected.min;
    setPreview({
      display: raw ? `${raw}.key` : 'name.key',
      valid,
      eligible,
      length: raw.length,
      rule: selected
    });
  }

  return <main className="page keyspacePage">
    <section className="keyspaceHero">
      <div className="keyspaceHeroCopy">
        <span className="previewBadge">PREVIEW — OPENS AFTER MINT-OUT</span>
        <h1>KEYSPACE</h1>
        <h2>SPHINCS Origin Identities backed by KEY.</h2>
        <p>Mint KEY once. Reveal your rank. Claim one .key identity after mint-out. Trade it with ETH.</p>
        <div className="heroTagline">
          <span>One wallet. One mint. One Origin Claim.</span>
          <span>Your signature decides your rank.</span>
          <span>Your KEY backs the identity.</span>
        </div>
      </div>
      <div className="heroIdentityCard">
        <KeyIdentityCard {...heroCard} className="heroWebCard" />
        <div className="heroCardFallback">
          <div className="identityName">alpha.key</div>
          <div className="identityMeta">Golden Origin</div>
          <div className="identityRows">
            <span>KeyBond</span><b>1,500 KEY</b>
            <span>Example Listing</span><b>0.04 ETH</b>
            <span>Status</span><b>Not Live</b>
          </div>
        </div>
        <div className="heroStats">
          <span>{identitySupply} max identities</span>
          <span>10,000,000 KEY public mint</span>
          <span>KEY-backed identity assets</span>
        </div>
      </div>
    </section>
    <p className="keyspaceWarning">KEYSPACE contracts are deployed, but origin claim, marketplace trading, melt/redeem, and auctions are not open yet.</p>

    <section className="keyspaceBlock">
      <div className="sectionHead">
        <h2>How KEYSPACE works</h2>
      </div>
      <div className="flowGrid">{flow.map(([title, text], index) => <div className="flowCard" key={title}>
        <i>{index + 1}</i>
        <b>{title}</b>
        <p>{text}</p>
      </div>)}</div>
      <p className="originLine">SPHINCS creates the origin. KEY backs the identity. The market trades the identity.</p>
    </section>

    <section className="keyspaceBlock">
      <div className="supplyGrid">
        <InfoCard title="KEY Supply" value={keySupply} />
        <InfoCard title="Public Mint" value="10,000,000 KEY" />
        <InfoCard title="KEYSPACE Supply" value={`${identitySupply} .key identities`} />
        <InfoCard title="Origin Names" value="Minters claim first" />
      </div>
      <p className="keyspaceRatio">{keySupply} KEY. {identitySupply} .key identities. One identity for every 1,000 KEY supply.</p>
    </section>

    <section className="keyspaceBlock">
      <div className="sectionHead">
        <h2>Mint Rank unlocks name length</h2>
        <p>Higher ranks unlock shorter .key identities after mint-out.</p>
      </div>
      <div className="rankGrid">{rankRules.map((r) => <div className="rankCard" key={r.key}>
        <b>{r.short}</b>
        <span>Reward: {fmt.format(r.reward)} KEY</span>
        <span>Claim: {r.claim}</span>
        <span>KeyBond: {r.bond}</span>
      </div>)}</div>
      <div className="sectionHead compactHead">
        <h2>Origin Claim Opens After Mint-Out</h2>
        <p>All eligible minters can claim when KEYSPACE opens. Your Key Rank controls the minimum name length.</p>
      </div>
      <div className="windowGrid">
        {['Genesis: 3+ letters', 'Quantum: 4+ letters', 'Golden: 5+ letters', 'Clean: 6+ letters', 'Normal: 7+ letters'].map((item) => <div key={item}>{item}</div>)}
      </div>
    </section>

    <section className="keyspaceBlock">
      <div className="sectionHead">
        <h2>Market Preview</h2>
        <p>Example .key identities that can trade with ETH after mint-out.</p>
      </div>
      <div className="listingGrid keycardPreviewGrid">{listings.map((card) => <div className="listingCard keycardOnly" key={card.name}>
        <KeyIdentityCard {...card} />
      </div>)}</div>
      <p className="marketNote">.key identities can be listed, bought, and sold with ETH after KEYSPACE goes live. When sold, the KEY KeyBond stays inside the identity and moves to the buyer. OpenSea can show the same ERC721 identity page. {keyQuote?.ethEstimate ? `Reference: 500 KEY KeyBond ≈ ${keyQuote.ethEstimate} ETH.` : ''}</p>
    </section>

    <section className="keyspaceBlock keybondBlock">
      <div className="sectionHead">
        <h2>What is KeyBond?</h2>
        <p>KeyBond is KEY locked inside a .key identity. If the identity is sold, the KeyBond moves with it. If the identity is melted later, the identity burns and the KeyBond can be redeemed minus exit fee.</p>
      </div>
      <div className="keybondGrid">
        {['Locked inside identity', 'Transfers with buyer', 'Redeemable by melting'].map((item) => <div key={item}>{item}</div>)}
      </div>
    </section>

    <KeyspaceActions
      status={keyspaceStatus}
      wallet={wallet}
      connect={connect}
      data={data}
      rankRules={rankRules}
    />

    <Card title="Claim Preview" className="keyspaceSimulator">
      <div className="simControls">
        <label><span>Rank</span><select value={rank} onChange={(e) => setRank(e.target.value)}>{rankRules.map((r) => <option key={r.key} value={r.key}>{r.short}</option>)}</select></label>
        <label><span>Desired name</span><input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="alpha" maxLength={16} /></label>
        <button className="primary" onClick={previewClaim}>Preview Claim</button>
      </div>
      <div className="simIdentityWrap">
        {preview ? <div className={`simIdentityCard ${preview.eligible ? 'eligible' : 'blocked'}`}>
          <div className="identityName">{preview.display}</div>
          <div className="identityMeta">Origin: {preview.rule.short}</div>
          <div className="identityRows">
            <span>Eligible</span><b>{preview.eligible ? 'yes' : 'no'}</b>
            <span>Required</span><b>{preview.rule.min}+ letters</b>
            <span>KeyBond</span><b>{preview.rule.bond}</b>
            <span>Claim Right</span><b>1 per minting wallet</b>
            <span>Status</span><b>Preview only</b>
          </div>
          {preview.valid && preview.eligible && <p>This name can be claimed by this rank after KEYSPACE opens.</p>}
          {!preview.valid && <p>Only lowercase letters a-z are allowed. No numbers, spaces, or symbols.</p>}
          {preview.valid && !preview.eligible && <p>This name is too short for the selected rank.</p>}
        </div> : <p className="simPlaceholder">Enter a lowercase letters-only name, select a rank, and preview the Origin Claim.</p>}
      </div>
    </Card>
  </main>;
}

function KeyspaceActions({ status, wallet, connect, data, rankRules }) {
  const [claimName, setClaimName] = useState('');
  const [claimProofs, setClaimProofs] = useState([]);
  const [walletInfo, setWalletInfo] = useState(null);
  const [liveListings, setLiveListings] = useState([]);
  const [listTokenId, setListTokenId] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [buyTokenId, setBuyTokenId] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const originOpen = Boolean(status.originClaimsOpen);
  const marketOpen = Boolean(status.marketplaceLive);
  const claimProof = claimProofs[0] || null;
  const claimRank = claimProof ? rankKeyFromTier(claimProof.tier?.name) : 'Normal';
  const claimRule = rankRules.find((rule) => rule.key === claimRank) || rankRules[0];
  const normalizedClaimName = claimName.trim().toLowerCase();
  const claimNameValid = /^[a-z]+$/.test(normalizedClaimName);
  const claimEligible = Boolean(claimProof && claimNameValid && normalizedClaimName.length >= claimRule.min);

  async function loadKeyspaceWallet(address = wallet) {
    if (!address) {
      setClaimProofs([]);
      setWalletInfo(null);
      return;
    }
    const [walletRes, claimRes, listingRes] = await Promise.all([
      fetch(`${BACKEND}/api/keyspace/wallet/${address}?refresh=1`).then((res) => res.json()),
      fetch(`${BACKEND}/api/keyspace/claim-proof/${address}?refresh=1`).then((res) => res.json()),
      fetch(`${BACKEND}/api/keyspace/listings?refresh=1`).then((res) => res.json())
    ]);
    if (walletRes.ok) setWalletInfo(walletRes);
    if (claimRes.ok) setClaimProofs(claimRes.proofs || []);
    if (listingRes.ok) setLiveListings(listingRes.listings || []);
  }

  useEffect(() => {
    loadKeyspaceWallet().catch(() => {});
  }, [wallet]);

  async function getSigner() {
    const address = wallet || await connect();
    if (!address) throw new Error('connect wallet first');
    await ensureWalletChain(configuredChainId(data), currentEthereum());
    const provider = new ethers.BrowserProvider(currentEthereum());
    return { address, signer: await provider.getSigner() };
  }

  async function claimIdentity() {
    try {
      setBusy('claim');
      setNotice('');
      if (!originOpen) throw new Error('Origin claim is not open yet.');
      if (!claimProof) throw new Error('No minted proof found for this wallet.');
      if (!claimEligible) throw new Error(claimNameValid ? 'This name is too short for your Key Rank.' : 'Only lowercase letters a-z are allowed.');
      const { address, signer } = await getSigner();
      if (address.toLowerCase() !== claimProof.recipient.toLowerCase()) throw new Error('Connected wallet does not match the Origin Claim proof.');
      if (isZeroAddress(KEY_TOKEN) || isZeroAddress(KEY_REGISTRAR)) throw new Error('KEYSPACE contracts are not configured.');

      const rewardAmount = BigInt(claimProof.typedData.rewardAmount);
      const token = new ethers.Contract(KEY_TOKEN, ERC20_ABI, signer);
      const balance = await token.balanceOf(address);
      if (balance < rewardAmount) throw new Error('Wallet does not hold enough KEY for the KeyBond.');
      const allowance = await token.allowance(address, KEY_REGISTRAR);
      if (allowance < rewardAmount) {
        const approveTx = await token.approve(KEY_REGISTRAR, rewardAmount);
        setNotice(`Approving KeyBond: ${approveTx.hash}`);
        await approveTx.wait();
      }

      const registrar = new ethers.Contract(KEY_REGISTRAR, REGISTRAR_ABI, signer);
      const tx = await registrar.claimOrigin(claimProof.mintGate, claimProof.typedData, claimProof.attestation, normalizedClaimName);
      setNotice(`Claim sent: ${tx.hash}`);
      await tx.wait();
      setNotice(`Identity claimed: ${normalizedClaimName}.key`);
      await loadKeyspaceWallet(address);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy('');
    }
  }

  async function listIdentity() {
    try {
      setBusy('list');
      setNotice('');
      if (!marketOpen) throw new Error('KEYSPACE Market is not open yet.');
      if (!listTokenId || !listPrice) throw new Error('Enter token ID and ETH price.');
      const { address, signer } = await getSigner();
      if (isZeroAddress(KEY_IDENTITY) || isZeroAddress(KEY_MARKET)) throw new Error('KEYSPACE market is not configured.');
      const tokenId = BigInt(listTokenId);
      const price = ethers.parseEther(listPrice);
      if (price <= 0n) throw new Error('ETH price must be greater than zero.');

      const identity = new ethers.Contract(KEY_IDENTITY, IDENTITY_ABI, signer);
      const owner = await identity.ownerOf(tokenId);
      if (owner.toLowerCase() !== address.toLowerCase()) throw new Error('Connected wallet does not own this identity.');
      const approved = await identity.getApproved(tokenId);
      const approvedForAll = await identity.isApprovedForAll(address, KEY_MARKET);
      if (approved.toLowerCase() !== KEY_MARKET.toLowerCase() && !approvedForAll) {
        const approveTx = await identity.approve(KEY_MARKET, tokenId);
        setNotice(`Approving identity: ${approveTx.hash}`);
        await approveTx.wait();
      }

      const market = new ethers.Contract(KEY_MARKET, MARKET_ABI, signer);
      const tx = await market.listIdentity(tokenId, price);
      setNotice(`Listing sent: ${tx.hash}`);
      await tx.wait();
      setNotice(`Identity #${tokenId} listed for ${listPrice} ETH.`);
      await loadKeyspaceWallet(address);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy('');
    }
  }

  async function buyIdentity() {
    try {
      setBusy('buy');
      setNotice('');
      if (!marketOpen) throw new Error('KEYSPACE Market is not open yet.');
      if (!buyTokenId) throw new Error('Enter a token ID to buy.');
      const { address, signer } = await getSigner();
      const market = new ethers.Contract(KEY_MARKET, MARKET_ABI, signer);
      const tokenId = BigInt(buyTokenId);
      const listing = liveListings.find((item) => item.tokenId === String(tokenId));
      const price = buyPrice ? ethers.parseEther(buyPrice) : (listing ? ethers.parseEther(listing.price) : 0n);
      if (price <= 0n) throw new Error('Enter the ETH listing price.');
      const tx = await market.buyIdentity(tokenId, { value: price });
      setNotice(`Purchase sent: ${tx.hash}`);
      await tx.wait();
      setNotice(`Identity #${tokenId} purchased. KeyBond moved with the NFT.`);
      await loadKeyspaceWallet(address);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy('');
    }
  }

  async function cancelListing(tokenId = listTokenId) {
    try {
      setBusy('cancel');
      setNotice('');
      if (!marketOpen) throw new Error('KEYSPACE Market is not open yet.');
      if (!tokenId) throw new Error('Enter token ID to cancel.');
      const { address, signer } = await getSigner();
      const market = new ethers.Contract(KEY_MARKET, MARKET_ABI, signer);
      const tx = await market.cancelListing(BigInt(tokenId));
      setNotice(`Cancel sent: ${tx.hash}`);
      await tx.wait();
      setNotice(`Listing #${tokenId} cancelled.`);
      await loadKeyspaceWallet(address);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy('');
    }
  }

  return <Card title="KEYSPACE Actions" className="keyspaceActions">
    <div className="actionStatusGrid">
      <Metric label="contracts" value={status.contractsLive ? 'ready' : 'preview'} />
      <Metric label="origin claim" value={originOpen ? 'open' : 'locked'} note="opens after mint-out" />
      <Metric label="market" value={marketOpen ? 'open' : 'locked'} note="ETH-native primary market" />
      <Metric label="wallet" value={wallet ? short(wallet) : 'not connected'} />
    </div>
    <div className="actionColumns">
      <div className="actionBox">
        <b>Claim .key identity</b>
        <p>Approve your reward KEY as KeyBond, then claim one identity with your Origin Rank.</p>
        <label><span>Name</span><input value={claimName} onChange={(e) => setClaimName(e.target.value.toLowerCase())} placeholder="alpha" maxLength={16} /></label>
        <div className="actionHint">
          <span>Rank: {claimProof ? claimRank : 'no minted proof'}</span>
          <span>Required: {claimRule.min}+ letters</span>
          <span>KeyBond: {claimProof ? `${fmt.format(Number(ethers.formatEther(claimProof.typedData.rewardAmount)))} KEY` : 'pending'}</span>
        </div>
        <button className="primary" onClick={claimIdentity} disabled={!originOpen || !claimEligible || busy}>{busy === 'claim' ? 'Claiming' : 'Claim identity'}</button>
      </div>
      <div className="actionBox">
        <b>List identity</b>
        <p>List an owned `.key` NFT for ETH. The KEY KeyBond stays inside the identity.</p>
        <label><span>Token ID</span><input value={listTokenId} onChange={(e) => setListTokenId(e.target.value.replace(/\D/g, ''))} placeholder="1" /></label>
        <label><span>ETH price</span><input value={listPrice} onChange={(e) => setListPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.04" /></label>
        <button className="primary" onClick={listIdentity} disabled={!marketOpen || !listTokenId || !listPrice || busy}>{busy === 'list' ? 'Listing' : 'List for ETH'}</button>
        <button className="outline" onClick={() => cancelListing()} disabled={!marketOpen || !listTokenId || busy}>Cancel listing</button>
      </div>
      <div className="actionBox">
        <b>Buy identity</b>
        <p>Buy a listed `.key` with ETH. You receive the NFT and the locked KeyBond rights.</p>
        <label><span>Token ID</span><input value={buyTokenId} onChange={(e) => setBuyTokenId(e.target.value.replace(/\D/g, ''))} placeholder="1" /></label>
        <label><span>ETH price</span><input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="listing price" /></label>
        <button className="primary" onClick={buyIdentity} disabled={!marketOpen || !buyTokenId || busy}>{busy === 'buy' ? 'Buying' : 'Buy with ETH'}</button>
      </div>
    </div>
    <div className="liveListings">
      <b>Live listings</b>
      {liveListings.length ? liveListings.slice(0, 6).map((listing) => <div key={listing.tokenId}>
        <span>#{listing.tokenId}</span><span>{listing.price} ETH</span><button className="miniBtn" onClick={() => { setBuyTokenId(listing.tokenId); setBuyPrice(listing.price); }}>use</button>
      </div>) : <p>No live listings yet. Preview examples remain visible above until market opens.</p>}
    </div>
    {walletInfo?.identities?.length > 0 && <div className="liveListings">
      <b>Your indexed identities</b>
      {walletInfo.identities.map((identity) => <div key={identity.tokenId}>
        <span>#{identity.tokenId} {identity.name}</span><span>{identity.keyBond} KEY</span><button className="miniBtn" onClick={() => setListTokenId(identity.tokenId)}>list</button>
      </div>)}
    </div>}
    <p className="marketNote">Action panel is wired to mainnet contracts but remains locked until KEYSPACE opens. Buying transfers the NFT; KeyBond remains locked inside the identity and follows the NFT owner.</p>
    {notice && <p className="notice">{notice}</p>}
  </Card>;
}

function Marketplace({ wallet, connect, data }) {
  const [status, setStatus] = useState(KEYSPACE_STATIC_STATUS);
  const [search, setSearch] = useState('');
  const [rankFilter, setRankFilter] = useState('All');
  const rankRules = keyspaceRankRules(data.tiers || FALLBACK.tiers);
  const marketOpen = Boolean(status.marketplaceLive);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleListings = KEYSPACE_LISTINGS.filter((card) => {
    const matchesRank = rankFilter === 'All' || card.rank === rankFilter;
    const matchesSearch = !normalizedSearch || card.name.toLowerCase().includes(normalizedSearch) || card.origin.toLowerCase().includes(normalizedSearch);
    return matchesRank && matchesSearch;
  });

  useEffect(() => {
    let alive = true;
    fetch(`${BACKEND}/api/keyspace/status`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('KEYSPACE status unavailable')))
      .then((json) => {
        if (alive) setStatus({ ...KEYSPACE_STATIC_STATUS, ...json });
      })
      .catch(() => {
        if (alive) setStatus(KEYSPACE_STATIC_STATUS);
      });
    return () => { alive = false; };
  }, []);

  return <main className="page marketplacePage">
    <section className="marketHero keyspaceBlock">
      <div>
        <span className="previewBadge">KEYSPACE MARKET</span>
        <h1>Marketplace</h1>
        <p>Browse .key identity listings. Trading opens only after KEYSPACE is live; this page is prepared for ETH-native ERC721 identity sales.</p>
      </div>
      <div className="marketStatusPanel">
        <Metric label="market" value={marketOpen ? 'open' : 'locked'} note="ETH-native primary market" />
        <Metric label="contracts" value={status.contractsLive ? 'ready' : 'preview'} />
        <Metric label="claimed" value={fmt.format(Number(status.claimed || 0))} note="indexed identities" />
      </div>
    </section>

    <section className="keyspaceBlock marketCollection">
      <div className="marketCollectionHead">
        <div>
          <h2>KEYSPACE Identities</h2>
          <p>Preview collection for Origin Rank .key identities backed by KEY.</p>
        </div>
        <div className="collectionStats">
          <Metric label="items" value="21,000 max" />
          <Metric label="currency" value="ETH" />
          <Metric label="status" value={marketOpen ? 'live' : 'preview'} />
        </div>
      </div>

      <div className="marketToolbar">
        <label className="marketSearch"><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search names or rank" /></label>
        <div className="marketFilters">
          {['All', 'Genesis', 'Quantum', 'Golden', 'Clean', 'Normal'].map((rankName) => <button key={rankName} className={rankFilter === rankName ? 'on' : ''} onClick={() => setRankFilter(rankName)}>{rankName}</button>)}
        </div>
      </div>

      <div className="marketplaceGrid">
        {visibleListings.map((card) => <article className="marketNftCard" key={card.name}>
          <div className="marketNftArt"><KeyIdentityCard {...card} /></div>
          <div className="marketNftInfo">
            <div><b>{card.name}</b><span>{card.origin}</span></div>
            <div><small>Price</small><strong>{card.price}</strong></div>
            <div><small>KeyBond</small><strong>{card.keyBond}</strong></div>
            <button disabled={!marketOpen}>{marketOpen ? 'Buy now' : 'Preview only'}</button>
          </div>
        </article>)}
      </div>
      <p className="marketNote">Marketplace preview only. Buying will transfer the ERC721 identity after KEYSPACE opens; the locked KeyBond remains inside the identity and follows the buyer.</p>
    </section>

    <KeyspaceActions
      status={status}
      wallet={wallet}
      connect={connect}
      data={data}
      rankRules={rankRules}
    />
  </main>;
}

function InfoCard({ title, value }) {
  return <div className="infoCard"><b>{title}</b><span>{value}</span></div>;
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
    <ul><li>No hidden dynamic price in the frontend.</li><li>Each wallet can mint once.</li><li>Public mint pool is capped at 10,000,000 KEY.</li><li>Public key hash and proof ID cannot be reused.</li><li>Reward tier is deterministic from the signature hash.</li></ul>
  </Card></main>;
}

function Vault({ data }) {
  const liquidity = data.liquidity || {};
  const addresses = liquidity.addresses || {};
  const balances = liquidity.balances || {};
  const controls = liquidity.controls || {};
  const noPool = !liquidity.poolId || liquidity.poolId === 'TBA' || liquidity.poolId === 'not created';
  const noLiquidityModule = !liquidity.hookAddress || isZeroAddress(liquidity.hookAddress);
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
      <Metric label="liquidity module" value={noLiquidityModule ? 'none' : 'configured'} note={noLiquidityModule ? 'standard pool planned first' : short(liquidity.hookAddress)} />
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
    <p>The project is inspired by the SPHINCS-style idea of hash-based post-quantum signatures: key generation, public key derivation, message signing, and verification. KEY does not copy the existing token flow. The mechanism is changed into a tiered mint where the signature hash decides the reward.</p>
    <h2>Mint lifecycle</h2>
    <ol><li>Generate a fresh public key hash.</li><li>Sign the canonical KEY mint message.</li><li>Backend verifies wallet ownership and, in production, verifies the SPHINCS signature through a configured verifier.</li><li>Backend signs an EIP-712 mint attestation.</li><li>Contract verifies attestation, recomputes tier, enforces caps, receives 0.001 ETH, and mints KEY.</li></ol>
    <h2>Core formula</h2>
    <pre>{`signatureHash = keccak256(signature)
rewardHash = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId)
proofId = keccak256(wallet, publicKeyHash, signatureHash, epoch, chainId, KEY_PROOF_V1)`}</pre>
    <h2>Trust model</h2>
    <p>The backend is not allowed to invent arbitrary rewards because the contract recomputes the reward tier from the submitted reward hash. The backend is still trusted to verify the signature correctly, so production launch should publish proof records and allow independent re-verification.</p>
    <h2>Mainnet readiness</h2>
    <ul><li>Switch backend from preview mode to real SPHINCS verifier command mode.</li><li>Verify contract source on Etherscan.</li><li>Use a multisig for treasury and reserve ownership.</li><li>Publish proof snapshots and liquidity actions.</li><li>Audit the mint gate, token, vault, and liquidity route.</li></ul>
  </Card></main>;
}

function Footer() { return <footer>KEY <span>•</span> Proof-of-Signature Hash <span>•</span> Ethereum</footer>; }

function App() {
  const [route, go] = useRoute();
  const [wallet, setWallet] = useState('');
  const [walletProviders, setWalletProviders] = useState([]);
  const [walletMenu, setWalletMenu] = useState(false);
  const [selectedWalletProvider, setSelectedWalletProvider] = useState(null);
  const [data, setData] = useState(FALLBACK);

  async function refresh() {
    try {
      const res = await fetch(`${BACKEND}/api/status`).then(r => r.json());
      if (res.ok) setData({ ...FALLBACK, ...res, tokenomics: { ...FALLBACK.tokenomics, ...res.tokenomics }, stats: { ...FALLBACK.stats, ...res.stats }, tiers: res.tiers || FALLBACK.tiers });
    } catch { setData(FALLBACK); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const discovered = [];
    const add = (detail) => {
      const wallet = walletEntry(detail);
      if (!wallet) return;
      discovered.push(wallet);
      setWalletProviders(uniqueWallets(discovered));
    };
    const onAnnounce = (event) => add(event.detail);
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const requestAgain = setTimeout(() => window.dispatchEvent(new Event('eip6963:requestProvider')), 400);

    windowWalletDetails().forEach(add);

    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      clearTimeout(requestAgain);
    };
  }, []);

  async function connect(walletProvider = selectedWalletProvider || walletProviders[0]) {
    const selected = walletProvider || uniqueWallets(windowWalletDetails().map(walletEntry).filter(Boolean))[0];
    const injected = selected?.provider;
    if (!injected) { alert('Enable MetaMask, Phantom, Coinbase Wallet, Rainbow, or Dogeshit Wallet for this site.'); return ''; }
    await ensureWalletChain(configuredChainId(data), injected);
    const provider = new ethers.BrowserProvider(injected);
    const accounts = await provider.send('eth_requestAccounts', []);
    const addr = ethers.getAddress(accounts[0]);
    activeInjectedProvider = injected;
    setSelectedWalletProvider(selected);
    setWalletMenu(false);
    setWallet(addr);
    return addr;
  }

  const page = useMemo(() => {
    if (route === 'mint') return <Mint wallet={wallet} connect={connect} data={data} refresh={refresh} />;
    if (route === 'keyspace') return <Keyspace tiers={data.tiers} wallet={wallet} connect={connect} data={data} />;
    if (route === 'marketplace') return <Marketplace wallet={wallet} connect={connect} data={data} />;
    if (route === 'proof') return <Proof data={data} />;
    if (route === 'vault') return <Vault data={data} />;
    if (route === 'whitepaper') return <Whitepaper data={data} />;
    return <Home go={go} data={data} />;
  }, [route, wallet, data]);

  return <><div className="shell"><Header route={route} go={go} wallet={wallet} connect={connect} walletProviders={walletProviders} walletMenu={walletMenu} setWalletMenu={setWalletMenu} /><StatusLine mode={data.mode} />{route === 'home' && <TopStats data={data} />}{page}<Footer /></div></>;
}

createRoot(document.getElementById('root')).render(<App />);
