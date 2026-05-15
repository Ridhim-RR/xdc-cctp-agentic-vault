/**
 * blockchain/wallet.ts
 *
 * Sets up ethers.js v6 Wallet (signer) for signing transactions.
 *
 * Signer Concept:
 * ================
 * A Signer is a private key combined with a provider.
 * It can:
 * - Sign transactions (prove you authorize them)
 * - Sign messages
 * - Estimate gas costs
 * - Send transactions
 *
 * A Wallet in ethers v6 is a type of Signer that uses an Ethereum/EVM private key.
 * Unlike a Provider (read-only), a Signer can change blockchain state.
 *
 * Important: NEVER expose private keys in logs, config files, or frontend code.
 * Always store them in environment variables (.env files) and never commit .env to git.
 */

import { Wallet, JsonRpcProvider } from 'ethers';

/**
 * Create a Wallet (Signer) from a private key.
 *
 * The private key is typically a 64-character hex string, optionally prefixed with 0x.
 * Example: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
 *
 * @param privateKey - The private key (with or without 0x prefix)
 * @param provider - JsonRpcProvider for network connection (optional)
 * @returns A Wallet instance that can sign transactions
 *
 * Example usage:
 * const wallet = getWallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
 * const address = wallet.address;  // Get the wallet's address
 * const tx = await vault.connect(wallet).deposit(amount);  // Sign and send
 */
export function getWallet(privateKey: string, provider?: JsonRpcProvider): Wallet {
  // Normalize the private key: add 0x prefix if not present
  const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  if (provider) {
    // Create a Wallet connected to a provider
    // This allows it to send transactions and query blockchain state
    return new Wallet(normalizedKey, provider);
  } else {
    // Create a disconnected Wallet (read-only signing)
    // Can sign messages and transactions offline, but can't send them
    return new Wallet(normalizedKey);
  }
}

/**
 * Get the public address of a wallet from its private key.
 *
 * Why this is useful:
 * - Verify you're using the correct private key
 * - Get the address to fund it with test tokens
 * - Log the address for debugging
 *
 * @param privateKey - The private key (with or without 0x prefix)
 * @returns The public Ethereum/XDC address derived from the private key
 *
 * Example:
 * const address = getWalletAddress(process.env.DEPLOYER_PRIVATE_KEY);
 * console.log('Fund this address with test XDC:', address);
 */
export function getWalletAddress(privateKey: string): string {
  const wallet = getWallet(privateKey);
  return wallet.address;
}

/**
 * Connect an existing Wallet to a provider.
 *
 * Use this if you have a Wallet that was created offline
 * and now need to connect it to send transactions.
 *
 * @param wallet - The existing Wallet instance
 * @param provider - JsonRpcProvider to connect to
 * @returns The same wallet, now connected to the provider
 */
export function connectWalletToProvider(wallet: Wallet, provider: JsonRpcProvider): Wallet {
  return wallet.connect(provider);
}
