/**
 * BLOCKCHAIN CONTRACTS SERVICE
 * 
 * RESPONSIBILITY:
 * Initialize contract instances (ERC20, TokenMessenger, MessageTransmitter)
 * Provide typed contract instances for other services
 * 
 * WHY THIS SERVICE EXISTS:
 * - Contracts initialized once, reused everywhere
 * - Centralize contract addresses and ABIs
 * - Type-safe contract calls (TypeScript)
 * - Dependency injection (testable, mockable)
 * 
 * WHAT IS A CONTRACT INSTANCE:
 * ethers.Contract(address, abi, signerOrProvider)
 * - address: where contract is deployed
 * - abi: contract's public interface (functions, events)
 * - signerOrProvider: who calls the contract (signer for writes, provider for reads)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainProviderService } from './provider.service';
import { BlockchainSignerService } from './signer.service';

/**
 * ERC20 Token ABI (USDC)
 * Only includes functions we actually use
 * Full ABI has many more functions
 */
const ERC20_ABI = [
  // Read functions
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  
  // Write functions
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
  
  // Events
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

/**
 * TokenMessenger ABI (Circle CCTP V2)
 * Handles burn on source chain
 */
const TOKEN_MESSENGER_ABI = [
  // CCTP V2 depositForBurn (omit return type to avoid decode issues on some proxy/static paths)
  'function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
  
  // Helper to get nonce
  'function nextAvailableNonce() external view returns (uint64)',
  
  // Events
  'event DepositForBurn(uint256 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 recipient, uint32 destinationDomain, bytes32 destinationCaller, bytes messageBody)',
];

/**
 * MessageTransmitter ABI (Circle CCTP)
 * Handles mint on destination chain
 */
const MESSAGE_TRANSMITTER_ABI = [
  // Main CCTP function: verify message and mint new tokens
  'function receiveMessage(bytes message, bytes attestation) external returns (bool)',
  
  // Check if message already executed (prevent double-mint)
  'function usedNonces(bytes32) external view returns (uint256)',
  
  // Events
  'event ReceivedMessage(bytes message)',
];

/**
 * Service for managing smart contract instances
 */
@Injectable()
export class BlockchainContractsService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainContractsService.name);

  // XDC Contracts
  private xdcUsdc!: ethers.Contract;
  private xdcTokenMessenger: ethers.Contract | null = null;

  // Arbitrum Contracts
  private arbUsdc: ethers.Contract | null = null;
  private arbMessageTransmitter: ethers.Contract | null = null;

  constructor(
    private readonly providerService: BlockchainProviderService,
    private readonly signerService: BlockchainSignerService,
  ) {}

  async onModuleInit() {
    await this.initializeContracts();
  }

  /**
   * Initialize all contract instances
   * 
   * FLOW:
   * 1. Get contract addresses from .env
   * 2. Create contract instance with new ethers.Contract()
   * 3. Log initialization
   * 4. Verify contracts are accessible
   */
  private async initializeContracts(): Promise<void> {
    try {
      // ===== XDC Contracts =====

      // USDC on XDC
      const usdcXdcAddress = process.env.USDC_ADDRESS_XDC || process.env.USDC_ADDRESS;
      if (!usdcXdcAddress) {
        throw new Error('USDC_ADDRESS_XDC not configured');
      }

      this.xdcUsdc = new ethers.Contract(
        usdcXdcAddress,
        ERC20_ABI,
        this.signerService.getXdcSigner(), // Use signer to enable approve()
      );

      // Verify USDC is accessible
      const usdcDecimals = await this.xdcUsdc.decimals();
      this.logger.log(`[XDC USDC] Address: ${usdcXdcAddress}, Decimals: ${usdcDecimals}`);

      // TokenMessenger on XDC (handles burn)
      const tokenMessengerXdcAddress = process.env.TOKENM_ADDRESS_XDC;
      if (!tokenMessengerXdcAddress) {
        this.logger.warn('TOKENM_ADDRESS_XDC not configured; burn/mint CCTP flow will remain disabled until set');
      } else {
        this.xdcTokenMessenger = new ethers.Contract(
          tokenMessengerXdcAddress,
          TOKEN_MESSENGER_ABI,
          this.signerService.getXdcSigner(),
        );

        this.logger.log(`[XDC TokenMessenger] Address: ${tokenMessengerXdcAddress}`);
      }

      // ===== Arbitrum Contracts =====

      // USDC on Arbitrum
      const usdcArbAddress = process.env.USDC_ADDRESS_ARB;
      if (!usdcArbAddress) {
        this.logger.warn('USDC_ADDRESS_ARB not configured; Arbitrum reads will be unavailable until set');
      } else {
        this.arbUsdc = new ethers.Contract(
          usdcArbAddress,
          ERC20_ABI,
          this.providerService.getArbProvider(), // Use provider (read-only for balance checks)
        );

        const arbUsdcDecimals = await this.arbUsdc.decimals();
        this.logger.log(`[Arbitrum USDC] Address: ${usdcArbAddress}, Decimals: ${arbUsdcDecimals}`);
      }

      // MessageTransmitter on Arbitrum (handles mint)
      const messageTransmitterArbAddress = process.env.MSGTX_ADDRESS_ARB;
      if (!messageTransmitterArbAddress) {
        this.logger.warn('MSGTX_ADDRESS_ARB not configured; mint CCTP flow will remain disabled until set');
      } else {
        this.arbMessageTransmitter = new ethers.Contract(
          messageTransmitterArbAddress,
          MESSAGE_TRANSMITTER_ABI,
          this.signerService.getArbSigner(),
        );

        this.logger.log(`[Arbitrum MessageTransmitter] Address: ${messageTransmitterArbAddress}`);
      }

      this.logger.log('✅ All contracts initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize contracts: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get USDC contract on XDC
   * 
   * USAGE:
   * const balance = await this.contractsService.getXdcUsdc().balanceOf(address);
   * const tx = await this.contractsService.getXdcUsdc().approve(spender, amount);
   */
  getXdcUsdc(): ethers.Contract {
    if (!this.xdcUsdc) {
      throw new Error('XDC USDC contract not initialized');
    }
    return this.xdcUsdc;
  }

  /**
   * Get TokenMessenger contract on XDC
   * 
   * USAGE (BURN OPERATION):
   * const tx = await this.contractsService
   *   .getXdcTokenMessenger()
   *   .depositForBurn(amount, domain, recipient, token);
   */
  getXdcTokenMessenger(): ethers.Contract {
    if (!this.xdcTokenMessenger) {
      throw new Error('XDC TokenMessenger contract not initialized');
    }
    return this.xdcTokenMessenger;
  }

  /**
   * Get USDC contract on Arbitrum
   * 
   * USAGE:
   * const balance = await this.contractsService.getArbUsdc().balanceOf(address);
   */
  getArbUsdc(): ethers.Contract {
    if (!this.arbUsdc) {
      throw new Error('Arbitrum USDC contract not initialized');
    }
    return this.arbUsdc;
  }

  /**
   * Get MessageTransmitter contract on Arbitrum
   * 
   * USAGE (MINT OPERATION):
   * const tx = await this.contractsService
   *   .getArbMessageTransmitter()
   *   .receiveMessage(message, attestation);
   */
  getArbMessageTransmitter(): ethers.Contract {
    if (!this.arbMessageTransmitter) {
      throw new Error('Arbitrum MessageTransmitter contract not initialized');
    }
    return this.arbMessageTransmitter;
  }
}
