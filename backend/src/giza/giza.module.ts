import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AgentService } from './services/agent.service';
import { GizaService } from './services/giza.service';
import { PortfolioService } from './services/portfolio.service';
import { YieldIndexerService } from './services/yield-indexer.service';
import { WithdrawService } from './services/withdraw.service';
import { GizaRepository } from './repositories/giza.repository';
import { GizaAdapterService } from './giza-adapter.service';
import { GizaAgentService } from './giza-agent.service';
import { GizaPortfolioService } from './giza-portfolio.service';

@Module({
  imports: [BlockchainModule],
  providers: [
    GizaService,
    AgentService,
    PortfolioService,
    YieldIndexerService,
    WithdrawService,
    GizaRepository,
    GizaAdapterService,
    GizaAgentService,
    GizaPortfolioService,
  ],
  exports: [
    GizaService,
    AgentService,
    PortfolioService,
    YieldIndexerService,
    WithdrawService,
    GizaRepository,
    GizaAdapterService,
    GizaAgentService,
    GizaPortfolioService,
  ],
})
export class GizaModule {}