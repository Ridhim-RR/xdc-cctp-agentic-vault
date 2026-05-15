import { SUPPORTED_CHAIN_ID } from '@/config/chains';

export function isSupportedChain(chainId?: number): boolean {
  return chainId === SUPPORTED_CHAIN_ID;
}
