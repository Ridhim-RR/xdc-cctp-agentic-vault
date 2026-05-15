import { Module } from '@nestjs/common';
import { CctpBurnService } from './burn.service';
import { CircleIrisAttestationService } from './attestation.service';
import { CctpMintService } from './mint.service';
import { CctpOrchestratorService } from './cctp-orchestrator.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [BlockchainModule, TransfersModule],
  providers: [CctpBurnService, CircleIrisAttestationService, CctpMintService, CctpOrchestratorService],
  exports: [CctpOrchestratorService],
})
export class CctpModule {}
