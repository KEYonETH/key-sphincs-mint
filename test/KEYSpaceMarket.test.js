import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

async function deployMarketFixture() {
  const [owner, registrar, seller, buyer, feeRecipient, other] = await ethers.getSigners();

  const identity = await ethers.deployContract("KEYIdentity", [
    owner.address,
    "https://api.key-sphincs.xyz/api/keyspace/metadata/",
  ]);
  await identity.connect(owner).setRegistrar(registrar.address);
  const market = await ethers.deployContract("KEYSpaceMarket", [
    owner.address,
    await identity.getAddress(),
  ]);

  await identity.connect(registrar).mintIdentity(
    seller.address,
    "alpha",
    2,
    ethers.parseEther("1500"),
    seller.address,
    ethers.id("proof-alpha"),
  );

  return { owner, registrar, seller, buyer, feeRecipient, other, identity, market };
}

describe("KEYSpaceMarket", function () {
  it("deploys closed with owner-controlled fee settings", async function () {
    const { owner, identity, market, feeRecipient } = await deployMarketFixture();

    expect(await market.owner()).to.equal(owner.address);
    expect(await market.identity()).to.equal(await identity.getAddress());
    expect(await market.marketOpen()).to.equal(false);
    expect(await market.feeBps()).to.equal(0n);
    expect(await market.feeRecipient()).to.equal(owner.address);

    await expect(market.setFee(1001, feeRecipient.address)).to.be.revertedWithCustomError(market, "InvalidFee");
    await expect(market.setFee(100, ethers.ZeroAddress)).to.be.revertedWithCustomError(market, "InvalidAddress");

    await expect(market.setMarketOpen(true)).to.emit(market, "MarketOpenSet").withArgs(true);
    await expect(market.setFee(250, feeRecipient.address))
      .to.emit(market, "FeeSet")
      .withArgs(250, feeRecipient.address);
  });

  it("lists only approved identities while market is open", async function () {
    const { seller, buyer, identity, market } = await deployMarketFixture();
    const price = ethers.parseEther("0.04");

    await expect(market.connect(seller).listIdentity(1, price)).to.be.revertedWithCustomError(market, "MarketClosed");

    await market.setMarketOpen(true);
    await expect(market.connect(buyer).listIdentity(1, price)).to.be.revertedWithCustomError(market, "NotIdentityOwner");
    await expect(market.connect(seller).listIdentity(1, 0)).to.be.revertedWithCustomError(market, "InvalidPrice");
    await expect(market.connect(seller).listIdentity(1, price)).to.be.revertedWithCustomError(market, "NotApproved");

    await identity.connect(seller).approve(await market.getAddress(), 1);
    await expect(market.connect(seller).listIdentity(1, price))
      .to.emit(market, "IdentityListed")
      .withArgs(1n, seller.address, price);

    const [listedSeller, listedPrice] = await market.getListing(1);
    expect(listedSeller).to.equal(seller.address);
    expect(listedPrice).to.equal(price);
  });

  it("buys listed identities with ETH and pays the configured fee", async function () {
    const { seller, buyer, feeRecipient, identity, market } = await deployMarketFixture();
    const price = ethers.parseEther("0.04");
    const feeBps = 250n;
    const fee = (price * feeBps) / 10_000n;
    const sellerProceeds = price - fee;

    await market.setMarketOpen(true);
    await market.setFee(Number(feeBps), feeRecipient.address);
    await identity.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).listIdentity(1, price);

    const sellerBefore = await ethers.provider.getBalance(seller.address);
    const feeBefore = await ethers.provider.getBalance(feeRecipient.address);

    await expect(market.connect(buyer).buyIdentity(1, { value: price }))
      .to.emit(market, "IdentitySold")
      .withArgs(1n, seller.address, buyer.address, price);

    expect(await identity.ownerOf(1)).to.equal(buyer.address);
    expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBefore + sellerProceeds);
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(feeBefore + fee);
    const [listedSeller, listedPrice] = await market.getListing(1);
    expect(listedSeller).to.equal(ethers.ZeroAddress);
    expect(listedPrice).to.equal(0n);
  });

  it("allows sellers or current owners to cancel stale listings", async function () {
    const { seller, buyer, other, identity, market } = await deployMarketFixture();
    const price = ethers.parseEther("0.006");

    await market.setMarketOpen(true);
    await identity.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).listIdentity(1, price);

    await expect(market.connect(other).cancelListing(1)).to.be.revertedWithCustomError(market, "NotSellerOrOwner");
    await expect(market.connect(seller).cancelListing(1))
      .to.emit(market, "IdentityListingCancelled")
      .withArgs(1n, seller.address);

    await identity.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).listIdentity(1, price);
    await identity.connect(seller).transferFrom(seller.address, buyer.address, 1);

    await expect(market.connect(other).buyIdentity(1, { value: price })).to.be.revertedWithCustomError(market, "SellerNoLongerOwner");
    await expect(market.connect(buyer).cancelListing(1))
      .to.emit(market, "IdentityListingCancelled")
      .withArgs(1n, seller.address);
  });

  it("rejects buying unlisted identities and closed-market buys", async function () {
    const { seller, buyer, identity, market } = await deployMarketFixture();
    const price = ethers.parseEther("0.006");

    await expect(market.connect(buyer).buyIdentity(1, { value: price })).to.be.revertedWithCustomError(market, "MarketClosed");

    await market.setMarketOpen(true);
    await expect(market.connect(buyer).buyIdentity(1, { value: price })).to.be.revertedWithCustomError(market, "NotListed");

    await identity.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).listIdentity(1, price);
    await expect(market.connect(buyer).buyIdentity(1, { value: price - 1n })).to.be.revertedWithCustomError(market, "WrongPayment");
    await market.setMarketOpen(false);
    await expect(market.connect(buyer).buyIdentity(1, { value: price })).to.be.revertedWithCustomError(market, "MarketClosed");
  });
});
