require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    return [];
  }

  const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  return [formattedKey];
}

/**
 * Hardhat configuration for XDC testnet (Apothem / chainId: 51).
 * Adjust `XDC_TESTNET_RPC` and `DEPLOYER_PRIVATE_KEY` in your .env file.
 */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    xdcTestnet: {
      url: process.env.XDC_TESTNET_RPC || 'https://rpc.apothem.network',
      chainId: 51,
      accounts: normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY)
    }
  }
};
