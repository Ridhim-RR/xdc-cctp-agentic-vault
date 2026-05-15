import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'viem';
import { xdcTestnet } from '@/config/chains';

export const wagmiConfig = getDefaultConfig({
  appName: 'bond.credit',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'bond-credit-dev-project-id',
  chains: [xdcTestnet],
  transports: {
    [xdcTestnet.id]: http('https://51.rpc.thirdweb.com')
  },
  ssr: true
});
