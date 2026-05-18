import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { GizaAdapterService } from './giza-adapter.service';
import { GizaPortfolioState } from './giza.types';

const prisma = new PrismaClient();

@Injectable()
export class GizaPortfolioService {
  private readonly logger = new Logger(GizaPortfolioService.name);

  constructor(private readonly gizaAdapterService: GizaAdapterService) {}

  async syncPortfolioForTransfer(transferId: string): Promise<GizaPortfolioState> {
    const position = await prisma.agentPosition.findUnique({ where: { transferId } });

    if (!position) {
      throw new Error(`AgentPosition not found for transfer ${transferId}`);
    }

    const portfolio = await this.gizaAdapterService.fetchPortfolio(position.gizaAgentId);

    const updated = await prisma.agentPosition.update({
      where: { transferId },
      data: {
        currentPortfolioValue: portfolio.totalValue,
        status: 'SYNCED',
        metadata: {
          portfolio: portfolio.raw as unknown as Prisma.InputJsonValue,
          portfolioStatus: portfolio.status,
        } as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
    });

    this.logger.log(`[Giza] Portfolio sync persisted for transfer=${transferId}`);

    return {
      transferId: updated.transferId,
      userId: updated.userId,
      gizaAgentId: updated.gizaAgentId,
      principalAmount: updated.principalAmount,
      currentPortfolioValue: updated.currentPortfolioValue,
      status: updated.status,
      sourceChain: updated.sourceChain,
      destinationChain: updated.destinationChain,
      lastSyncedAt: updated.lastSyncedAt,
      metadata: updated.metadata,
    };
  }

  async getPortfolioStateForTransfer(transferId: string): Promise<GizaPortfolioState | null> {
    const position = await prisma.agentPosition.findUnique({ where: { transferId } });

    if (!position) {
      return null;
    }

    return {
      transferId: position.transferId,
      userId: position.userId,
      gizaAgentId: position.gizaAgentId,
      principalAmount: position.principalAmount,
      currentPortfolioValue: position.currentPortfolioValue,
      status: position.status,
      sourceChain: position.sourceChain,
      destinationChain: position.destinationChain,
      lastSyncedAt: position.lastSyncedAt,
      metadata: position.metadata,
    };
  }
}
