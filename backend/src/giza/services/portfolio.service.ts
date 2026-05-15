import { Injectable } from '@nestjs/common';
import { GizaRepository } from '../repositories/giza.repository';

@Injectable()
export class PortfolioService {
  constructor(private readonly gizaRepository: GizaRepository) {}

  async recordSnapshot(params: {
    userPositionId: string;
    gizaPositionId?: string;
    principal: bigint;
    currentValue: bigint;
    yieldEarned: bigint;
    apr?: number | null;
    allocations?: unknown;
    source?: string;
  }) {
    const snapshot = await this.gizaRepository.createPortfolioSnapshot(params);

    await this.gizaRepository.createYieldHistory({
      userPositionId: params.userPositionId,
      portfolioSnapshotId: snapshot.id,
      principal: params.principal,
      currentValue: params.currentValue,
      yieldDelta: params.yieldEarned,
      apy: params.apr,
      reason: params.source || 'reconciliation',
      metadata: params.allocations,
    });

    return snapshot;
  }
}