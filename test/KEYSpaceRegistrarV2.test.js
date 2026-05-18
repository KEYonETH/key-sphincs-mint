import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const TYPES = {
  MintAttestation: [
    { name: "recipient", type: "address" },
    { name: "publicKeyHash", type: "bytes32" },
    { name: "signatureHash", type: "bytes32" },
    { name: "rewardHash", type: "bytes32" },
    { name: "rewardAmount", type: "uint256" },
    { name: "epoch", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

async function makeAttestation({ gate, signer, recipient, seed = "one", epoch = 1n }) {
  const { chainId } = await ethers.provider.getNetwork();
  const publicKeyHash = ethers.id(`public-key-${seed}`);
  const signatureHash = ethers.id(`signature-${seed}`);
  const rewardHash = ethers.solidityPackedKeccak256(
    ["address", "bytes32", "bytes32", "uint256", "uint256"],
    [recipient.address, publicKeyHash, signatureHash, epoch, chainId],
  );
  const rewardAmount = await gate.rewardForHash(rewardHash);
  const latest = await ethers.provider.getBlock("latest");
  const value = {
    recipient: recipient.address,
    publicKeyHash,
    signatureHash,
    rewardHash,
    rewardAmount,
    epoch,
    deadline: BigInt(latest.timestamp + 3600),
  };
  const domain = {
    name: "KEYMintGate",
    version: "1",
    chainId,
    verifyingContract: await gate.getAddress(),
  };
  const signature = await signer.signTypedData(domain, TYPES, value);
  return { value, signature };
}

async function deployRegistrarV2Fixture() {
  const [owner, lpReserve, treasuryReserve, backendSigner, user, buyer, other] = await ethers.getSigners();

  const vault = await ethers.deployContract("KEYTreasuryVault", [owner.address]);
  const token = await ethers.deployContract("KEYToken", [lpReserve.address, treasuryReserve.address]);
  const legacyGate = await ethers.deployContract("KEYMintGate", [
    await token.getAddress(),
    await vault.getAddress(),
    backendSigner.address,
  ]);
  await token.setMintGate(await legacyGate.getAddress());
  await vault.setMintGate(await legacyGate.getAddress());

  const gateV3 = await ethers.deployContract("KEYMintGateV3", [
    await token.getAddress(),
    await vault.getAddress(),
    backendSigner.address,
    await legacyGate.getAddress(),
    [],
  ]);
  await token.setMintGate(await gateV3.getAddress());
  await vault.setMintGate(await gateV3.getAddress());

  const identity = await ethers.deployContract("KEYIdentity", [
    owner.address,
    "https://api.key-sphincs.xyz/api/keyspace/metadata/",
  ]);
  const registrar = await ethers.deployContract("KEYSpaceRegistrarV2", [
    owner.address,
    await token.getAddress(),
    await identity.getAddress(),
    await gateV3.getAddress(),
    [await legacyGate.getAddress()],
  ]);
  await identity.setRegistrar(await registrar.getAddress());

  return { owner, lpReserve, treasuryReserve, backendSigner, user, buyer, other, token, vault, legacyGate, gateV3, identity, registrar };
}

async function mintTenProofs({ gate, backendSigner, user }) {
  const proofs = [];
  for (let i = 0; i < 10; i += 1) {
    const proof = await makeAttestation({
      gate,
      signer: backendSigner,
      recipient: user,
      seed: `origin-v2-${i}`,
      epoch: BigInt(i + 1),
    });
    await gate.connect(user).mintWithAttestation(proof.value, proof.signature, { value: ethers.parseEther("0.001") });
    proofs.push(proof);
  }
  return proofs;
}

async function mintTenAndFillPool(fixture) {
  const { owner, token, gateV3, backendSigner, user } = fixture;
  const proofs = await mintTenProofs({ gate: gateV3, backendSigner, user });

  const publicPool = await token.PUBLIC_MINT_POOL();
  const minted = await token.publicMintedByGate();
  await token.setMintGate(owner.address);
  await token.mintByGate(owner.address, publicPool - minted);
  return proofs;
}

function toClaimMint(gateAddress, proof) {
  return {
    mintGate: gateAddress,
    attestation: proof.value,
    signature: proof.signature,
  };
}

describe("KEYSpaceRegistrarV2", function () {
  it("requires ten minted proofs and locks the combined KeyBond", async function () {
    const fixture = await deployRegistrarV2Fixture();
    const { token, gateV3, registrar, identity, user } = fixture;
    const proofs = await mintTenAndFillPool(fixture);
    const gateAddress = await gateV3.getAddress();
    const claims = proofs.map((proof) => toClaimMint(gateAddress, proof));
    const keyBond = proofs.reduce((sum, proof) => sum + proof.value.rewardAmount, 0n);
    let bestRank = 0n;
    for (const proof of proofs) {
      const rank = await registrar.rankForReward(proof.value.rewardAmount);
      if (rank > bestRank) bestRank = rank;
    }

    await registrar.setOriginClaimsOpen(true);
    await token.connect(user).approve(await registrar.getAddress(), keyBond);

    await expect(registrar.connect(user).claimOrigin(claims, "terminal"))
      .to.emit(registrar, "IdentityClaimed")
      .withArgs(user.address, 1n, "terminal", bestRank, keyBond);

    expect(await identity.ownerOf(1)).to.equal(user.address);
    expect(await identity.nameOf(1)).to.equal("terminal.key");
    expect(await token.balanceOf(await registrar.getAddress())).to.equal(keyBond);
    expect(await registrar.keyBondByTokenId(1)).to.equal(keyBond);
    expect(await registrar.claimedByWallet(user.address)).to.equal(true);

    for (const proof of proofs) {
      expect(await registrar.claimedProofId(await registrar.proofId(proof.value))).to.equal(true);
    }
  });

  it("rejects claims with fewer than ten proofs", async function () {
    const fixture = await deployRegistrarV2Fixture();
    const { gateV3, registrar } = fixture;
    const proofs = await mintTenAndFillPool(fixture);
    const gateAddress = await gateV3.getAddress();

    await registrar.setOriginClaimsOpen(true);
    await expect(
      registrar.claimOrigin(proofs.slice(0, 9).map((proof) => toClaimMint(gateAddress, proof)), "terminal"),
    ).to.be.revertedWithCustomError(registrar, "NotEnoughMintProofs");
  });

  it("rejects duplicate proofs inside the ten-proof batch", async function () {
    const fixture = await deployRegistrarV2Fixture();
    const { token, gateV3, registrar, user } = fixture;
    const proofs = await mintTenAndFillPool(fixture);
    const gateAddress = await gateV3.getAddress();
    const keyBond = proofs.reduce((sum, proof) => sum + proof.value.rewardAmount, 0n);
    const claims = proofs.map((proof) => toClaimMint(gateAddress, proof));
    claims[9] = claims[0];

    await registrar.setOriginClaimsOpen(true);
    await token.connect(user).approve(await registrar.getAddress(), keyBond);

    await expect(registrar.connect(user).claimOrigin(claims, "terminal"))
      .to.be.revertedWithCustomError(registrar, "DuplicateProof");
  });

  it("melts the V2 identity and returns the combined KeyBond", async function () {
    const fixture = await deployRegistrarV2Fixture();
    const { token, gateV3, registrar, identity, user, buyer } = fixture;
    const proofs = await mintTenAndFillPool(fixture);
    const gateAddress = await gateV3.getAddress();
    const claims = proofs.map((proof) => toClaimMint(gateAddress, proof));
    const keyBond = proofs.reduce((sum, proof) => sum + proof.value.rewardAmount, 0n);

    await registrar.setOriginClaimsOpen(true);
    await registrar.setExitFee(500, buyer.address);
    await token.connect(user).approve(await registrar.getAddress(), keyBond);
    await registrar.connect(user).claimOrigin(claims, "terminal");

    const userBefore = await token.balanceOf(user.address);
    const feeRecipientBefore = await token.balanceOf(buyer.address);
    const fee = (keyBond * 500n) / 10_000n;
    await expect(registrar.connect(user).meltIdentity(1))
      .to.emit(registrar, "IdentityMelted")
      .withArgs(1n, user.address, keyBond - fee, fee);

    expect(await token.balanceOf(user.address)).to.equal(userBefore + keyBond - fee);
    expect(await token.balanceOf(buyer.address)).to.equal(feeRecipientBefore + fee);
    expect(await registrar.keyBondByTokenId(1)).to.equal(0n);
    await expect(identity.ownerOf(1)).to.be.revertedWithCustomError(identity, "ERC721NonexistentToken");
  });
});
