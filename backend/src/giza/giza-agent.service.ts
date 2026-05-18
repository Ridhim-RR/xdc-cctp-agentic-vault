import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GizaAdapterService } from './giza-adapter.service';
import { GizaPortfolioService } from './giza-portfolio.service';
import { GIZA_DEFAULT_PROTOCOLS } from './giza.constants';
import { GizaPositionInitResult, InitializeGizaPositionParams } from './giza.types';

const prisma = new PrismaClient();

@Injectable()
export class GizaAgentService {
  private readonly logger = new Logger(GizaAgentService.name);

  constructor(
    private readonly gizaAdapterService: GizaAdapterService,
    private readonly gizaPortfolioService: GizaPortfolioService,
  ) {}

  async initializeGizaPosition(params: InitializeGizaPositionParams): Promise<GizaPositionInitResult> {
    const transfer = await prisma.crossChainTransfer.findUnique({
      where: { id: params.transferId },
      include: {
        deposit: {
          select: {
            userAddress: true,
            userAddressLower: true,
          },
        },
      },
    });

    if (!transfer) {
      throw new Error(`Transfer ${params.transferId} not found`);
    }

    const userId = transfer.deposit?.userAddressLower || transfer.recipientAddressArbLower;

    const agent = await this.gizaAdapterService.createOrFetchAgent(params.recipientAddress);

    await prisma.agentPosition.upsert({
      where: { transferId: params.transferId },
      update: {
        userId,
        gizaAgentId: agent.agentWallet,
        principalAmount: params.mintedAmount,
        status: 'ACTIVATING',
        sourceChain: 'XDC',
        destinationChain: 'ARBITRUM',
        metadata: {
          recipientAddress: params.recipientAddress,
          mintTxHash: params.mintTxHash,
          reusedExistingAgent: agent.reusedExistingAgent,
        },
      },
      create: {
        userId,
        transferId: params.transferId,
        gizaAgentId: agent.agentWallet,
        principalAmount: params.mintedAmount,
        currentPortfolioValue: '0',
        status: 'ACTIVATING',
        sourceChain: 'XDC',
        destinationChain: 'ARBITRUM',
        metadata: {
          recipientAddress: params.recipientAddress,
          mintTxHash: params.mintTxHash,
          reusedExistingAgent: agent.reusedExistingAgent,
        },
      },
    });

    const tokenAddress = this.gizaAdapterService.getUsdcTokenAddress();
    const context = await this.gizaAdapterService.getClientContext();

    this.logger.log(
      `[Giza] Activation owner=${params.recipientAddress}, signerContext=${context.ownerAddress}, chain=${context.chain}`,
    );

    await this.gizaAdapterService.activateAgent({
      owner: params.recipientAddress as `0x${string}`,
      token: tokenAddress,
      protocols: GIZA_DEFAULT_PROTOCOLS,
      txHash: params.mintTxHash,
    });

    await prisma.agentPosition.update({
      where: { transferId: params.transferId },
      data: {
        status: 'ACTIVE',
      },
    });

    const portfolio = await this.gizaPortfolioService.syncPortfolioForTransfer(params.transferId);

    return {
      transferId: params.transferId,
      userId,
      gizaAgentId: agent.agentWallet,
      status: 'active',
      principalAmount: params.mintedAmount,
      currentPortfolioValue: portfolio.currentPortfolioValue,
    };
  }

  async markFailedInitialization(transferId: string, reason: string): Promise<void> {
    this.logger.error(`[Giza] Initialization failed for transfer=${transferId}: ${reason}`);

    await prisma.agentPosition.upsert({
      where: { transferId },
      update: {
        status: 'FAILED',
        metadata: {
          failureReason: reason,
        },
      },
      create: {
        userId: 'unknown',
        transferId,
        gizaAgentId: 'unknown',
        principalAmount: '0',
        currentPortfolioValue: '0',
        status: 'FAILED',
        sourceChain: 'XDC',
        destinationChain: 'ARBITRUM',
        metadata: {
          failureReason: reason,
        },
      },
    });
  }
}
