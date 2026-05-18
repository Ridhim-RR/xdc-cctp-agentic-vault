/**
 * listeners/deposit-events.listener.ts
 *
 * The core event listener service for detecting and ingesting Deposited events.
 *
 * How It Works:
 * =============
 * 1. Connects to the vault contract
 * 2. Queries past events (from last known block to current)
 * 3. Stores them in the database
 * 4. Listens for new events in real-time
 * 5. Handles disconnections and restarts
 *
 * Why Off-Chain Indexing?
 * =======================
 * On-chain, events are stored in the blockchain's history but are not easily queryable.
 * Running an indexer (listener) allows us to:
 * - Query deposits by wallet address (fast)
 * - Calculate aggregates (total deposits)
 * - Provide REST APIs to users
 * - Alert on new deposits
 * - Analyze patterns
 *
 * The database is NOT the source of truth.
 * The blockchain is. We mirror it for query efficiency.
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes } from 'ethers';
import { TransferStatus } from '@prisma/client';
import { DepositsService } from '../services/deposits.service';
import { getProvider, getVaultContract } from '../blockchain';
import { TransferStateService } from '../transfers/transfer-state.service';
import { VaultBridgeService } from '../vault/vault-bridge.service';
import { CctpOrchestratorService } from '../cctp/cctp-orchestrator.service';

@Injectable()
export class DepositEventsListener implements OnModuleInit, OnModuleDestroy {
  private provider: JsonRpcProvider | null = null;
  private vaultContract: Contract | null = null;
  private isListening = false;
  private lastProcessedBlock: bigint | null = null;

  // Polling interval (in milliseconds) for checking new blocks
  private readonly POLL_INTERVAL = 12000; // 12 seconds (average XDC block time)

  // Short delay while catching up historical backlog
  private readonly CATCH_UP_DELAY = 250;

  // How many blocks to process at a time
  private readonly BLOCK_BATCH_SIZE = 1000;

  // Blocks to look back from current when starting fresh
  private readonly LOOKBACK_BLOCKS = 1000;

  constructor(
    private readonly depositsService: DepositsService,
    private readonly transferStateService: TransferStateService,
    private readonly vaultBridgeService: VaultBridgeService,
    private readonly cctpOrchestrator: CctpOrchestratorService,
  ) {}

  /**
   * Initialize the listener when the module starts.
   * Called automatically by NestJS.
   */
  async onModuleInit() {
    try {
      console.log('[Listener] Initializing deposit events listener...');
      void this.start();
    } catch (error) {
      console.error('[Listener] Failed to initialize:', error);
      // Don't throw; let the app start anyway
      // The listener can be restarted later
    }
  }

  /**
   * Cleanup when the module shuts down.
   * Called automatically by NestJS.
   */
  async onModuleDestroy() {
    console.log('[Listener] Cleaning up...');
    this.isListening = false;
    if (this.provider) {
      this.provider.removeAllListeners();
    }
  }

  /**
   * Start the event listener.
   * This does:
   * 1. Connect to the blockchain
   * 2. Get the last processed block
   * 3. Replay historical events
   * 4. Start polling for new events
   */
  async start() {
    const rpcUrl = process.env.XDC_TESTNET_RPC || 'https://51.rpc.thirdweb.com';
    const vaultAddress = process.env.VAULT_ADDRESS;

    if (!vaultAddress) {
      throw new Error('VAULT_ADDRESS not set in environment');
    }

    console.log('[Listener] Connecting to XDC testnet...');
    console.log(`[Listener] RPC URL: ${rpcUrl}`);
    console.log(`[Listener] Vault address: ${vaultAddress}`);
    this.provider = getProvider(rpcUrl);
    this.vaultContract = getVaultContract(this.provider, vaultAddress);

    // Get the last block we processed
    this.lastProcessedBlock = await this.depositsService.getLastProcessedBlock();

    console.log(
      `[Listener] Last processed block: ${this.lastProcessedBlock?.toString() || 'none'}`
    );

    this.isListening = true;

    // Start polling for new blocks
    void this.pollForNewEvents();
  }

  /**
   * Poll for new events continuously.
   * This runs in a loop and checks for new events periodically.
   */
  private async pollForNewEvents() {
    while (this.isListening) {
      try {
        const caughtUp = await this.processNewEvents();
        await this.sleep(caughtUp ? this.POLL_INTERVAL : this.CATCH_UP_DELAY);
      } catch (error) {
        console.error('[Listener] Error processing events:', error);
        // Don't crash; wait and retry
        await this.sleep(this.POLL_INTERVAL);
      }
    }
  }

  /**
   * Check for new Deposited events and store them.
   */
  private async processNewEvents(): Promise<boolean> {
    if (!this.provider || !this.vaultContract) {
      return true;
    }

    try {
      const currentBlock = await this.provider.getBlockNumber();

      const blockWindow = this.getBlockWindow(currentBlock);
      if (!blockWindow) {
        return true;
      }
      const { fromBlock, toBlock } = blockWindow;

      console.log(`[Listener] Querying events from block ${fromBlock} to ${toBlock}`);

      const events = await this.getDepositedLogs(fromBlock, toBlock);
      console.log(`[Listener] Found ${events.length} Deposited events`);

      for (const log of events) {
        const parsed = this.parseDepositedLog(log);
        if (!parsed) {
          continue;
        }

        const { user, amount } = parsed;
        try {
          await this.processNewDepositEvent(log, user, amount);
        } catch (error: unknown) {
          if (this.isDuplicateDepositError(error)) {
            await this.processDuplicateDepositEvent(log, user, amount);
          } else {
            console.error('[Listener] Error processing event:', error);
          }
        }
      }

      // Update last processed block
      this.lastProcessedBlock = BigInt(toBlock);
      return toBlock >= currentBlock;
    } catch (error) {
      console.error('[Listener] Error in processNewEvents:', error);
      return true;
    }
  }

  private getBlockWindow(currentBlock: number): { fromBlock: number; toBlock: number } | null {
    const fromBlock =
      this.lastProcessedBlock === null
        ? Math.max(0, currentBlock - this.LOOKBACK_BLOCKS)
        : Number(this.lastProcessedBlock) + 1;

    if (this.lastProcessedBlock === null) {
      console.log(`[Listener] First run, looking back ${this.LOOKBACK_BLOCKS} blocks`);
    }

    const toBlock = Math.min(fromBlock + this.BLOCK_BATCH_SIZE - 1, currentBlock);
    if (fromBlock > toBlock) {
      return null;
    }

    return { fromBlock, toBlock };
  }

  private async getDepositedLogs(fromBlock: number, toBlock: number) {
    if (!this.provider || !this.vaultContract) {
      return [];
    }

    const eventTopic = keccak256(toUtf8Bytes('Deposited(address,uint256)'));
    const vaultAddress = await this.vaultContract.getAddress();
    return this.provider.getLogs({
      address: vaultAddress,
      topics: [eventTopic],
      fromBlock,
      toBlock,
    });
  }

  private parseDepositedLog(log: any): { user: string; amount: bigint } | null {
    if (!this.vaultContract) {
      return null;
    }

    const decoded = this.vaultContract.interface.parseLog(log);
    if (decoded?.name !== 'Deposited') {
      return null;
    }

    return {
      user: decoded.args[0] as string,
      amount: decoded.args[1] as bigint,
    };
  }

  private async processNewDepositEvent(log: any, user: string, amount: bigint): Promise<void> {
    const deposit = await this.depositsService.createDeposit({
      walletAddress: user,
      amount,
      txHash: log.transactionHash,
      blockNumber: BigInt(log.blockNumber),
    });

    console.log(`[Listener] Stored deposit: ${user} deposited ${amount.toString()} units (tx: ${log.transactionHash})`);

    const transfer = await this.transferStateService.createTransferFromDeposit({
      depositId: deposit.id,
      recipientAddressArb: user,
      amount: amount.toString(),
    });

    console.log(`[Listener] CrossChainTransfer created: ${transfer.id}`);
    await this.runVaultToBridgeTransfer(transfer.id, amount, false);
    this.runBurnPhase(transfer.id, amount.toString(), false);
  }

  private async processDuplicateDepositEvent(log: any, user: string, amount: bigint): Promise<void> {
    console.log('[Listener] Duplicate deposit event detected. Attempting idempotent recovery.');

    const existingDeposit = await this.depositsService.getDepositByTxHash(log.transactionHash);
    if (!existingDeposit) {
      return;
    }

    let transfer = await this.transferStateService.getTransferByDepositId(existingDeposit.id);
    if (!transfer) {
      transfer = await this.transferStateService.createTransferFromDeposit({
        depositId: existingDeposit.id,
        recipientAddressArb: user,
        amount: amount.toString(),
      });
    }

    if (transfer.status === TransferStatus.VAULT_TO_BRIDGE_TRANSFER_CONFIRMED) {
      console.log(`[Listener] Recovery skipped. Transfer ${transfer.id} already confirmed.`);
    } else {
      await this.runVaultToBridgeTransfer(transfer.id, amount, true);
    }

    // Skip re-triggering if the workflow has already progressed past burn
    const workflowNotStarted =
      transfer.status !== TransferStatus.BURN_CONFIRMED &&
      transfer.status !== TransferStatus.MESSAGE_EXTRACTED &&
      transfer.status !== TransferStatus.ATTESTATION_PENDING &&
      transfer.status !== TransferStatus.ATTESTATION_RECEIVED &&
      transfer.status !== TransferStatus.MINT_PENDING &&
      transfer.status !== TransferStatus.MINT_CONFIRMED &&
      transfer.status !== TransferStatus.TRANSFER_COMPLETED;

    if (workflowNotStarted) {
      this.runBurnPhase(transfer.id, amount.toString(), true);
    }
  }

  private async runVaultToBridgeTransfer(transferId: string, amount: bigint, isRecovery: boolean): Promise<void> {
    const bridgeTransfer = await this.vaultBridgeService.transferAndVerify(amount, transferId);
    const label = isRecovery ? 'Recovery vault -> bridge transfer confirmed' : 'Vault -> Bridge transfer confirmed';

    console.log(
      `[Listener] ${label}: tx=${bridgeTransfer.txHash}, bridgeWallet=${bridgeTransfer.bridgeWallet}`
    );

    if (!isRecovery) {
      console.log(
        `[Listener] Phase complete for transfer ${transferId}: vault->bridge verified; starting full CCTP workflow (burn → attest → mint)`
      );
    }
  }

  private runBurnPhase(transferId: string, amount: string, isRecovery: boolean): void {
    const prefix = isRecovery ? 'Recovery CCTP workflow' : 'CCTP workflow';

    // Fire-and-forget: executeCompleteWorkflow covers burn → attestation → mint.
    // We deliberately do NOT await here because attestation polling can take 1-60 minutes
    // and blocking the 12-second polling loop would prevent new deposits from being processed.
    this.cctpOrchestrator.executeCompleteWorkflow(transferId, amount)
      .then((result) => {
        if (result.success) {
          console.log(
            `[Listener] ${prefix} complete for transfer ${transferId}: ` +
            `burnTx=${result.xdcBurnTxHash}, mintTx=${result.arbMintTxHash}`
          );
        } else {
          console.error(
            `[Listener] ${prefix} failed for transfer ${transferId} ` +
            `(phase=${result.failurePhase}): ${result.failureReason}`
          );
        }
      })
      .catch((err) => {
        console.error(
          `[Listener] Unexpected error in ${prefix} for transfer ${transferId}: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
      });
  }

  private isDuplicateDepositError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('Deposit already exists');
  }

  /**
   * Listen for real-time new events (alternative to polling).
   * This is more efficient than polling but requires WebSocket support.
   *
   * NOTE: This is an advanced feature. For Phase 1, polling is sufficient.
   */
  private async listenRealtime() {
    if (!this.vaultContract) {
      return;
    }

    console.log('[Listener] Starting real-time event listener...');

    // Listen for Deposited events as they happen
    this.vaultContract.on('Deposited', async (user: string, amount: bigint, event: any) => {
      console.log(`[Listener] Real-time event: ${user} deposited ${amount.toString()}`);

      try {
        const txHash = event?.log?.transactionHash;
        if (!txHash) {
          return;
        }
        const receipt = await this.provider?.getTransactionReceipt(txHash);
        if (receipt) {
          await this.depositsService.createDeposit({
            walletAddress: user,
            amount: amount,
            txHash: receipt.hash,
            blockNumber: BigInt(receipt.blockNumber),
          });
        }
      } catch (error) {
        console.error('[Listener] Error storing real-time event:', error);
      }
    });
  }

  /**
   * Stop the listener.
   */
  stop() {
    console.log('[Listener] Stopping...');
    this.isListening = false;
    if (this.vaultContract) {
      this.vaultContract.removeAllListeners();
    }
  }

  /**
   * Sleep for a given number of milliseconds.
   * Used to implement polling intervals.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get listener status.
   */
  getStatus() {
    return {
      isListening: this.isListening,
      lastProcessedBlock: this.lastProcessedBlock?.toString() || 'none',
      rpcConnected: !!this.provider
    };
  }
}
