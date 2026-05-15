import { Module } from '@nestjs/common';
import { TransferStateService } from './transfer-state.service';

@Module({
  providers: [TransferStateService],
  exports: [TransferStateService],
})
export class TransfersModule {}
