import { Injectable, Logger } from '@nestjs/common';
import { getProvider, getSignableVaultContract, getUsdcContract, getVaultContract, getWallet } from '../blockchain';
import { TransferStateService } from '../transfers/transfer-state.service';
import { TransferStatus } from '@prisma/client';

@Injectable()
export class VaultBridgeService {
  private readonly logger = new Logger(VaultBridgeService.name);

  constructor(private readonly transferStateService: TransferStateService) {}

  private getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} not configured`);
    }
    return value;
  }

  async transferAndVerify(amount: bigint, transferId?: string): Promise<{
    bridgeWallet: string;
    preBalance: bigint;
    postBalance: bigint;
    txHash: string;
    blockNumber: number;
  }> {
    try {
      const rpcUrl = process.env.XDC_TESTNET_RPC || 'https://51.rpc.thirdweb.com';
      const provider = getProvider(rpcUrl);

      const vaultAddress = this.getRequiredEnv('VAULT_ADDRESS');
      const usdcAddress = process.env.USDC_ADDRESS || this.getRequiredEnv('USDC_ADDRESS_XDC');
      const ownerPrivateKey = this.getRequiredEnv('DEPLOYER_PRIVATE_KEY');

      const ownerSigner = getWallet(ownerPrivateKey, provider);
      const bridgeWallet = ownerSigner.address;

    if (transferId) {
      const existingTransfer = await this.transferStateService.getTransferState(transferId);
      if (existingTransfer?.status === TransferStatus.VAULT_TO_BRIDGE_TRANSFER_CONFIRMED) {
        this.logger.log(
          `[VaultBridge] Skipping transfer for ${transferId} because it is already confirmed`
        );
        return {
          bridgeWallet,
          preBalance: BigInt(existingTransfer.bridgeWalletPreBalance || '0'),
          postBalance: BigInt(existingTransfer.bridgeWalletPostBalance || '0'),
          txHash: existingTransfer.vaultToBridgeTxHash || '',
          blockNumber: existingTransfer.vaultToBridgeBlockNumber || 0,
        };
      }
    }

      const vault = getVaultContract(provider, vaultAddress);
      const signableVault = getSignableVaultContract(vault, ownerSigner);
      const usdc = getUsdcContract(provider, usdcAddress);

      const preBalance = await usdc.balanceOf(bridgeWallet);

      this.logger.log(
        `[VaultBridge] Initiating vault -> bridge transfer. bridgeWallet=${bridgeWallet}, amount=${amount.toString()}`
      );

      const tx = await signableVault.transferToBridgeWallet(bridgeWallet, amount);

      if (transferId) {
        await this.transferStateService.markVaultToBridgeInitiated(transferId, tx.hash, bridgeWallet);
      }

      const confirmations = Number.parseInt(process.env.XDC_CONFIRMATIONS_REQUIRED || '1', 10);
      const receipt = await tx.wait(confirmations);

      if (!receipt) {
        throw new Error('Vault transfer transaction failed or receipt not available');
      }

      const postBalance = await usdc.balanceOf(bridgeWallet);
      const expected = preBalance + amount;

      if (postBalance < expected) {
        throw new Error(
          `Bridge wallet verification failed. Expected >= ${expected.toString()}, got ${postBalance.toString()}`
        );
      }

      this.logger.log(
        `[VaultBridge] Transfer confirmed. txHash=${receipt.hash}, pre=${preBalance.toString()}, post=${postBalance.toString()}`
      );

      if (transferId) {
        await this.transferStateService.markVaultToBridgeConfirmed({
          transferId,
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          bridgeWalletAddress: bridgeWallet,
          preBalance,
          postBalance,
        });
      }

      return {
        bridgeWallet,
        preBalance,
        postBalance,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      if (transferId) {
        await this.transferStateService.markVaultToBridgeFailed(
          transferId,
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    }
  }
}
