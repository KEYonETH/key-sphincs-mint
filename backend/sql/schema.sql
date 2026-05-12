-- Optional production schema if you move from JSONL to SQLite/PostgreSQL.
create table if not exists challenges (
  id text primary key,
  nonce text not null,
  recipient text not null,
  public_key_hash text not null,
  epoch integer not null,
  chain_id integer not null,
  message text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists proofs (
  proof_id text primary key,
  recipient text not null,
  public_key_hash text not null unique,
  signature_hash text not null,
  reward_hash text not null,
  tier_name text not null,
  reward integer not null,
  epoch integer not null,
  chain_id integer not null,
  attestation_signer text not null,
  verifying_contract text not null,
  tx_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_proofs_recipient on proofs(recipient);
create index if not exists idx_proofs_created_at on proofs(created_at desc);
