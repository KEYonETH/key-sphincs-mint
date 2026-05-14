import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

async function deployIdentityFixture() {
  const [owner, registrar, user, buyer, other] = await ethers.getSigners();
  const identity = await ethers.deployContract("KEYIdentity", [
    owner.address,
    "https://api.key-sphincs.xyz/api/keyspace/metadata/",
  ]);
  await identity.connect(owner).setRegistrar(registrar.address);
  return { owner, registrar, user, buyer, other, identity };
}

async function mintIdentity(identity, registrar, owner, name = "alpha") {
  const proofId = ethers.id(`proof-${name}`);
  const tx = await identity.connect(registrar).mintIdentity(
    owner.address,
    name,
    2,
    ethers.parseEther("1500"),
    owner.address,
    proofId,
  );
  return { tx, tokenId: 1n, proofId };
}

describe("KEYIdentity", function () {
  it("deploys with owner-controlled registrar and metadata base", async function () {
    const { owner, registrar, identity } = await deployIdentityFixture();

    expect(await identity.name()).to.equal("KEYSPACE Origin Identity");
    expect(await identity.symbol()).to.equal("KEYID");
    expect(await identity.owner()).to.equal(owner.address);
    expect(await identity.registrar()).to.equal(registrar.address);
    expect(await identity.baseURI()).to.equal("https://api.key-sphincs.xyz/api/keyspace/metadata/");
  });

  it("only owner can set registrar and base URI", async function () {
    const { owner, other, identity } = await deployIdentityFixture();

    await expect(identity.connect(other).setRegistrar(other.address)).to.be.revertedWithCustomError(
      identity,
      "OwnableUnauthorizedAccount",
    );
    await expect(identity.connect(owner).setRegistrar(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      identity,
      "InvalidRegistrar",
    );

    await identity.connect(owner).setBaseURI("https://example.com/metadata/");
    await identity.connect(owner).setRegistrar(other.address);
    expect(await identity.registrar()).to.equal(other.address);
  });

  it("mints a transferable .key identity through the registrar", async function () {
    const { registrar, user, buyer, identity } = await deployIdentityFixture();
    const { tx, proofId } = await mintIdentity(identity, registrar, user, "alpha");

    await expect(tx)
      .to.emit(identity, "IdentityMinted")
      .withArgs(1n, user.address, "alpha", 2, ethers.parseEther("1500"), user.address, proofId);

    expect(await identity.ownerOf(1)).to.equal(user.address);
    expect(await identity.nameOf(1)).to.equal("alpha.key");
    expect(await identity.tokenURI(1)).to.equal("https://api.key-sphincs.xyz/api/keyspace/metadata/1");
    expect(await identity.isNameAvailable("alpha")).to.equal(false);
    expect(await identity.isNameAvailable("beta")).to.equal(true);

    const details = await identity.identityOf(1);
    expect(details.name).to.equal("alpha");
    expect(details.originRank).to.equal(2n);
    expect(details.keyBond).to.equal(ethers.parseEther("1500"));
    expect(details.originWallet).to.equal(user.address);
    expect(details.originProofId).to.equal(proofId);
    expect(details.melted).to.equal(false);

    await identity.connect(user).transferFrom(user.address, buyer.address, 1);
    expect(await identity.ownerOf(1)).to.equal(buyer.address);
  });

  it("rejects non-registrar minting, duplicate names, and invalid names", async function () {
    const { registrar, user, buyer, identity } = await deployIdentityFixture();

    await expect(
      identity.connect(user).mintIdentity(user.address, "alpha", 2, ethers.parseEther("1500"), user.address, ethers.id("proof")),
    ).to.be.revertedWithCustomError(identity, "NotRegistrar");

    await mintIdentity(identity, registrar, user, "alpha");
    await expect(
      identity.connect(registrar).mintIdentity(buyer.address, "alpha", 2, ethers.parseEther("1500"), buyer.address, ethers.id("proof-2")),
    ).to.be.revertedWithCustomError(identity, "NameTaken");

    for (const badName of ["", "ai", "alpha1", "Alpha", "alpha-key", "alpha_key", "alpha.key", "abcdefghijklmnopq"]) {
      await expect(
        identity.connect(registrar).mintIdentity(user.address, badName, 0, 0, user.address, ethers.id(`bad-${badName}`)),
      ).to.be.revertedWithCustomError(identity, "InvalidName");
      expect(await identity.isNameAvailable(badName)).to.equal(false);
    }
  });

  it("melts only through the registrar and keeps burned names reserved", async function () {
    const { registrar, user, identity } = await deployIdentityFixture();
    await mintIdentity(identity, registrar, user, "alpha");

    await expect(identity.connect(user).meltIdentity(1)).to.be.revertedWithCustomError(identity, "NotRegistrar");
    await expect(identity.connect(registrar).meltIdentity(1))
      .to.emit(identity, "IdentityMelted")
      .withArgs(1n, user.address, "alpha", ethers.parseEther("1500"));

    await expect(identity.ownerOf(1)).to.be.revertedWithCustomError(identity, "ERC721NonexistentToken");
    expect(await identity.isNameAvailable("alpha")).to.equal(false);
    const details = await identity.identityOf(1);
    expect(details.melted).to.equal(true);
    expect(details.keyBond).to.equal(ethers.parseEther("1500"));
  });
});
