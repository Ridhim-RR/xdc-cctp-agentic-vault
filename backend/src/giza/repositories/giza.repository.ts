import { Injectable } from '@nestjs/common';
import { GizaAgentStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class GizaRepository {
  async upsertUserPosition(data: {
    walletAddress: string;
    chain?: string;
    principal?: bigint;
    currentValue?: bigint;
    yieldEarned?: bigint;
  }) {
    return prisma.userPosition.upsert({
      where: { walletAddressLower: data.walletAddress.toLowerCase() },
      update: {
        chain: data.chain,
        principal: data.principal,
        currentValue: data.currentValue,
        yieldEarned: data.yieldEarned,
      },
      create: {
        walletAddress: data.walletAddress,
        walletAddressLower: data.walletAddress.toLowerCase(),
        chain: data.chain || 'ARBITRUM',
        principal: data.principal || 0n,
        currentValue: data.currentValue || 0n,
        yieldEarned: data.yieldEarned || 0n,
      },
    });
  }

  async upsertGizaPosition(data: {
    userPositionId: string;
    ownerAddress: string;
    smartAccountAddress: string;
    tokenAddress: string;
    protocols?: unknown;
    constraints?: unknown;
    status?: GizaAgentStatus;
    metadata?: unknown;
  }) {
    return prisma.gizaPosition.upsert({
      where: { userPositionId: data.userPositionId },
      update: {
        ownerAddress: data.ownerAddress,
        ownerAddressLower: data.ownerAddress.toLowerCase(),
        smartAccountAddress: data.smartAccountAddress,
        smartAccountAddressLower: data.smartAccountAddress.toLowerCase(),
        tokenAddress: data.tokenAddress,
        protocols: data.protocols as never,
        constraints: data.constraints as never,
        status: data.status,
        metadata: data.metadata as never,
      },
      create: {
        userPositionId: data.userPositionId,
        ownerAddress: data.ownerAddress,
        ownerAddressLower: data.ownerAddress.toLowerCase(),
        smartAccountAddress: data.smartAccountAddress,
        smartAccountAddressLower: data.smartAccountAddress.toLowerCase(),
        tokenAddress: data.tokenAddress,
        protocols: data.protocols as never,
        constraints: data.constraints as never,
        status: data.status,
        metadata: data.metadata as never,
      },
    });
  }

  async createPortfolioSnapshot(data: {
    userPositionId: string;
    gizaPositionId?: string;
    principal: bigint;
    currentValue: bigint;
    yieldEarned: bigint;
    apr?: number | null;
    allocations?: unknown;
    source?: string;
  }) {
    return prisma.portfolioSnapshot.create({
      data: {
        userPositionId: data.userPositionId,
        gizaPositionId: data.gizaPositionId,
        principal: data.principal,
        currentValue: data.currentValue,
        yieldEarned: data.yieldEarned,
        apr: data.apr,
        allocations: data.allocations as never,
        source: data.source || 'giza',
      },
    });
  }

  async createYieldHistory(data: {
    userPositionId: string;
    portfolioSnapshotId?: string;
    principal: bigint;
    currentValue: bigint;
    yieldDelta: bigint;
    apy?: number | null;
    reason?: string;
    metadata?: unknown;
  }) {
    return prisma.yieldHistory.create({
      data: {
        userPositionId: data.userPositionId,
        portfolioSnapshotId: data.portfolioSnapshotId,
        principal: data.principal,
        currentValue: data.currentValue,
        yieldDelta: data.yieldDelta,
        apy: data.apy,
        reason: data.reason || 'reconciliation',
        metadata: data.metadata as never,
      },
    });
  }

  async createWithdrawalRequest(data: {
    userPositionId: string;
    gizaPositionId?: string;
    amount?: bigint;
    withdrawalType: 'PARTIAL' | 'FULL';
    requestedBy: string;
  }) {
    return prisma.withdrawalRequest.create({
      data: {
        userPositionId: data.userPositionId,
        gizaPositionId: data.gizaPositionId,
        amount: data.amount,
        withdrawalType: data.withdrawalType,
        requestedBy: data.requestedBy,
      },
    });
  }

  async createReverseCctpTransfer(data: {
    withdrawalRequestId: string;
    recipientAddressXdc: string;
    amount: bigint;
    burnTxHash?: string;
    messageHash?: string;
    messageBytes?: string;
    attestation?: string;
    mintTxHash?: string;
  }) {
    return prisma.reverseCctpTransfer.create({
      data: {
        withdrawalRequestId: data.withdrawalRequestId,
        recipientAddressXdc: data.recipientAddressXdc,
        recipientAddressXdcLower: data.recipientAddressXdc.toLowerCase(),
        amount: data.amount,
        burnTxHash: data.burnTxHash,
        messageHash: data.messageHash,
        messageBytes: data.messageBytes,
        attestation: data.attestation,
        mintTxHash: data.mintTxHash,
      },
    });
  }
}