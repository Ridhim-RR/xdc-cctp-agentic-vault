/**
 * CCTP ORCHESTRATOR SERVICE
 * 
 * RESPONSIBILITY:
 * Orchestrate entire CCTP workflow
 * Manage state transitions
 * Coordinate between burn, attestation, and mint services
 * 
 * WHY THIS SERVICE EXISTS:
 * - Single point of coordination for complex multi-step workflow
 * - Implements state machine logic
 * - Handles transitions between phases
 * - Logs every step for debugging and auditing
 * 
 * ARCHITECTURE PATTERN:
 * Orchestrator = Conductor
 * Burn Service = Musician (does one job)
 * Attestation Service = Musician (does one job)
 * Mint Service = Musician (does one job)
 * Orchestrator coordinates all of them
 * 
 * WHY ORCHESTRATOR PATTERN:
 * - If burn fails, orchestrator knows not to continue
 * - If attestation times out, orchestrator retries or fails
 * - State machine lives in orchestrator
 * - Other services focused on single task
 */

import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { TransferStatus } from '@prisma/client';
import { CctpBurnService } from './burn.service';
import { CircleIrisAttestationService } from './attestation.service';
import { CctpMintService } from './mint.service';
import { TransferStateService } from '../transfers/transfer-state.service';
import { BlockchainSignerService } from '../blockchain/signer.service';
import { GizaAgentService } from '../giza/giza-agent.service';

/**
 * Complete CCTP operation result
 */
interface CctpOperationResult {
  success: boolean;
  transferId: string;
  approvalTxHash?: string;
  xdcBurnTxHash?: string;
  messageHash?: string;
  messageBytes?: string;
  attestation?: string;
  arbMintTxHash?: string;
  totalTimeSeconds: number;
  failureReason?: string;
  failurePhase?: string; // "burn" | "attestation" | "mint"
}

interface BurnPhaseData {
  txHash: string;
  blockNumber: number;
  messageHash: string;
  messageBytes: string;
}

interface AttestationPhaseData {
  message: string;
  attestation: string;
}

interface MintPhaseData {
  txHash: string;
  blockNumber: number;
  mintedAmount: string;
}

@Injectable()
export class CctpOrchestratorService {
  private readonly logger = new Logger(CctpOrchestratorService.name);

  constructor(
    private readonly burnService: CctpBurnService,
    private readonly attestationService: CircleIrisAttestationService,
    private readonly mintService: CctpMintService,
    private readonly transferStateService: TransferStateService,
    private readonly signerService: BlockchainSignerService,
    private readonly gizaAgentService: GizaAgentService,
  ) {}

  async executeBurnOnly(
    transferId: string,
    amount: string,
  ): Promise<CctpOperationResult> {
    const startTime = Date.now();
    this.logger.log(`[CCTP] Starting burn-only workflow for transfer ${transferId}`);

    try {
      await this.transferStateService.markApprovalPending(transferId);

      const burnResult = await this.burnService.executeBurn(amount);

      if (burnResult.approvalTxHash) {
        await this.transferStateService.markApprovalConfirmed(transferId, burnResult.approvalTxHash);
      } else if (burnResult.approvalSkipped) {
        // Even when approval is skipped due to existing allowance, move state machine forward.
        await this.transferStateService.markApprovalConfirmed(transferId, 'skipped-existing-allowance');
      }

      await this.transferStateService.markBurnPending(transferId);

      await this.transferStateService.updateBurnConfirmed(
        transferId,
        burnResult.txHash,
        burnResult.blockNumber,
        burnResult.messageHash,
        burnResult.messageBytes,
      );

      await this.transferStateService.markMessageExtracted(
        transferId,
        burnResult.messageHash,
      );

      await this.transferStateService.upsertCctpBurnRecord({
        transferId,
        destinationDomain: burnResult.destinationDomain,
        burnTokenAddress: burnResult.burnTokenAddress,
        tokenMessengerAddress: burnResult.tokenMessengerAddress,
        bridgeWalletAddress: burnResult.bridgeWalletAddress,
        amount,
        status: TransferStatus.MESSAGE_EXTRACTED,
        approvalTxHash: burnResult.approvalTxHash,
        burnTxHash: burnResult.txHash,
        burnBlockNumber: burnResult.blockNumber,
        messageBytes: burnResult.messageBytes,
        messageHash: burnResult.messageHash,
        bridgeWalletPreBurnBalance: burnResult.preBurnBalance,
        bridgeWalletPostBurnBalance: burnResult.postBurnBalance,
        incrementAttempts: true,
      });

      return {
        success: true,
        transferId,
        approvalTxHash: burnResult.approvalTxHash,
        xdcBurnTxHash: burnResult.txHash,
        messageHash: burnResult.messageHash,
        messageBytes: burnResult.messageBytes,
        totalTimeSeconds: (Date.now() - startTime) / 1000,
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      const fallbackBridgeWallet = (() => {
        try {
          const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
          if (!privateKey) return '0x0000000000000000000000000000000000000000';
          return new ethers.Wallet(privateKey).address;
        } catch {
          return '0x0000000000000000000000000000000000000000';
        }
      })();

      await this.transferStateService.upsertCctpBurnRecord({
        transferId,
        destinationDomain: Number.parseInt(process.env.ARB_DOMAIN_ID || '3', 10),
        burnTokenAddress: process.env.USDC_ADDRESS || process.env.USDC_ADDRESS_XDC || '',
        tokenMessengerAddress: process.env.TOKENM_ADDRESS_XDC || '',
        bridgeWalletAddress: fallbackBridgeWallet,
        amount,
        status: TransferStatus.BURN_PENDING,
        errorMessage: failure,
        incrementAttempts: true,
      });

      await this.transferStateService.markTransferFailed(transferId, 'burn', failure);

      return {
        success: false,
        transferId,
        totalTimeSeconds: (Date.now() - startTime) / 1000,
        failureReason: failure,
        failurePhase: 'burn',
      };
    }
  }

  /**
   * Execute complete CCTP workflow
   * 
   * FLOW:
   * Phase 1: BURN
   *   - depositForBurn() on XDC
   *   - Extract message bytes and hash
   *   - Update state: BURN_CONFIRMED
   * 
   * Phase 2: ATTESTATION (Polling)
   *   - Poll Circle IRIS API for attestation
   *   - Exponential backoff retry
   *   - Update state: ATTESTATION_RECEIVED
   * 
   * Phase 3: MINT
   *   - receiveMessage() on Arbitrum
   *   - Verify USDC balance increased
   *   - Update state: TRANSFER_COMPLETED
   * 
   * ERROR HANDLING:
   * - If burn fails: fail transfer, no retry
   * - If attestation times out: retry queue (BullMQ)
   * - If mint fails: retry queue
   * 
   * @param transferId Database transfer record ID
   * @param amount USDC to transfer (in wei)
   * @param recipientAddress Recipient on Arbitrum
   * @returns CctpOperationResult with status
   */
  async executeCompleteWorkflow(
    transferId: string,
    amount: string,
    // recipientAddress is optional: if omitted, the signer's Arbitrum wallet is used.
    // The burn phase encodes the signer address as the mint recipient, so this value
    // is only needed for post-mint balance verification — not for minting itself.
    recipientAddress?: string,
  ): Promise<CctpOperationResult> {
    const startTime = Date.now();

    this.logger.log(
      `[CCTP] Starting complete workflow for transfer ${transferId}`
    );

    try {
      const burnPhase = await this.executeBurnPhase(transferId, amount, startTime);
      if (!burnPhase.success) {
        return burnPhase.result;
      }

      const attestationPhase = await this.executeAttestationPhase(
        transferId,
        burnPhase.data.messageHash,
        burnPhase.data.txHash,
        burnPhase.data.messageBytes,
        startTime,
      );
      if (!attestationPhase.success) {
        return attestationPhase.result;
      }

      // Derive recipient for balance verification: prefer explicit arg, fall back to signer wallet
      const mintRecipient = recipientAddress ?? this.signerService.getXdcSigner().address;

      const mintPhase = await this.executeMintPhase(
        transferId,
        amount,
        mintRecipient,
        burnPhase.data,
        attestationPhase.data,
        startTime,
      );
      if (!mintPhase.success) {
        return mintPhase.result;
      }

      const totalTime = (Date.now() - startTime) / 1000;
      this.logger.log(`[CCTP] 🎉 WORKFLOW COMPLETE in ${totalTime.toFixed(1)}s`);

      return {
        success: true,
        transferId,
        xdcBurnTxHash: burnPhase.data.txHash,
        messageHash: burnPhase.data.messageHash,
        attestation: attestationPhase.data.attestation,
        arbMintTxHash: mintPhase.data.txHash,
        totalTimeSeconds: totalTime,
      };
    } catch (error) {
      const totalTime = (Date.now() - startTime) / 1000;

      this.logger.error(
        `[CCTP] Unexpected error in workflow: ${error instanceof Error ? error.message : String(error)}`
      );

      return {
        success: false,
        transferId,
        totalTimeSeconds: totalTime,
        failureReason: error instanceof Error ? error.message : String(error),
        failurePhase: 'unknown',
      };
    }
  }

  private async executeBurnPhase(
    transferId: string,
    amount: string,
    startTime: number,
  ): Promise<{ success: true; data: BurnPhaseData } | { success: false; result: CctpOperationResult }> {
    try {
      this.logger.log('[CCTP] Phase 1: BURN - Burning USDC on XDC');
      const burnResult = await this.burnService.executeBurn(amount);

      this.logger.log(
        `[CCTP] Phase 1 ✅ Complete. TxHash: ${burnResult.txHash}, MessageHash: ${burnResult.messageHash.substring(0, 10)}...`
      );

      await this.transferStateService.updateBurnConfirmed(
        transferId,
        burnResult.txHash,
        burnResult.blockNumber,
        burnResult.messageHash,
        burnResult.messageBytes,
      );

      return {
        success: true,
        data: {
          txHash: burnResult.txHash,
          blockNumber: burnResult.blockNumber,
          messageHash: burnResult.messageHash,
          messageBytes: burnResult.messageBytes,
        },
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.logger.error(`[CCTP] Phase 1 ❌ Burn failed: ${failure}`);

      await this.transferStateService.markTransferFailed(transferId, 'burn', failure);

      return {
        success: false,
        result: {
          success: false,
          transferId,
          totalTimeSeconds: (Date.now() - startTime) / 1000,
          failureReason: failure,
          failurePhase: 'burn',
        },
      };
    }
  }

  private async executeAttestationPhase(
    transferId: string,
    messageHash: string,
    burnTxHash: string,
    messageBytes: string,
    startTime: number,
  ): Promise<{ success: true; data: AttestationPhaseData } | { success: false; result: CctpOperationResult }> {
    try {
      this.logger.log('[CCTP] Phase 2: ATTESTATION - Polling Circle for proof');

      const attestationResult = await this.attestationService.pollForAttestation(
        messageHash,
        Number.parseInt(process.env.ATTESTATION_MAX_RETRIES || '100', 10),
        {
          burnTxHash,
          sourceDomainId: Number.parseInt(process.env.XDC_SOURCE_DOMAIN_ID || '18', 10),
          messageBytes,
        },
      );

      this.logger.log(
        `[CCTP] Phase 2 ✅ Complete. Attestation received after ${attestationResult.attempts} attempts`
      );

      await this.transferStateService.updateAttestationReceived(
        transferId,
        attestationResult.attestation,
      );

      if (!attestationResult.message) {
        throw new Error('Attestation result missing IRIS message payload');
      }

      return {
        success: true,
        data: {
          message: attestationResult.message,
          attestation: attestationResult.attestation,
        },
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.logger.error(`[CCTP] Phase 2 ❌ Attestation failed: ${failure}`);

      await this.transferStateService.markAttestationPending(transferId, failure);

      return {
        success: false,
        result: {
          success: false,
          transferId,
          xdcBurnTxHash: burnTxHash,
          messageHash,
          totalTimeSeconds: (Date.now() - startTime) / 1000,
          failureReason: failure,
          failurePhase: 'attestation',
        },
      };
    }
  }

  private async executeMintPhase(
    transferId: string,
    amount: string,
    recipientAddress: string,
    burn: BurnPhaseData,
    attestation: AttestationPhaseData,
    startTime: number,
  ): Promise<{ success: true; data: MintPhaseData } | { success: false; result: CctpOperationResult }> {
    try {
      this.logger.log('[CCTP] Phase 3: MINT - Minting USDC on Arbitrum');
      this.logger.log(`[CCTP] Phase 3: mint message length=${attestation.message.length}`);
      this.logger.log(`[CCTP] Phase 3: mint message payload=${attestation.message}`);

      const mintResult = await this.mintService.executeMint(
        attestation.message,
        attestation.attestation,
        recipientAddress,
        amount,
      );

      this.logger.log(
        `[CCTP] Phase 3 ✅ Complete. TxHash: ${mintResult.txHash}, Minted: ${mintResult.mintedAmount}`
      );

      await this.transferStateService.markTransferCompleted(
        transferId,
        mintResult.txHash,
        mintResult.blockNumber,
      );

      await this.initializeGizaPosition({
        transferId,
        mintedAmount: mintResult.mintedAmount,
        mintTxHash: mintResult.txHash,
        recipientAddress,
      });

      return {
        success: true,
        data: {
          txHash: mintResult.txHash,
          blockNumber: mintResult.blockNumber,
          mintedAmount: mintResult.mintedAmount,
        },
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.logger.error(`[CCTP] Phase 3 ❌ Mint failed: ${failure}`);

      await this.transferStateService.markMintPending(transferId, failure);

      return {
        success: false,
        result: {
          success: false,
          transferId,
          xdcBurnTxHash: burn.txHash,
          messageHash: burn.messageHash,
          attestation: attestation.attestation,
          totalTimeSeconds: (Date.now() - startTime) / 1000,
          failureReason: failure,
          failurePhase: 'mint',
        },
      };
    }
  }

  /**
   * Resume failed mint operation
   * 
   * WHY NEEDED:
   * If mint failed due to temporary issue (RPC timeout, gas spike)
   * Backend can retry without re-burning or re-polling
   * Uses same message bytes and attestation
   * 
   * USAGE:
   * User's transfer is in MINT_PENDING state for 30+ minutes
   * Backend detects old pending mint
   * Retries receiveMessage() with same proof
   * 
   * IDEMPOTENCY:
   * MessageTransmitter prevents double-minting
   * If already executed: transaction fails but we can detect it
   * 
   * @param transferId Transfer record ID
   * @param messageBytes Original message bytes
   * @param attestation Original attestation proof
   * @param recipientAddress Recipient wallet
   * @param expectedAmount Expected mint amount
   * @returns MintResult or error
   */
  async resumeMint(
    transferId: string,
    messageBytes: string,
    attestation: string,
    recipientAddress: string,
    expectedAmount: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    this.logger.log(
      `[CCTP] Resuming failed mint for transfer ${transferId}`
    );

    try {
      // Check if already executed
      const messageHash = this.calculateMessageHash(messageBytes);
      const alreadyExecuted = await this.mintService.isMessageAlreadyExecuted(
        messageHash
      );

      if (alreadyExecuted) {
        this.logger.log(
          `[CCTP] Mint already executed successfully. Marking transfer complete.`
        );

        // Transfer is complete, update state
        await this.transferStateService.markTransferCompleted(
          transferId,
          messageHash, // Use hash as proxy since we don't have real tx hash
          0, // Block number unknown
        );

        await this.initializeGizaPosition({
          transferId,
          mintedAmount: expectedAmount,
          mintTxHash: messageHash,
          recipientAddress,
        });

        return { success: true };
      }

      // Retry mint
      const mintResult = await this.mintService.executeMint(
        messageBytes,
        attestation,
        recipientAddress,
        expectedAmount,
      );

      // Update transfer state
      await this.transferStateService.markTransferCompleted(
        transferId,
        mintResult.txHash,
        mintResult.blockNumber,
      );

      await this.initializeGizaPosition({
        transferId,
        mintedAmount: mintResult.mintedAmount,
        mintTxHash: mintResult.txHash,
        recipientAddress,
      });

      return { success: true, txHash: mintResult.txHash };
    } catch (error) {
      this.logger.error(`[CCTP] Mint resume failed: ${error instanceof Error ? error.message : String(error)}`);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Resume failed attestation polling
   * 
   * WHY NEEDED:
   * If attestation polling timed out after 100 attempts
   * Can resume polling from current state
   * Maybe Circle IRIS is now responsive
   * 
   * @param transferId Transfer record ID
   * @param messageHash Message hash to poll
   * @returns AttestationResult
   */
  async resumeAttestationPolling(
    transferId: string,
    messageHash: string,
  ): Promise<{ success: boolean; attestation?: string; error?: string }> {
    this.logger.log(
      `[CCTP] Resuming attestation polling for transfer ${transferId}`
    );

    try {
      const attestationResult = await this.attestationService.pollForAttestation(
        messageHash,
        Number.parseInt(process.env.ATTESTATION_MAX_RETRIES || '100', 10),
      );

      // Update transfer state
      await this.transferStateService.updateAttestationReceived(
        transferId,
        attestationResult.attestation,
      );

      return { success: true, attestation: attestationResult.attestation };
    } catch (error) {
      this.logger.error(
        `[CCTP] Attestation resume failed: ${error instanceof Error ? error.message : String(error)}`
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Calculate message hash from message bytes
   * 
   * MESSAGE HASH = Keccak256(messageBytes)
   * Used as unique identifier for attestation polling
   * 
   * @param messageBytes Raw message bytes
   * @returns Keccak256 hash as hex string
   */
  private calculateMessageHash(messageBytes: string): string {
    const { ethers } = require('ethers');
    return ethers.keccak256(messageBytes);
  }

  private async initializeGizaPosition(params: {
    transferId: string;
    mintedAmount: string;
    mintTxHash: string;
    recipientAddress: string;
  }): Promise<void> {
    try {
      this.logger.log(`[Giza] initializeGizaPosition start for transfer ${params.transferId}`);

      const result = await this.gizaAgentService.initializeGizaPosition({
        transferId: params.transferId,
        mintedAmount: params.mintedAmount,
        mintTxHash: params.mintTxHash,
        recipientAddress: params.recipientAddress,
      });

      this.logger.log(
        `[Giza] initializeGizaPosition success for transfer ${params.transferId}. agent=${result.gizaAgentId}, value=${result.currentPortfolioValue}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Giza] initializeGizaPosition failed for transfer ${params.transferId}: ${reason}`);

      try {
        await this.gizaAgentService.markFailedInitialization(params.transferId, reason);
      } catch (persistError) {
        this.logger.error(
          `[Giza] Failed to persist initialization error for transfer ${params.transferId}: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
        );
      }
    }
  }
}
