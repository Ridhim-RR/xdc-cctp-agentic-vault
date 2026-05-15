/**
 * controllers/deposits.controller.ts
 *
 * REST API endpoints for querying deposits.
 *
 * Controller Responsibility:
 * ==========================
 * Controllers handle HTTP requests and responses.
 * They parse query parameters, call services, and return structured data.
 *
 * Routes in Phase 1:
 * - GET /deposits/:wallet - Get deposits by wallet address
 * - GET /deposits - Get all deposits (paginated)
 * - GET /vault/total - Get total vault statistics
 * - GET /health - Simple health check for the listener
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { DepositsService } from '../services/deposits.service';
import { DepositEventsListener } from '../listeners/deposit-events.listener';
import { DepositResponseDto, WalletDepositsResponseDto, VaultTotalResponseDto } from '../dto/deposit.dto';

@Controller()
export class DepositsController {
  constructor(
    private depositsService: DepositsService,
    private listener: DepositEventsListener
  ) {}

  /**
   * GET /deposits/:wallet
   *
   * Get all deposits from a specific wallet address.
   *
   * @param wallet - The wallet address (0x...)
   * @returns WalletDepositsResponseDto with deposits and total
   *
   * Example:
   * GET /deposits/0x8975897f736fc85b0a17d79d1ab61e91e2b95680
   */
  @Get('deposits/:wallet')
  async getDepositsByWallet(@Param('wallet') wallet: string): Promise<WalletDepositsResponseDto> {
    // Validate the address format
    if (!wallet.startsWith('0x') || wallet.length !== 42) {
      throw new Error('Invalid wallet address format');
    }

    // Fetch deposits from the service
    const deposits = await this.depositsService.getDepositsByWallet(wallet);

    // Calculate total for this wallet
    const totalByWallet = deposits.reduce((sum, dep) => sum + dep.amount, 0n).toString();

    // Format response
    const response: WalletDepositsResponseDto = {
      wallet: wallet.toLowerCase(),
      deposits: deposits.map((dep) => this.formatDeposit(dep)),
      totalByWallet
    };

    return response;
  }

  /**
   * GET /deposits
   *
   * Get all deposits in the system with pagination.
   *
   * Query parameters:
   * - offset (optional): Number of records to skip (default: 0)
   * - limit (optional): Number of records to return (default: 10, max: 100)
   *
   * @returns List of deposits with pagination info
   *
   * Example:
   * GET /deposits?offset=0&limit=10
   */
  @Get('deposits')
  async getAllDeposits(
    @Query('offset') offset: string = '0',
    @Query('limit') limit: string = '10'
  ) {
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    // Fetch deposits
    const deposits = await this.depositsService.getAllDeposits(offsetNum, limitNum);
    const stats = await this.depositsService.getDepositStats();

    return {
      deposits: deposits.map((dep) => this.formatDeposit(dep)),
      total: stats.totalDeposits,
      offset: offsetNum,
      limit: limitNum
    };
  }

  /**
   * GET /vault/total
   *
   * Get aggregate vault statistics.
   *
   * @returns VaultTotalResponseDto with total deposits, count, and unique wallets
   *
   * Example:
   * GET /vault/total
   *
   * Response:
   * {
   *   "totalDeposits": "5000000",
   *   "totalCount": 5,
   *   "uniqueWallets": 3
   * }
   */
  @Get('vault/total')
  async getVaultTotal(): Promise<VaultTotalResponseDto> {
    const stats = await this.depositsService.getDepositStats();

    return {
      totalDeposits: stats.totalAmount,
      totalCount: stats.totalDeposits,
      uniqueWallets: stats.uniqueWallets
    };
  }

  /**
   * GET /health
   *
   * Simple health check for the backend and listener.
   *
   * @returns Object with backend status and listener status
   *
   * Example:
   * GET /health
   *
   * Response:
   * {
   *   "backend": "ok",
   *   "listener": {
   *     "isListening": true,
   *     "lastProcessedBlock": "5234890",
   *     "rpcConnected": true
   *   }
   * }
   */
  @Get('health')
  health() {
    return {
      backend: 'ok',
      listener: this.listener.getStatus(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Helper function to format a deposit record for API response.
   *
   * Converts BigInt fields to strings for JSON serialization.
   * Converts timestamps to ISO strings.
   */
  private formatDeposit(deposit: any): DepositResponseDto {
    return {
      id: deposit.id,
      walletAddress: deposit.walletAddress,
      amount: deposit.amount.toString(), // BigInt to string
      txHash: deposit.txHash,
      blockNumber: deposit.blockNumber.toString(), // BigInt to string
      chain: deposit.chain,
      status: deposit.status,
      createdAt: deposit.createdAt.toISOString(),
      updatedAt: deposit.updatedAt.toISOString()
    };
  }
}
