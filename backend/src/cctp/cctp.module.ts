import { Module } from '@nestjs/common';
import { CctpBurnService } from './burn.service';
import { CircleIrisAttestationService } from './attestation.service';
import { CctpMintService } from './mint.service';
import { CctpOrchestratorService } from './cctp-orchestrator.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { TransfersModule } from '../transfers/transfers.module';
import { GizaModule } from '../giza/giza.module';

@Module({
  imports: [BlockchainModule, TransfersModule, GizaModule],
  providers: [CctpBurnService, CircleIrisAttestationService, CctpMintService, CctpOrchestratorService],
  exports: [CctpOrchestratorService],
})
export class CctpModule {}
