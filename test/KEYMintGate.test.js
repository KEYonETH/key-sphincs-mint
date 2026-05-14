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

async function deployFixture() {
  const [owner, lpReserve, treasuryReserve, backendSigner, user, otherSigner] = await ethers.getSigners();

  const vault = await ethers.deployContract("KEYTreasuryVault", [owner.address]);
  const token = await ethers.deployContract("KEYToken", [lpReserve.address, treasuryReserve.address]);
  const gate = await ethers.deployContract("KEYMintGate", [
    await token.getAddress(),
    await vault.getAddress(),
    backendSigner.address,
  ]);

  await token.setMintGate(await gate.getAddress());
  await vault.setMintGate(await gate.getAddress());

  return { owner, lpReserve, treasuryReserve, backendSigner, user, otherSigner, token, vault, gate };
}

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

describe("KEYToken", function () {
  it("deploys reserves and caps supply", async function () {
    const { token, lpReserve, treasuryReserve } = await deployFixture();

    expect(await token.name()).to.equal("KEY");
    expect(await token.symbol()).to.equal("KEY");
    expect(await token.balanceOf(lpReserve.address)).to.equal(ethers.parseEther("10000000"));
    expect(await token.balanceOf(treasuryReserve.address)).to.equal(ethers.parseEther("1000000"));
    expect(await token.totalSupply()).to.equal(ethers.parseEther("11000000"));
  });
});

describe("KEYMintGate", function () {
  it("mints with a valid backend attestation and forwards ETH", async function () {
    const { token, vault, gate, backendSigner, user } = await deployFixture();
    const { value, signature } = await makeAttestation({ gate, signer: backendSigner, recipient: user });

    await expect(gate.connect(user).mintWithAttestation(value, signature, { value: ethers.parseEther("0.001") }))
      .to.emit(gate, "Minted");

    expect(await token.balanceOf(user.address)).to.equal(value.rewardAmount);
    expect(await vault.totalMintFeesReceived()).to.equal(ethers.parseEther("0.001"));
    expect(await gate.walletMints(user.address)).to.equal(1n);
  });

  it("rejects invalid backend signer", async function () {
    const { gate, otherSigner, user } = await deployFixture();
    const { value, signature } = await makeAttestation({ gate, signer: otherSigner, recipient: user });

    await expect(
      gate.connect(user).mintWithAttestation(value, signature, { value: ethers.parseEther("0.001") }),
    ).to.be.revertedWith("bad attestation");
  });

  it("rejects reused proofs and public keys", async function () {
    const { gate, backendSigner, user } = await deployFixture();
    const { value, signature } = await makeAttestation({ gate, signer: backendSigner, recipient: user });

    await gate.connect(user).mintWithAttestation(value, signature, { value: ethers.parseEther("0.001") });
    await expect(
      gate.connect(user).mintWithAttestation(value, signature, { value: ethers.parseEther("0.001") }),
    ).to.be.revertedWith("proof used");
  });

  it("enforces one mint per wallet", async function () {
    const { gate, backendSigner, user } = await deployFixture();
    const first = await makeAttestation({ gate, signer: backendSigner, recipient: user, seed: "cap-1", epoch: 1n });
    await gate.connect(user).mintWithAttestation(first.value, first.signature, { value: ethers.parseEther("0.001") });

    const { value, signature } = await makeAttestation({
      gate,
      signer: backendSigner,
      recipient: user,
      seed: "cap-2",
      epoch: 2n,
    });
    await expect(
      gate.connect(user).mintWithAttestation(value, signature, { value: ethers.parseEther("0.001") }),
    ).to.be.revertedWith("wallet cap reached");
  });

  it("rejects wrong mint price and reward tampering", async function () {
    const { gate, backendSigner, user } = await deployFixture();
    const { value, signature } = await makeAttestation({ gate, signer: backendSigner, recipient: user });

    await expect(
      gate.connect(user).mintWithAttestation(value, signature, { value: ethers.parseEther("0.0005") }),
    ).to.be.revertedWith("wrong mint price");

    const tampered = { ...value, rewardAmount: value.rewardAmount + 1n };
    await expect(
      gate.connect(user).mintWithAttestation(tampered, signature, { value: ethers.parseEther("0.001") }),
    ).to.be.revertedWith("bad reward amount");
  });
});

describe("KEYMintGateV2", function () {
  it("enforces one mint per wallet across the legacy gate", async function () {
    const { token, vault, gate, backendSigner, user, otherSigner } = await deployFixture();
    const first = await makeAttestation({ gate, signer: backendSigner, recipient: user, seed: "legacy", epoch: 1n });
    await gate.connect(user).mintWithAttestation(first.value, first.signature, { value: ethers.parseEther("0.001") });

    const gateV2 = await ethers.deployContract("KEYMintGateV2", [
      await token.getAddress(),
      await vault.getAddress(),
      backendSigner.address,
      await gate.getAddress(),
    ]);
    await token.setMintGate(await gateV2.getAddress());
    await vault.setMintGate(await gateV2.getAddress());

    const blocked = await makeAttestation({ gate: gateV2, signer: backendSigner, recipient: user, seed: "v2-blocked", epoch: 2n });
    await expect(
      gateV2.connect(user).mintWithAttestation(blocked.value, blocked.signature, { value: ethers.parseEther("0.001") }),
    ).to.be.revertedWith("wallet cap reached");

    const allowed = await makeAttestation({ gate: gateV2, signer: backendSigner, recipient: otherSigner, seed: "v2-allowed", epoch: 3n });
    await expect(gateV2.connect(otherSigner).mintWithAttestation(allowed.value, allowed.signature, { value: ethers.parseEther("0.001") }))
      .to.emit(gateV2, "Minted");

    expect(await gateV2.legacyWalletMints(user.address)).to.equal(1n);
    expect(await gateV2.walletMints(otherSigner.address)).to.equal(1n);
    expect(await gateV2.publicMintedTotal()).to.equal(first.value.rewardAmount + allowed.value.rewardAmount);
  });
});
