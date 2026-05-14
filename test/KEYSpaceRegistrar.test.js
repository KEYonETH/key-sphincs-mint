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

async function deployRegistrarFixture() {
  const [owner, lpReserve, treasuryReserve, backendSigner, user, buyer, other] = await ethers.getSigners();

  const vault = await ethers.deployContract("KEYTreasuryVault", [owner.address]);
  const token = await ethers.deployContract("KEYToken", [lpReserve.address, treasuryReserve.address]);
  const gate = await ethers.deployContract("KEYMintGate", [
    await token.getAddress(),
    await vault.getAddress(),
    backendSigner.address,
  ]);
  await token.setMintGate(await gate.getAddress());
  await vault.setMintGate(await gate.getAddress());

  const identity = await ethers.deployContract("KEYIdentity", [
    owner.address,
    "https://api.key-sphincs.xyz/api/keyspace/metadata/",
  ]);
  const registrar = await ethers.deployContract("KEYSpaceRegistrar", [
    owner.address,
    await token.getAddress(),
    await identity.getAddress(),
    await gate.getAddress(),
    [],
  ]);
  await identity.setRegistrar(await registrar.getAddress());

  return { owner, lpReserve, treasuryReserve, backendSigner, user, buyer, other, token, vault, gate, identity, registrar };
}

async function mintAndFillPool({ owner, token, gate, backendSigner, user }) {
  const proof = await makeAttestation({ gate, signer: backendSigner, recipient: user, seed: "origin", epoch: 1n });
  await gate.connect(user).mintWithAttestation(proof.value, proof.signature, { value: ethers.parseEther("0.001") });

  const publicPool = await token.PUBLIC_MINT_POOL();
  const minted = await token.publicMintedByGate();
  await token.setMintGate(owner.address);
  await token.mintByGate(owner.address, publicPool - minted);
  return proof;
}

describe("KEYSpaceRegistrar", function () {
  it("stores final rank name-length rules", async function () {
    const { registrar } = await deployRegistrarFixture();

    expect(await registrar.minNameLengthForRank(4)).to.equal(3n);
    expect(await registrar.minNameLengthForRank(3)).to.equal(4n);
    expect(await registrar.minNameLengthForRank(2)).to.equal(5n);
    expect(await registrar.minNameLengthForRank(1)).to.equal(6n);
    expect(await registrar.minNameLengthForRank(0)).to.equal(7n);
  });

  it("keeps origin claims closed until mint-out", async function () {
    const { registrar } = await deployRegistrarFixture();

    expect(await registrar.canOpenOriginClaims()).to.equal(false);
    await expect(registrar.setOriginClaimsOpen(true)).to.be.revertedWithCustomError(registrar, "MintOutNotReached");
  });

  it("claims an identity using a minted proof and locks KeyBond", async function () {
    const fixture = await deployRegistrarFixture();
    const { owner, token, gate, registrar, identity, backendSigner, user } = fixture;
    const proof = await mintAndFillPool({ owner, token, gate, backendSigner, user });

    await registrar.setOriginClaimsOpen(true);
    await token.connect(user).approve(await registrar.getAddress(), proof.value.rewardAmount);

    await expect(registrar.connect(user).claimOrigin(await gate.getAddress(), proof.value, proof.signature, "terminal"))
      .to.emit(registrar, "IdentityClaimed")
      .withArgs(user.address, 1n, "terminal", await registrar.rankForReward(proof.value.rewardAmount), proof.value.rewardAmount);

    expect(await identity.ownerOf(1)).to.equal(user.address);
    expect(await identity.nameOf(1)).to.equal("terminal.key");
    expect(await token.balanceOf(await registrar.getAddress())).to.equal(proof.value.rewardAmount);
    expect(await registrar.claimedByWallet(user.address)).to.equal(true);
    expect(await registrar.claimedProofId(await registrar.proofId(proof.value))).to.equal(true);
  });

  it("rejects short names, reused claims, invalid names, and unminted proofs", async function () {
    const fixture = await deployRegistrarFixture();
    const { owner, token, gate, registrar, backendSigner, user, other } = fixture;
    const proof = await mintAndFillPool({ owner, token, gate, backendSigner, user });

    await registrar.setOriginClaimsOpen(true);
    await token.connect(user).approve(await registrar.getAddress(), proof.value.rewardAmount);

    const rank = await registrar.rankForReward(proof.value.rewardAmount);
    const minLength = Number(await registrar.minNameLengthForRank(rank));
    const tooShort = "a".repeat(minLength - 1);
    await expect(
      registrar.connect(user).claimOrigin(await gate.getAddress(), proof.value, proof.signature, tooShort),
    ).to.be.revertedWithCustomError(registrar, "NameTooShort");

    await expect(
      registrar.connect(user).claimOrigin(await gate.getAddress(), proof.value, proof.signature, "alpha1"),
    ).to.be.revertedWithCustomError(registrar, "InvalidName");

    await registrar.connect(user).claimOrigin(await gate.getAddress(), proof.value, proof.signature, "terminal");
    await expect(
      registrar.connect(user).claimOrigin(await gate.getAddress(), proof.value, proof.signature, "terminalx"),
    ).to.be.revertedWithCustomError(registrar, "ClaimAlreadyUsed");

    const fakeProof = await makeAttestation({ gate, signer: backendSigner, recipient: other, seed: "unminted", epoch: 2n });
    await expect(
      registrar.connect(other).claimOrigin(await gate.getAddress(), fakeProof.value, fakeProof.signature, "unminted"),
    ).to.be.revertedWithCustomError(registrar, "InvalidAttestation");
  });

  it("melts through registrar and applies configurable exit fee", async function () {
    const fixture = await deployRegistrarFixture();
    const { owner, token, gate, registrar, identity, backendSigner, user, buyer } = fixture;
    const proof = await mintAndFillPool({ owner, token, gate, backendSigner, user });

    await registrar.setOriginClaimsOpen(true);
    await registrar.setExitFee(500, owner.address);
    await token.connect(user).approve(await registrar.getAddress(), proof.value.rewardAmount);
    await registrar.connect(user).claimOrigin(await gate.getAddress(), proof.value, proof.signature, "terminal");
    await identity.connect(user).transferFrom(user.address, buyer.address, 1);

    const buyerBefore = await token.balanceOf(buyer.address);
    const ownerBefore = await token.balanceOf(owner.address);
    const fee = (proof.value.rewardAmount * 500n) / 10_000n;
    const redeemed = proof.value.rewardAmount - fee;

    await expect(registrar.connect(buyer).meltIdentity(1))
      .to.emit(registrar, "IdentityMelted")
      .withArgs(1n, buyer.address, redeemed, fee);

    expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore + redeemed);
    expect(await token.balanceOf(owner.address)).to.equal(ownerBefore + fee);
    expect(await registrar.keyBondByTokenId(1)).to.equal(0n);
    await expect(identity.ownerOf(1)).to.be.revertedWithCustomError(identity, "ERC721NonexistentToken");
  });
});
