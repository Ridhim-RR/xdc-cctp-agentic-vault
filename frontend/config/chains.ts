import { defineChain } from 'viem';

export const xdcTestnet = defineChain({
  id: 51,
  name: 'XDC Apothem Testnet',
  nativeCurrency: {
    name: 'XDC',
    symbol: 'TXDC',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ['https://51.rpc.thirdweb.com']
    },
    public: {
      http: ['https://rpc.apothem.network']
    }
  },
  blockExplorers: {
    default: {
      name: 'XDCScan Apothem',
      url: 'https://apothem.xdcscan.io'
    }
  },
  testnet: true
});

export const SUPPORTED_CHAIN_ID = xdcTestnet.id;
