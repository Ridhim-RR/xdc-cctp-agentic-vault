/**
 * blockchain/contracts.ts
 *
 * Sets up ethers.js v6 Contract instances for the vault and USDC token.
 *
 * Contract Concept:
 * =================
 * A Contract is a JavaScript object that wraps the ABI and the contract address.
 * It provides methods that map directly to smart contract functions.
 *
 * When you call a method on a Contract:
 * - If it's a "view" function (read-only): ethers sends a JSON-RPC call, gets the result
 * - If it's a state-changing function: ethers encodes the call and sends it via a Signer
 *
 * Example:
 * const vault = getVaultContract(provider, vaultAddress);
 * const balance = await vault.getBalance(userAddress);  // Calls contract.getBalance()
 * await vault.deposit(amount);  // ERROR: can't sign with a provider, need a Signer
 */

import { BaseContract, Contract, JsonRpcProvider, Signer } from 'ethers';
import { VAULT_ABI, ERC20_ABI } from './constants';

/**
 * Create a read-only Contract instance for the vault.
 *
 * This can:
 * - Call view functions like getBalance()
 * - Listen to events like Deposited
 *
 * This CANNOT:
 * - Call state-changing functions like deposit() (no signer)
 *
 * @param provider - JsonRpcProvider connected to XDC testnet
 * @param vaultAddress - The deployed BondCreditVault contract address
 * @returns Contract instance for read-only vault interactions
 */
export function getVaultContract(
  provider: JsonRpcProvider,
  vaultAddress: string
): Contract {
  return new Contract(vaultAddress, VAULT_ABI, provider);
}

/**
 * Create a read-only Contract instance for the USDC token.
 *
 * This can:
 * - Check balances: balanceOf(address)
 * - Check allowances: allowance(owner, spender)
 * - Listen to Transfer events
 *
 * This CANNOT:
 * - Call approve() (no signer)
 * - Transfer tokens (no signer)
 *
 * @param provider - JsonRpcProvider connected to XDC testnet
 * @param usdcAddress - The USDC token contract address on XDC testnet
 * @returns Contract instance for read-only USDC interactions
 */
export function getUsdcContract(
  provider: JsonRpcProvider,
  usdcAddress: string
): Contract {
  return new Contract(usdcAddress, ERC20_ABI, provider);
}

/**
 * Create a signable Contract instance for the vault.
 *
 * This can:
 * - Call state-changing functions like deposit()
 * - Call view functions like getBalance()
 * - Listen to events
 *
 * Signing = using a private key to authorize a transaction
 * The signer proves you own the account making the transaction
 *
 * @param vault - Contract instance created with getVaultContract()
 * @param signer - A Signer with a private key (Wallet in ethers v6)
 * @returns Contract instance that can sign and send transactions
 */
export function getSignableVaultContract(vault: Contract, signer: Signer): Contract {
  return vault.connect(signer) as unknown as Contract;
}

/**
 * Create a signable Contract instance for USDC.
 *
 * This can:
 * - Call approve(vaultAddress, amount) to grant permissions
 * - Call view functions like balanceOf() and allowance()
 *
 * @param usdc - Contract instance created with getUsdcContract()
 * @param signer - A Signer with a private key (Wallet in ethers v6)
 * @returns Contract instance that can sign and send transactions
 */
export function getSignableUsdcContract(usdc: Contract, signer: Signer): Contract {
  return usdc.connect(signer) as unknown as Contract;
}
