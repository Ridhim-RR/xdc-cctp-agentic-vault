/**
 * TRANSFER STATE SERVICE
 * 
 * RESPONSIBILITY:
 * Manage transfer state machine in PostgreSQL
 * Update transfer status through workflow stages
 * Record audit trail of all changes
 * 
 * WHY THIS SERVICE EXISTS:
 * - Single source of truth for transfer state
 * - State machine validation (can't skip stages)
 * - Audit trail in TransferLog table
 * - Enables recovery and debugging
 * 
 * STATE MACHINE:
 * DEPOSIT_DETECTED → BURN_PENDING → BURN_CONFIRMED → 
 * ATTESTATION_PENDING → ATTESTATION_RECEIVED → 
 * MINT_PENDING → MINT_CONFIRMED → TRANSFER_COMPLETED
 * 
 * Database allows resuming from any state
 * BullMQ queues handle retries at failed stage
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient, TransferStatus } from '@prisma/client';

/**
 * Prisma client singleton
 * In production: use @nestjs/prisma module
 */
const prisma = new PrismaClient();

@Injectable()
export class TransferStateService {
  private readonly logger = new Logger(TransferStateService.name);

  /**
   * Create the initial transfer row once a deposit is detected.
   * This keeps transfer creation in the state service so listeners do not need direct Prisma access.
   */
  async createTransferFromDeposit(params: {
    depositId: string;
    recipientAddressArb: string;
    amount: string;
  }): Promise<any> {
    return prisma.crossChainTransfer.create({
      data: {
        depositId: params.depositId,
        recipientAddressArb: params.recipientAddressArb,
        recipientAddressArbLower: params.recipientAddressArb.toLowerCase(),
        amount: params.amount,
        status: TransferStatus.DEPOSIT_DETECTED,
      },
    });
  }

  async getTransferByDepositId(depositId: string): Promise<any> {
    return prisma.crossChainTransfer.findUnique({
      where: { depositId },
    });
  }

  async markVaultToBridgeInitiated(
    transferId: string,
    txHash: string,
    bridgeWalletAddress: string,
  ): Promise<void> {
    await prisma.crossChainTransfer.update({
      where: { id: transferId },
      data: {
        status: TransferStatus.VAULT_TO_BRIDGE_TRANSFER_INITIATED,
        statusUpdatedAt: new Date(),
        bridgeWalletAddress,
        vaultToBridgeTxHash: txHash,
        vaultToBridgeInitiatedAt: new Date(),
        bridgeTransferAttempts: { increment: 1 },
        bridgeTransferError: null,
      },
    });

    await this.createTransferLog(
      transferId,
      'vault_to_bridge',
      'Vault to bridge transfer transaction submitted',
      TransferStatus.VAULT_TO_BRIDGE_TRANSFER_INITIATED,
      { txHash, bridgeWalletAddress },
    );
  }

  async markVaultToBridgeConfirmed(params: {
    transferId: string;
    txHash: string;
    blockNumber: number;
    bridgeWalletAddress: string;
    preBalance: bigint;
    postBalance: bigint;
  }): Promise<void> {
    await prisma.crossChainTransfer.update({
      where: { id: params.transferId },
      data: {
        status: TransferStatus.VAULT_TO_BRIDGE_TRANSFER_CONFIRMED,
        statusUpdatedAt: new Date(),
        bridgeWalletAddress: params.bridgeWalletAddress,
        vaultToBridgeTxHash: params.txHash,
        vaultToBridgeBlockNumber: params.blockNumber,
        vaultToBridgeConfirmedAt: new Date(),
        bridgeWalletPreBalance: params.preBalance.toString(),
        bridgeWalletPostBalance: params.postBalance.toString(),
        bridgeTransferError: null,
      },
    });

    await this.createTransferLog(
      params.transferId,
      'vault_to_bridge',
      'Vault to bridge transfer confirmed',
      TransferStatus.VAULT_TO_BRIDGE_TRANSFER_CONFIRMED,
      {
        txHash: params.txHash,
        blockNumber: params.blockNumber,
        bridgeWalletAddress: params.bridgeWalletAddress,
        preBalance: params.preBalance.toString(),
        postBalance: params.postBalance.toString(),
      },
    );
  }

  async markVaultToBridgeFailed(
    transferId: string,
    errorMessage: string,
  ): Promise<void> {
    await prisma.crossChainTransfer.update({
      where: { id: transferId },
      data: {
        bridgeTransferError: errorMessage,
      },
    });

    await this.createTransferLog(
      transferId,
      'vault_to_bridge',
      `Vault to bridge transfer failed: ${errorMessage}`,
      TransferStatus.DEPOSIT_DETECTED,
      {},
      errorMessage,
    );
  }

  async markApprovalPending(transferId: string): Promise<void> {
    await prisma.crossChainTransfer.update({
      where: { id: transferId },
      data: {
        status: TransferStatus.APPROVAL_PENDING,
        statusUpdatedAt: new Date(),
      },
    });

    await this.createTransferLog(
      transferId,
      'approval',
      'USDC approval transaction pending',
      TransferStatus.APPROVAL_PENDING,
    );
  }

  async markApprovalConfirmed(transferId: string, approvalTxHash: string): Promise<void> {
    await prisma.crossChainTransfer.update({
      where: { id: transferId },
      data: {
        status: TransferStatus.APPROVAL_CONFIRMED,
        statusUpdatedAt: new Date(),
      },
    });

    await this.createTransferLog(
      transferId,
      'approval',
      'USDC approval confirmed',
      TransferStatus.APPROVAL_CONFIRMED,
      { approvalTxHash },
    );
  }

  async markBurnPending(transferId: string): Promise<void> {
    await prisma.crossChainTransfer.update({
      where: { id: transferId },
      data: {
        status: TransferStatus.BURN_PENDING,
        statusUpdatedAt: new Date(),
      },
    });

    await this.createTransferLog(
      transferId,
      'burn',
      'Burn transaction pending',
      TransferStatus.BURN_PENDING,
    );
  }

  async markMessageExtracted(transferId: string, messageHash: string): Promise<void> {
    await prisma.crossChainTransfer.update({
      where: { id: transferId },
      data: {
        status: TransferStatus.MESSAGE_EXTRACTED,
        statusUpdatedAt: new Date(),
      },
    });

    await this.createTransferLog(
      transferId,
      'burn',
      'CCTP message extracted from burn receipt',
      TransferStatus.MESSAGE_EXTRACTED,
      { messageHash },
    );
  }

  async upsertCctpBurnRecord(params: {
    transferId: string;
    destinationDomain: number;
    burnTokenAddress: string;
    tokenMessengerAddress: string;
    bridgeWalletAddress: string;
    amount: string;
    status: TransferStatus;
    approvalTxHash?: string;
    burnTxHash?: string;
    burnBlockNumber?: number;
    messageBytes?: string;
    messageHash?: string;
    bridgeWalletPreBurnBalance?: string;
    bridgeWalletPostBurnBalance?: string;
    errorMessage?: string;
    incrementAttempts?: boolean;
  }): Promise<void> {
    try {
      await prisma.cctpBurn.upsert({
        where: { transferId: params.transferId },
        create: {
          transferId: params.transferId,
          destinationDomain: params.destinationDomain,
          burnTokenAddress: params.burnTokenAddress,
          tokenMessengerAddress: params.tokenMessengerAddress,
          bridgeWalletAddress: params.bridgeWalletAddress,
          amount: params.amount,
          status: params.status,
          approvalTxHash: params.approvalTxHash,
          burnTxHash: params.burnTxHash,
          burnBlockNumber: params.burnBlockNumber,
          messageBytes: params.messageBytes,
          messageHash: params.messageHash,
          bridgeWalletPreBurnBalance: params.bridgeWalletPreBurnBalance,
          bridgeWalletPostBurnBalance: params.bridgeWalletPostBurnBalance,
          errorMessage: params.errorMessage,
          attempts: params.incrementAttempts ? 1 : 0,
          approvalConfirmedAt: params.approvalTxHash ? new Date() : null,
          burnConfirmedAt: params.burnTxHash ? new Date() : null,
          messageExtractedAt: params.messageHash ? new Date() : null,
        },
        update: {
          destinationDomain: params.destinationDomain,
          burnTokenAddress: params.burnTokenAddress,
          tokenMessengerAddress: params.tokenMessengerAddress,
          bridgeWalletAddress: params.bridgeWalletAddress,
          amount: params.amount,
          status: params.status,
          approvalTxHash: params.approvalTxHash,
          burnTxHash: params.burnTxHash,
          burnBlockNumber: params.burnBlockNumber,
          messageBytes: params.messageBytes,
          messageHash: params.messageHash,
          bridgeWalletPreBurnBalance: params.bridgeWalletPreBurnBalance,
          bridgeWalletPostBurnBalance: params.bridgeWalletPostBurnBalance,
          errorMessage: params.errorMessage,
          attempts: params.incrementAttempts ? { increment: 1 } : undefined,
          approvalConfirmedAt: params.approvalTxHash ? new Date() : undefined,
          burnConfirmedAt: params.burnTxHash ? new Date() : undefined,
          messageExtractedAt: params.messageHash ? new Date() : undefined,
        },
      });
    } catch (error) {
      if (
        params.messageHash
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        const existingBurn = await prisma.cctpBurn.findUnique({
          where: { messageHash: params.messageHash },
          select: { id: true, transferId: true, status: true },
        });

        if (existingBurn) {
          this.logger.warn(
            `[State] Duplicate cctpBurn messageHash handled idempotently. transfer=${params.transferId}, existingTransfer=${existingBurn.transferId}, messageHash=${params.messageHash.substring(0, 10)}...`
          );
          return;
        }
      }

      throw error;
    }
  }

  /**
   * Update transfer state: BURN_CONFIRMED
   * 
   * CALLED AFTER:
   * - burnService.executeBurn() succeeds
   * 
   * UPDATES:
   * - status → BURN_CONFIRMED
   * - xdcBurnTxHash (immutable)
   * - xdcBurnBlockNumber (immutable)
   * - messageHash (immutable, used for attestation polling)
   * - messageBytes (immutable, used for mint)
   * 
   * @param transferId Transfer record ID
   * @param txHash Burn transaction hash
   * @param blockNumber Block where burn was included
   * @param messageHash Keccak256 hash of message
   * @param messageBytes Raw message bytes
   */
  async updateBurnConfirmed(
    transferId: string,
    txHash: string,
    blockNumber: number,
    messageHash: string,
    messageBytes: string,
  ): Promise<void> {
    try {
      const alreadyHandled = await this.checkAndHandleDuplicateBurnMessageHash(
        transferId,
        txHash,
        blockNumber,
        messageHash,
      );
      if (alreadyHandled) {
        return;
      }

      await prisma.crossChainTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.BURN_CONFIRMED,
          statusUpdatedAt: new Date(),
          xdcBurnTxHash: txHash,
          xdcBurnBlockNumber: blockNumber,
          messageHash,
          messageBytes,
          xdcBurnConfirmedAt: new Date(),
          burnAttempts: {
            increment: 1,
          },
        },
      });

      this.logger.log(
        `[State] Transfer ${transferId} → BURN_CONFIRMED (tx: ${txHash})`
      );

      await this.createTransferLog(
        transferId,
        'burn',
        'Burn transaction confirmed',
        TransferStatus.BURN_CONFIRMED,
        { txHash, blockNumber, messageHash: messageHash.substring(0, 10) },
      );
    } catch (error) {
      const handledP2002 = await this.handleDuplicateBurnMessageHashP2002(
        error,
        transferId,
        txHash,
        blockNumber,
        messageHash,
      );
      if (handledP2002) {
        return;
      }

      this.logger.error(
        `Failed to update burn confirmed state: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async checkAndHandleDuplicateBurnMessageHash(
    transferId: string,
    txHash: string,
    blockNumber: number,
    messageHash: string,
  ): Promise<boolean> {
    const currentTransfer = await prisma.crossChainTransfer.findUnique({
      where: { id: transferId },
      select: { id: true, status: true, messageHash: true },
    });

    if (!currentTransfer) {
      this.logger.warn(`[State] Transfer ${transferId} not found during burn confirmation; skipping update`);
      return true;
    }

    if (currentTransfer.messageHash === messageHash) {
      this.logger.warn(
        `[State] Replayed burn detected for transfer ${transferId}; messageHash already persisted. Skipping duplicate persistence.`
      );
      await this.createTransferLog(
        transferId,
        'burn',
        'Replayed burn detected; skipping duplicate hash persistence',
        currentTransfer.status,
        { txHash, blockNumber, messageHash: messageHash.substring(0, 10) },
      );
      return true;
    }

    const existingHashOwner = await prisma.crossChainTransfer.findUnique({
      where: { messageHash },
      select: { id: true, status: true, xdcBurnTxHash: true },
    });

    if (existingHashOwner && existingHashOwner.id !== transferId) {
      this.logger.warn(
        `[State] Duplicate hash detected. transfer=${transferId}, existingTransfer=${existingHashOwner.id}, messageHash=${messageHash.substring(0, 10)}... Skipping duplicate persistence.`
      );
      await this.createTransferLog(
        transferId,
        'burn',
        'Duplicate message hash detected; skipping idempotent persistence',
        currentTransfer.status,
        {
          txHash,
          blockNumber,
          messageHash: messageHash.substring(0, 10),
          existingTransferId: existingHashOwner.id,
          existingTransferStatus: existingHashOwner.status,
        },
      );
      return true;
    }

    return false;
  }

  private async handleDuplicateBurnMessageHashP2002(
    error: unknown,
    transferId: string,
    txHash: string,
    blockNumber: number,
    messageHash: string,
  ): Promise<boolean> {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }

    const existingHashOwner = await prisma.crossChainTransfer.findUnique({
      where: { messageHash },
      select: { id: true, status: true },
    });

    if (!existingHashOwner) {
      return false;
    }

    this.logger.warn(
      `[State] Idempotent duplicate handling success. transfer=${transferId}, existingTransfer=${existingHashOwner.id}, messageHash=${messageHash.substring(0, 10)}...`
    );
    await this.createTransferLog(
      transferId,
      'burn',
      'Idempotent duplicate hash conflict handled safely',
      existingHashOwner.id === transferId
        ? TransferStatus.BURN_CONFIRMED
        : TransferStatus.BURN_PENDING,
      {
        txHash,
        blockNumber,
        messageHash: messageHash.substring(0, 10),
        existingTransferId: existingHashOwner.id,
      },
    );
    return true;
  }

  /**
   * Update transfer state: ATTESTATION_RECEIVED
   * 
   * CALLED AFTER:
   * - attestationService.pollForAttestation() succeeds
   * 
   * UPDATES:
   * - status → ATTESTATION_RECEIVED
   * - attestation (immutable, used for mint)
   * - attestationReceivedAt
   * 
   * @param transferId Transfer record ID
   * @param attestation Attestation proof from Circle
   */
  async updateAttestationReceived(
    transferId: string,
    attestation: string,
  ): Promise<void> {
    try {
      await prisma.crossChainTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.ATTESTATION_RECEIVED,
          statusUpdatedAt: new Date(),
          attestation,
          attestationReceivedAt: new Date(),
          attestationStatus: 'attested',
        },
      });

      this.logger.log(
        `[State] Transfer ${transferId} → ATTESTATION_RECEIVED`
      );

      await this.createTransferLog(
        transferId,
        'attestation',
        'Attestation proof received from Circle',
        TransferStatus.ATTESTATION_RECEIVED,
        { attestation: attestation.substring(0, 10) },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update attestation received state: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Update transfer state: TRANSFER_COMPLETED
   * 
   * CALLED AFTER:
   * - mintService.executeMint() succeeds
   * 
   * UPDATES:
   * - status → TRANSFER_COMPLETED
   * - arbMintTxHash (immutable)
   * - arbMintBlockNumber (immutable)
   * - arbMintConfirmedAt
   * - completedAt
   * 
   * MARKS TRANSFER AS DONE
   * Frontend can now show "Transfer Complete"
   * User has USDC on Arbitrum
   * 
   * @param transferId Transfer record ID
   * @param mintTxHash Mint transaction hash
   * @param mintBlockNumber Block where mint was included
   */
  async markTransferCompleted(
    transferId: string,
    mintTxHash: string,
    mintBlockNumber: number,
  ): Promise<void> {
    try {
      await prisma.crossChainTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.TRANSFER_COMPLETED,
          statusUpdatedAt: new Date(),
          arbMintTxHash: mintTxHash,
          arbMintBlockNumber: mintBlockNumber,
          arbMintConfirmedAt: new Date(),
          completedAt: new Date(),
          mintAttempts: {
            increment: 1,
          },
        },
      });

      this.logger.log(
        `[State] Transfer ${transferId} → TRANSFER_COMPLETED (mint tx: ${mintTxHash})`
      );

      await this.createTransferLog(
        transferId,
        'mint',
        'Mint transaction confirmed. Transfer complete!',
        TransferStatus.TRANSFER_COMPLETED,
        { mintTxHash, blockNumber: mintBlockNumber },
      );
    } catch (error) {
      this.logger.error(
        `Failed to mark transfer completed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Mark transfer as FAILED (permanent failure)
   * 
   * CALLED WHEN:
   * - Burn failed permanently (invalid input, contract error)
   * - Cannot retry
   * 
   * UPDATES:
   * - status → TRANSFER_FAILED
   * - failureReason
   * - Ends workflow (no more retries)
   * 
   * CAUSES:
   * - Invalid recipient address
   * - Contract reverted (security check failed)
   * - User cancelled
   * 
   * @param transferId Transfer record ID
   * @param phase Which phase failed (burn, attestation, mint)
   * @param errorMessage Error description
   */
  async markTransferFailed(
    transferId: string,
    phase: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      const failureReason = `${phase}: ${errorMessage}`;

      await prisma.crossChainTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.TRANSFER_FAILED,
          statusUpdatedAt: new Date(),
          failureReason,
        },
      });

      this.logger.error(
        `[State] Transfer ${transferId} → TRANSFER_FAILED (${failureReason})`
      );

      await this.createTransferLog(
        transferId,
        phase,
        failureReason,
        TransferStatus.TRANSFER_FAILED,
        { phase, errorMessage },
        errorMessage,
      );
    } catch (error) {
      this.logger.error(`Failed to mark transfer failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Mark attestation as PENDING (will be retried)
   * 
   * CALLED WHEN:
   * - Attestation polling times out after 100 attempts
   * - BullMQ will retry later
   * 
   * @param transferId Transfer record ID
   * @param errorMessage Error from polling
   */
  async markAttestationPending(
    transferId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await prisma.crossChainTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.ATTESTATION_PENDING,
          statusUpdatedAt: new Date(),
          attestationError: errorMessage,
          attestationPollAttempts: {
            increment: 1,
          },
        },
      });

      this.logger.log(
        `[State] Transfer ${transferId} → ATTESTATION_PENDING (will retry)`
      );

      await this.createTransferLog(
        transferId,
        'attestation',
        `Attestation polling timeout. Will retry. Error: ${errorMessage}`,
        TransferStatus.ATTESTATION_PENDING,
        {},
        errorMessage,
      );
    } catch (error) {
      this.logger.error(
        `Failed to mark attestation pending: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Mark mint as PENDING (will be retried)
   * 
   * CALLED WHEN:
   * - Mint transaction fails temporarily (RPC timeout, gas spike)
   * - BullMQ will retry later
   * 
   * @param transferId Transfer record ID
   * @param errorMessage Error from mint attempt
   */
  async markMintPending(
    transferId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await prisma.crossChainTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.MINT_PENDING,
          statusUpdatedAt: new Date(),
          mintError: errorMessage,
          mintAttempts: {
            increment: 1,
          },
        },
      });

      this.logger.log(
        `[State] Transfer ${transferId} → MINT_PENDING (will retry)`
      );

      await this.createTransferLog(
        transferId,
        'mint',
        `Mint failed temporarily. Will retry. Error: ${errorMessage}`,
        TransferStatus.MINT_PENDING,
        {},
        errorMessage,
      );
    } catch (error) {
      this.logger.error(`Failed to mark mint pending: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get current transfer state
   * 
   * USAGE:
   * - Check if transfer already processed
   * - Verify we're at expected state before proceeding
   * - Debugging
   * 
   * @param transferId Transfer record ID
   * @returns Current transfer record
   */
  async getTransferState(transferId: string): Promise<any> {
    return prisma.crossChainTransfer.findUnique({
      where: { id: transferId },
    });
  }

  /**
   * Get transfer history (audit trail)
   * 
   * USAGE:
   * - Show user complete timeline
   * - Debugging (what happened at each stage)
   * - Monitoring (track bottlenecks)
   * 
   * @param transferId Transfer record ID
   * @returns Sorted list of all state changes
   */
  async getTransferHistory(transferId: string): Promise<any[]> {
    return prisma.transferLog.findMany({
      where: { transferId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Create audit log entry
   * 
   * INSERTED FOR EVERY:
   * - Status change
   * - Error occurrence
   * - Significant event
   * 
   * IMMUTABLE:
   * - Never updated, only inserted
   * - Complete history preserved
   * - Can rebuild state from logs if DB corrupted
   * 
   * @param transferId Transfer record ID
   * @param phase Workflow phase
   * @param action What happened
   * @param status Resulting state
   * @param metadata Additional context (JSON)
   * @param errorMessage Error if failed
   */
  private async createTransferLog(
    transferId: string,
    phase: string,
    action: string,
    status: TransferStatus,
    metadata: any = {},
    errorMessage?: string,
  ): Promise<void> {
    try {
      await prisma.transferLog.create({
        data: {
          transferId,
          phase,
          action,
          status: status.toString(),
          message: action,
          metadata,
          errorMessage: errorMessage || undefined,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to create transfer log: ${error instanceof Error ? error.message : String(error)}`);
      // Don't throw - logging is non-critical
    }
  }

  /**
   * Get transfers stuck in a state for too long
   * 
   * USAGE:
   * - Monitoring alerts (transfer taking too long)
   * - Auto-retry mechanism
   * - SLA tracking
   * 
   * @param status Status to check
   * @param durationMinutes How long before considered stuck
   * @returns Transfers in that state longer than duration
   */
  async getStuckTransfers(
    status: TransferStatus,
    durationMinutes: number = 30,
  ): Promise<any[]> {
    const cutoffTime = new Date(Date.now() - durationMinutes * 60 * 1000);

    return prisma.crossChainTransfer.findMany({
      where: {
        status,
        statusUpdatedAt: {
          lt: cutoffTime,
        },
      },
      orderBy: { statusUpdatedAt: 'asc' },
    });
  }
}
