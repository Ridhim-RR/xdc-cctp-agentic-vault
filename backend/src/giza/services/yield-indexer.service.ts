import { Injectable, Logger } from '@nestjs/common';
import { GizaRepository } from '../repositories/giza.repository';

@Injectable()
export class YieldIndexerService {
  private readonly logger = new Logger(YieldIndexerService.name);

  constructor(private readonly gizaRepository: GizaRepository) {}

  async reconcilePosition(params: {
    userPositionId: string;
    gizaPositionId?: string;
    principal: bigint;
    currentValue: bigint;
    yieldEarned: bigint;
    apr?: number | null;
    allocations?: unknown;
  }) {
    this.logger.log(`Reconciling portfolio snapshot for ${params.userPositionId}`);
    return this.gizaRepository.createPortfolioSnapshot({
      ...params,
      source: 'reconciliation',
    });
  }
}