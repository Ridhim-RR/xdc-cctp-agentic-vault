/**
 * services/deposits.service.ts
 *
 * Business logic for managing deposits.
 * This service uses Prisma to persist deposits to PostgreSQL.
 *
 * Why a separate service?
 * =======================
 * Following NestJS patterns, we separate concerns:
 * - Controllers handle HTTP requests
 * - Services handle business logic and data access
 * - Listeners handle blockchain events
 *
 * This makes the code testable, reusable, and easy to understand.
 */

import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// DTO = Data Transfer Object
// A simple interface for the data we expect to receive
interface CreateDepositDto {
  walletAddress: string;
  amount: bigint;
  txHash: string;
  blockNumber: bigint;
}

@Injectable()
export class DepositsService {
  // Prisma client for database access
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Store a new deposit in the database.
   *
   * This is called by the blockchain event listener after detecting a Deposited event.
   *
   * @param data - Deposit data from the blockchain event
   * @returns The created deposit record
   *
   * How duplicate protection works:
   * ==============================
   * The txHash field in Prisma schema has @unique constraint.
   * If we try to insert the same txHash twice:
   * - The database rejects it (unique constraint violation)
   * - This prevents duplicate deposits if the listener processes the same event twice
   * - The listener can catch this error and log it as a duplicate
   */
  async createDeposit(data: CreateDepositDto) {
    try {
      const deposit = await this.prisma.deposit.create({
        data: {
          walletAddress: data.walletAddress.toLowerCase(), // Normalize to lowercase
          userAddress: data.walletAddress,
          userAddressLower: data.walletAddress.toLowerCase(),
          amount: data.amount,
          depositedAt: new Date(),
          txHash: data.txHash,
          blockNumber: data.blockNumber,
          logIndex: 0,
          eventSignature: data.txHash,
          isProcessed: false,
        }
      });

      console.log(`[Deposits] Stored deposit: ${deposit.id}`);
      return deposit;
    } catch (error: any) {
      // Handle unique constraint violation (duplicate txHash)
      if (error.code === 'P2002') {
        console.log(`[Deposits] Duplicate txHash, skipping: ${data.txHash}`);
        throw new Error(`Deposit already exists: ${data.txHash}`);
      }
      throw error;
    }
  }

  /**
   * Get all deposits from a specific wallet.
   *
   * @param walletAddress - The user's wallet address
   * @returns Array of deposits for that wallet
   */
  async getDepositsByWallet(walletAddress: string) {
    const deposits = await this.prisma.deposit.findMany({
      where: {
        walletAddress: walletAddress.toLowerCase()
      },
      orderBy: {
        createdAt: 'desc' // Most recent first
      }
    });

    return deposits;
  }

  /**
   * Get all deposits in the system (with pagination).
   *
   * @param skip - Number of records to skip (for pagination)
   * @param take - Number of records to return
   * @returns Array of deposits
   */
  async getAllDeposits(skip: number = 0, take: number = 10) {
    const deposits = await this.prisma.deposit.findMany({
      skip,
      take,
      orderBy: {
        createdAt: 'desc'
      }
    });

    return deposits;
  }

  async getDepositByTxHash(txHash: string) {
    return this.prisma.deposit.findUnique({
      where: { txHash },
    });
  }

  /**
   * Get the total amount of USDC deposited across all users.
   *
   * This sums all amounts in the deposit table.
   * Note: This is a mirror of the on-chain totalDeposits value.
   *
   * @returns Total deposits as a string (BigInt can't be serialized to JSON)
   */
  async getTotalDeposits(): Promise<string> {
    const result = await this.prisma.deposit.aggregate({
      _sum: {
        amount: true
      }
    });

    // _sum.amount is BigInt or null
    const total = result._sum.amount || 0n;
    return total.toString();
  }

  /**
   * Get statistics about deposits.
   *
   * Useful for dashboards and monitoring.
   *
   * @returns Object with deposit statistics
   */
  async getDepositStats() {
    const [totalCount, totalAmount, uniqueWallets] = await Promise.all([
      this.prisma.deposit.count(),
      this.prisma.deposit.aggregate({
        _sum: { amount: true }
      }),
      this.prisma.deposit.findMany({
        distinct: ['walletAddress'],
        select: { walletAddress: true }
      })
    ]);

    return {
      totalDeposits: totalCount,
      totalAmount: (totalAmount._sum.amount || 0n).toString(),
      uniqueWallets: uniqueWallets.length,
      averageDeposit: totalCount > 0 
        ? ((totalAmount._sum.amount || 0n) / BigInt(totalCount)).toString()
        : '0'
    };
  }

  /**
   * Get the last block number that was processed by the listener.
   *
   * Used to resume event listening after a restart without reprocessing old events.
   *
   * @returns The highest block number in the database
   */
  async getLastProcessedBlock(): Promise<bigint | null> {
    const lastDeposit = await this.prisma.deposit.findFirst({
      orderBy: {
        blockNumber: 'desc'
      },
      select: {
        blockNumber: true
      }
    });

    return lastDeposit?.blockNumber || null;
  }

  /**
   * Delete all deposits (useful for testing).
   *
   * WARNING: This is destructive. Only use in development.
   */
  async deleteAllDeposits() {
    const result = await this.prisma.deposit.deleteMany({});
    console.log(`[Deposits] Deleted ${result.count} deposits`);
    return result;
  }

  /**
   * Close the database connection.
   *
   * Call this when shutting down the application.
   */
  async closeConnection() {
    await this.prisma.$disconnect();
  }
}
