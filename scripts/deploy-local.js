import { network } from "hardhat";

const { ethers } = await network.create();

const [deployer, lpReserve, treasuryReserve, backendSigner] = await ethers.getSigners();

console.log("Deploying KEY contracts with:", deployer.address);

const vault = await ethers.deployContract("KEYTreasuryVault", [deployer.address]);
await vault.waitForDeployment();

const token = await ethers.deployContract("KEYToken", [lpReserve.address, treasuryReserve.address]);
await token.waitForDeployment();

const gate = await ethers.deployContract("KEYMintGate", [
  await token.getAddress(),
  await vault.getAddress(),
  backendSigner.address,
]);
await gate.waitForDeployment();

await (await token.setMintGate(await gate.getAddress())).wait();
await (await vault.setMintGate(await gate.getAddress())).wait();

console.log("KEYToken:", await token.getAddress());
console.log("KEYTreasuryVault:", await vault.getAddress());
console.log("KEYMintGate:", await gate.getAddress());
console.log("Backend attestation signer:", backendSigner.address);
console.log("LP reserve recipient:", lpReserve.address);
console.log("Treasury reserve recipient:", treasuryReserve.address);
