/**
 * blockchain/provider.ts
 *
 * Sets up ethers.js v6 provider for connecting to XDC testnet.
 *
 * Provider Concept:
 * ================
 * A provider is a read-only connection to the blockchain.
 * It allows you to:
 * - Query blockchain state (get account balances, contract data)
 * - Listen to events
 * - Get transaction receipts
 * - Estimate gas costs
 *
 * It CANNOT sign transactions (no private key).
 * To sign transactions, you need a Signer (which wraps a provider + a private key).
 *
 * RPC = Remote Procedure Call
 * When you create a provider with a URL, ethers.js sends JSON-RPC requests to that URL.
 * The RPC server (like Apothem for XDC testnet) responds with blockchain data.
 */

import { JsonRpcProvider } from 'ethers';

/**
 * Create and return a provider for the XDC testnet (Apothem).
 *
 * @param rpcUrl - The JSON-RPC endpoint URL (from environment or config)
 * @returns A JsonRpcProvider instance connected to the XDC testnet
 *
 * Example usage:
 * const provider = getProvider('https://51.rpc.thirdweb.com');
 * const balance = await provider.getBalance('0x...');
 */
export function getProvider(rpcUrl: string): JsonRpcProvider {
  // JsonRpcProvider is ethers v6's lightweight RPC connection class
  // It handles HTTP requests to the RPC endpoint
  const provider = new JsonRpcProvider(rpcUrl, {
    // chainId: 51 tells ethers that this is XDC testnet
    // Used for signature validation and transaction encoding
    chainId: 51,
    // name identifies the network (for debugging and logging)
    name: 'xdc-apothem'
  });

  return provider;
}

/**
 * Query the current block number on the blockchain.
 *
 * Why this matters:
 * - Block numbers are used to track event listener progress
 * - When restarting the listener, we resume from the last known block
 * - This prevents re-processing the same events (deduplication)
 *
 * @param provider - The JsonRpcProvider instance
 * @returns The current block number on the blockchain
 */
export async function getCurrentBlockNumber(provider: JsonRpcProvider): Promise<number> {
  return await provider.getBlockNumber();
}

/**
 * Get the network details from the provider.
 *
 * Useful for verifying you're connected to the correct chain.
 *
 * @param provider - The JsonRpcProvider instance
 * @returns Network details including chainId and network name
 */
export async function getNetworkInfo(provider: JsonRpcProvider) {
  const network = await provider.getNetwork();
  return {
    chainId: network.chainId,
    name: network.name
  };
}
