/**
 * BLOCKCHAIN PROVIDER SERVICE
 * 
 * RESPONSIBILITY:
 * Initialize and manage connections to blockchain RPC endpoints
 * Single source of truth for blockchain connectivity
 * 
 * WHY THIS SERVICE EXISTS:
 * - Centralizes RPC connection logic
 * - Allows swapping RPC providers (fallover if node fails)
 * - Enables dependency injection (testable, mockable)
 * - Handles provider lifecycle (initialization, reconnection)
 * 
 * ARCHITECTURE PRINCIPLE:
 * Separation of Concerns: This service knows ONLY about RPC connections
 * Contract interaction handled by other services
 */

import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';

/**
 * Service for initializing blockchain providers
 * 
 * Providers are READ-ONLY connections to blockchain
 * Used for: querying state, listening to events, reading transactions
 * NOT used for: signing transactions (use Signer for that)
 */
@Injectable()
export class BlockchainProviderService {
  private readonly logger = new Logger(BlockchainProviderService.name);

  // XDC provider (source chain where users deposit USDC)
  private xdcProvider: ethers.JsonRpcProvider | undefined;

  // Arbitrum provider (destination chain where USDC minted)
  private arbProvider: ethers.JsonRpcProvider | undefined;

  /**
   * Create providers synchronously from env vars.
   * JsonRpcProvider construction is synchronous — no network call happens until
   * the first RPC method is invoked. This avoids any onModuleInit ordering race.
   */
  private ensureProviders(): void {
    if (this.xdcProvider && this.arbProvider) return;

    const xdcRpcUrl = process.env.XDC_TESTNET_RPC;
    if (!xdcRpcUrl) throw new Error('XDC_TESTNET_RPC not configured in .env');
    this.xdcProvider = new ethers.JsonRpcProvider(xdcRpcUrl);

    const arbRpcUrl = process.env.ARB_TESTNET_RPC;
    if (!arbRpcUrl) {
      this.logger.warn('ARB_TESTNET_RPC not configured; Arbitrum provider will reuse XDC provider');
      this.arbProvider = this.xdcProvider;
    } else {
      this.arbProvider = new ethers.JsonRpcProvider(arbRpcUrl);
    }

    this.logger.log('Blockchain providers created (connectivity check deferred to first use)');
  }

  /**
   * Get XDC provider
   * 
   * USAGE:
   * const provider = this.providerService.getXdcProvider();
   * const block = await provider.getBlock('latest');
   * 
   * NEVER modify the provider configuration here
   * All contract interactions happen in other services
   */
  getXdcProvider(): ethers.JsonRpcProvider {
    this.ensureProviders();
    return this.xdcProvider!;
  }

  /**
   * Get Arbitrum provider
   */
  getArbProvider(): ethers.JsonRpcProvider {
    this.ensureProviders();
    return this.arbProvider!;
  }

  /**
   * Get network information for XDC
   * 
   * USAGE: Verify we're on correct testnet
   * const network = await this.providerService.getXdcNetwork();
   */
  async getXdcNetwork(): Promise<ethers.Network> {
    return this.getXdcProvider().getNetwork();
  }

  /**
   * Get network information for Arbitrum
   */
  async getArbNetwork(): Promise<ethers.Network> {
    return this.getArbProvider().getNetwork();
  }

  /**
   * Get current block number on XDC
   * 
   * WHY NEEDED: Listener uses this to know where to start listening from
   * EXAMPLE: Start listening from blockNumber - 100 (lookback)
   */
  async getXdcBlockNumber(): Promise<number> {
    return this.getXdcProvider().getBlockNumber();
  }

  /**
   * Get current block number on Arbitrum
   */
  async getArbBlockNumber(): Promise<number> {
    return this.getArbProvider().getBlockNumber();
  }
}
