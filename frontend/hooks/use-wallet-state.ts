'use client';

import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { SUPPORTED_CHAIN_ID } from '@/config/chains';

export function useWalletState() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const isWrongNetwork = isConnected && chainId !== SUPPORTED_CHAIN_ID;

  async function switchToSupportedNetwork() {
    if (!switchChainAsync) return;
    await switchChainAsync({ chainId: SUPPORTED_CHAIN_ID });
  }

  return {
    address,
    isConnected,
    chainId,
    isWrongNetwork,
    isSwitching,
    switchToSupportedNetwork
  };
}
