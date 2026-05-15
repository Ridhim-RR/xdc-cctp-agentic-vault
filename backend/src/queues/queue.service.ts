import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisConnection = new IORedis(REDIS_URL);

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly burnQueue: Queue;

  constructor() {
    this.burnQueue = new Queue('burn_jobs', {
      connection: redisConnection,
    });
    this.logger.log(`[Queue] Connected to Redis at ${REDIS_URL}`);
  }

  async addBurnJob(transferId: string, amount: string, recipient: string) {
    this.logger.log(`[Queue] Enqueuing burn job for transfer ${transferId}`);
    return this.burnQueue.add(
      'burn',
      { transferId, amount, recipient },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }

  async close() {
    await this.burnQueue.close();
  }
}
