'use client';

import { useCallback } from 'react';
import { BrowserProvider, Contract } from 'ethers';
import { useWalletState } from '@/hooks/use-wallet-state';
import { useTransactionState } from '@/hooks/use-transaction-state';
import { USDC_ADDRESS, USDC_DECIMALS, VAULT_ADDRESS } from '@/contracts/addresses';
import { erc20Abi } from '@/contracts/abis/erc20';
import { parseTokenAmount } from '@/utils/token-format';
import { normalizeWeb3Error } from '@/utils/web3-errors';
import { sleep } from '@/utils/sleep';

export function useApproveUsdc() {
  const { isConnected, isWrongNetwork } = useWalletState();
  const tx = useTransactionState();

  const approve = useCallback(
    async (humanAmount: string) => {
      try {
        if (!isConnected) {
          throw new Error('Connect wallet before approving.');
        }
        if (isWrongNetwork) {
          throw new Error('Switch to XDC Testnet before approving.');
        }
        if (!(window as Window & { ethereum?: unknown }).ethereum) {
          throw new Error('No injected wallet provider found.');
        }

        const amount = parseTokenAmount(humanAmount, USDC_DECIMALS);
        tx.setSubmitting('Creating approval transaction...');

        const provider = new BrowserProvider((window as Window & { ethereum: unknown }).ethereum);
        const signer = await provider.getSigner();
        const usdc = new Contract(USDC_ADDRESS, erc20Abi, signer);

        // ERC20 approval: this grants the vault permission to pull USDC via transferFrom.
        const approveTx = await usdc.approve(VAULT_ADDRESS, amount);
        tx.setPending(approveTx.hash, 'Approval submitted. Waiting for confirmation...');

        // Wait for the transaction to be mined using provider.waitForTransaction
        // with retries/backoff to avoid hitting RPC rate limits.
        await waitForReceiptWithBackoff(provider, approveTx.hash);
        tx.setConfirmed(approveTx.hash, 'USDC approval confirmed. You can deposit now.');
      } catch (error) {
        tx.setError(normalizeWeb3Error(error));
      }
    },
    [isConnected, isWrongNetwork, tx]
  );

  /**
   * Wait for transaction receipt with exponential backoff retries.
   * Uses the provider.waitForTransaction API under the hood.
   */
  async function waitForReceiptWithBackoff(provider: BrowserProvider, txHash: string, maxAttempts = 6) {
    // attempt 0..maxAttempts-1
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // wait up to 2 minutes for mining on each attempt
        const receipt = await provider.waitForTransaction(txHash, 1, 120_000);
        if (receipt) return receipt;
      } catch (err: any) {
        // If it's a rate-limit error (HTTP 429) or temporary RPC error, retry
        const message = String(err?.message || err);
        if (message.includes('rate limit') || message.includes('429') || message.includes('Request is being rate limited')) {
          const delay = Math.min(30_000, 1000 * 2 ** attempt);
          await sleep(delay);
          continue;
        }
        // Other errors: rethrow
        throw err;
      }
    }
    throw new Error('Timed out waiting for transaction receipt');
  }

  const checkAllowance = useCallback(async (owner: string, humanAmount: string): Promise<boolean> => {
    if (!(window as Window & { ethereum?: unknown }).ethereum) return false;

    const amount = parseTokenAmount(humanAmount, USDC_DECIMALS);
    const provider = new BrowserProvider((window as Window & { ethereum: unknown }).ethereum);
    const usdc = new Contract(USDC_ADDRESS, erc20Abi, provider);
    const allowance = (await usdc.allowance(owner, VAULT_ADDRESS)) as bigint;
    return allowance >= amount;
  }, []);

  return {
    approve,
    checkAllowance,
    txState: tx.txState,
    resetTxState: tx.reset
  };
}
