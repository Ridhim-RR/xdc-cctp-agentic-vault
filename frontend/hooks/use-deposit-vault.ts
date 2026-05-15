'use client';

import { useCallback } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers';
import { useWalletState } from '@/hooks/use-wallet-state';
import { useTransactionState } from '@/hooks/use-transaction-state';
import { USDC_ADDRESS, USDC_DECIMALS, VAULT_ADDRESS } from '@/contracts/addresses';
import { erc20Abi } from '@/contracts/abis/erc20';
import { vaultAbi } from '@/contracts/abis/vault';
import { parseTokenAmount } from '@/utils/token-format';
import { normalizeWeb3Error } from '@/utils/web3-errors';

async function waitForReceiptWithPublicRpc(txHash: string): Promise<void> {
  const rpcUrl = process.env.NEXT_PUBLIC_XDC_RPC_URL || 'https://51.rpc.thirdweb.com';
  const provider = new JsonRpcProvider(rpcUrl);

  const maxAttempts = 90;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (!message.includes('rate limit') && !message.includes('429') && !message.includes('-32005')) {
        throw error;
      }
    }

    const delayMs = Math.min(1500 * Math.pow(1.2, attempt), 8000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Timed out waiting for transaction receipt. Please check the block explorer with the tx hash.');
}

export function useDepositVault() {
  const { isConnected, isWrongNetwork, address } = useWalletState();
  const tx = useTransactionState();

  const deposit = useCallback(
    async (humanAmount: string) => {
      try {
        if (!isConnected || !address) {
          throw new Error('Connect wallet before depositing.');
        }
        if (isWrongNetwork) {
          throw new Error('Switch to XDC Testnet before depositing.');
        }
        if (!(globalThis as Window & { ethereum?: unknown }).ethereum) {
          throw new Error('No injected wallet provider found.');
        }

        const amount = parseTokenAmount(humanAmount, USDC_DECIMALS);
        tx.setSubmitting('Checking balance and allowance...');

        const provider = new BrowserProvider((globalThis as Window & { ethereum: unknown }).ethereum);
        const signer = await provider.getSigner();
        const usdc = new Contract(USDC_ADDRESS, erc20Abi, provider);
        const vault = new Contract(VAULT_ADDRESS, vaultAbi, signer);

        // Check USDC balance first
        const balance = (await usdc.balanceOf(address)) as bigint;
        if (balance < amount) {
          const balanceFormatted = (Number.parseFloat(balance.toString()) / Math.pow(10, USDC_DECIMALS)).toFixed(2);
          const amountFormatted = (Number.parseFloat(amount.toString()) / Math.pow(10, USDC_DECIMALS)).toFixed(2);
          throw new Error(
            `Insufficient USDC balance. You have ${balanceFormatted} USDC but trying to deposit ${amountFormatted} USDC.`
          );
        }

        // Check allowance
        const allowance = (await usdc.allowance(address, VAULT_ADDRESS)) as bigint;
        if (allowance < amount) {
          throw new Error('Insufficient allowance. Approve USDC first.');
        }

        tx.setSubmitting('Submitting deposit transaction...');

        // Vault deposit: contract internally calls transferFrom(user, vault, amount).
        const depositTx = await vault.deposit(amount);
        tx.setPending(depositTx.hash, 'Deposit submitted. Waiting for confirmation...');

        tx.setSubmitting('Deposit submitted. Waiting for confirmation via public RPC...');
        await waitForReceiptWithPublicRpc(depositTx.hash);

        tx.setConfirmed(depositTx.hash, 'Deposit confirmed successfully!');
      } catch (error) {
        tx.setError(normalizeWeb3Error(error));
      }
    },
    [address, isConnected, isWrongNetwork, tx]
  );

  return {
    deposit,
    txState: tx.txState,
    resetTxState: tx.reset
  };
}
