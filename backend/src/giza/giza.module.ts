import { Module } from '@nestjs/common';
import { AgentService } from './services/agent.service';
import { GizaService } from './services/giza.service';
import { PortfolioService } from './services/portfolio.service';
import { YieldIndexerService } from './services/yield-indexer.service';
import { WithdrawService } from './services/withdraw.service';
import { GizaRepository } from './repositories/giza.repository';

@Module({
  providers: [
    GizaService,
    AgentService,
    PortfolioService,
    YieldIndexerService,
    WithdrawService,
    GizaRepository,
  ],
  exports: [GizaService, AgentService, PortfolioService, YieldIndexerService, WithdrawService, GizaRepository],
})
export class GizaModule {}