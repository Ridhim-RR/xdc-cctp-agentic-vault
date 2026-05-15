/**
 * blockchain/index.ts
 *
 * Central export point for all blockchain-related utilities.
 * Allows cleaner imports: import { getProvider, getWallet, ... } from 'src/blockchain'
 */

export { VAULT_ABI, ERC20_ABI } from './constants';
export {
  getProvider,
  getCurrentBlockNumber,
  getNetworkInfo
} from './provider';
export {
  getVaultContract,
  getUsdcContract,
  getSignableVaultContract,
  getSignableUsdcContract
} from './contracts';
export { getWallet, getWalletAddress, connectWalletToProvider } from './wallet';
