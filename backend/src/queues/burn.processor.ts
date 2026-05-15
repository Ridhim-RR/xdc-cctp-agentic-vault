import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { CctpOrchestratorService } from '../cctp/cctp-orchestrator.service';
import { TransferStateService } from '../transfers/transfer-state.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisConnection = new IORedis(REDIS_URL);

@Injectable()
export class BurnJobProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BurnJobProcessor.name);
  private worker: Worker | null = null;

  constructor(
    private readonly orchestrator: CctpOrchestratorService,
    private readonly transferStateService: TransferStateService,
  ) {}

  onModuleInit() {
    this.logger.log('[Queue] Starting burn jobs worker...');

    this.worker = new Worker(
      'burn_jobs',
      async (job) => {
        this.logger.log(`[Worker] Processing burn job ${job.id} (transfer=${job.data.transferId})`);
        const { transferId, amount, recipient } = job.data;

        try {
          // Orchestrator handles burn → attest → mint for now
          await this.orchestrator.executeCompleteWorkflow(transferId, amount, recipient);
          this.logger.log(`[Worker] Burn job completed for transfer ${transferId}`);
        } catch (err: any) {
          this.logger.error(`[Worker] Burn job failed for transfer ${transferId}: ${err instanceof Error ? err.message : String(err)}`);
          // Mark transfer failed to escalate; orchestrator may also do this
          try {
            await this.transferStateService.markTransferFailed(transferId, 'burn', err instanceof Error ? err.message : 'unknown');
          } catch (e) {
            this.logger.warn(`[Worker] Failed to mark transfer failed: ${e instanceof Error ? e.message : String(e)}`);
          }
          throw err;
        }
      },
      { connection: redisConnection, concurrency: 2 }
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`[Worker] Job ${job.id} failed: ${err.message}`);
    });

    this.worker.on('completed', (job) => {
      this.logger.log(`[Worker] Job ${job.id} completed`);
    });
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('[Queue] Burn worker stopped');
    }
  }
}
