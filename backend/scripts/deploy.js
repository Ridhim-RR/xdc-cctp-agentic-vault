require('dotenv').config();
const { ethers } = require('hardhat');

async function main() {
  const usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) {
    throw new Error('Set USDC_ADDRESS in .env');
  }

  console.log('Deploying BondCreditVault with USDC:', usdcAddress);

  const BondCreditVault = await ethers.getContractFactory('BondCreditVault');
  const vault = await BondCreditVault.deploy(usdcAddress);
  await vault.waitForDeployment();

  console.log('BondCreditVault deployed to:', await vault.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
