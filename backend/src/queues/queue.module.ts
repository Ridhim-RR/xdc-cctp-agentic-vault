import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { BurnJobProcessor } from './burn.processor';
import { CctpModule } from '../cctp/cctp.module';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [CctpModule, TransfersModule],
  providers: [QueueService, BurnJobProcessor],
  exports: [QueueService],
})
export class QueueModule {}
