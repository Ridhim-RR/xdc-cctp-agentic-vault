/**
 * BLOCKCHAIN SIGNER SERVICE
 * 
 * RESPONSIBILITY:
 * Manage backend's private keys and signing
 * Provide signers for XDC and Arbitrum transactions
 * 
 * WHY THIS SERVICE EXISTS:
 * - Private key management in one place
 * - Never expose private key outside this service
 * - Enable key rotation (one place to change)
 * - Different signers per chain (security)
 * 
 * SECURITY NOTES:
 * ⚠️  Private key is sensitive! 
 * - Never log it
 * - Never expose it in errors
 * - Use hardware wallet in production
 * - Rotate keys periodically
 */

import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainProviderService } from './provider.service';

/**
 * Service for managing signers (private key holders)
 * 
 * CONCEPT: Signer = Private key + Provider
 * - Provider: READ from blockchain
 * - Signer: WRITE to blockchain (sign transactions)
 * 
 * Analogy: Provider is like reading from database
 *         Signer is like having credentials to insert/update
 */
@Injectable()
export class BlockchainSignerService {
  private readonly logger = new Logger(BlockchainSignerService.name);

  // XDC signer (can sign transactions on XDC)
  private xdcSigner: ethers.Wallet | undefined;

  // Arbitrum signer (can sign transactions on Arbitrum)
  private arbSigner: ethers.Wallet | undefined;

  constructor(private readonly providerService: BlockchainProviderService) {}

  // Signers are initialized lazily on first access.
  // This avoids the NestJS onModuleInit race where providerService.onModuleInit
  // (which awaits RPC getBlockNumber calls) may not have completed yet when
  // signerService.onModuleInit runs.

  /**
   * Initialize wallet signers from private keys
   * 
   * FLOW:
   * 1. Read private key from .env (XDC_PRIVATE_KEY)
   * 2. Create Wallet object from private key
   * 3. Connect wallet to provider
   * 4. Log signer address (for verification)
   * 
   * WHY CONNECT TO PROVIDER:
   * Wallet alone cannot make blockchain calls
   * Must connect to provider to get current nonce, gas price, etc.
   * 
   * PRODUCTION NOTES:
   * - Do not store private key in .env
   * - Use AWS Secrets Manager, HashiCorp Vault
   * - Consider using hardware wallet (Ledger, Trezor)
   */
  private initializeSigners(): void {
    try {
      // Single-wallet MVP: derive all signers from DEPLOYER_PRIVATE_KEY.
      const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!deployerPrivateKey) {
        throw new Error('DEPLOYER_PRIVATE_KEY not configured');
      }

      // Create wallet from private key
      const xdcWallet = new ethers.Wallet(deployerPrivateKey);
      // Connect wallet to XDC provider
      this.xdcSigner = xdcWallet.connect(this.providerService.getXdcProvider());

      this.logger.log(
        `[XDC Signer] Initialized for address: ${this.xdcSigner.address}`
      );

      // Arbitrum Signer
      const arbWallet = new ethers.Wallet(deployerPrivateKey);
      const arbProvider = this.providerService.getArbProvider();
      this.arbSigner = arbWallet.connect(arbProvider);

      this.logger.log(
        `[Arbitrum Signer] Initialized for address: ${this.arbSigner.address}`
      );
    } catch (error) {
      this.logger.error(`Signer initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get signer for XDC transactions
   * 
   * USAGE:
   * const signer = this.signerService.getXdcSigner();
   * const tx = await contract.connect(signer).depositForBurn(amount, domain, recipient, token);
   * 
   * This signer can ONLY sign transactions on XDC
   */
  getXdcSigner(): ethers.Wallet {
    if (!this.xdcSigner) {
      this.initializeSigners();
    }
    if (!this.xdcSigner) {
      throw new Error('XDC signer not initialized');
    }
    return this.xdcSigner;
  }

  /**
   * Get signer for Arbitrum transactions
   */
  getArbSigner(): ethers.Wallet {
    if (!this.arbSigner) {
      this.initializeSigners();
    }
    if (!this.arbSigner) {
      throw new Error('Arbitrum signer not initialized');
    }
    return this.arbSigner;
  }

  /**
   * Get XDC signer address (backend's wallet)
   * 
   * WHY NEEDED:
   * - Recipient in depositForBurn() should be backend's address
   * - Convert address to bytes32 for CCTP
   * - Verify balance before burning
   * 
   * EXAMPLE:
   * const signerAddress = this.signerService.getXdcSignerAddress();
   * // signerAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f42e7e"
   */
  getXdcSignerAddress(): string {
    return this.getXdcSigner().address;
  }

  /**
   * Get Arbitrum signer address
   */
  getArbSignerAddress(): string {
    return this.getArbSigner().address;
  }

  /**
   * Get XDC signer balance (in wei)
   * 
   * WHY NEEDED:
   * - Verify backend wallet has enough balance for gas
   * - Alert if balance too low (cannot pay gas fees)
   * - Monitor gas spending
   */
  async getXdcSignerBalance(): Promise<bigint> {
    const provider = this.providerService.getXdcProvider();
    return provider.getBalance(this.getXdcSigner().address);
  }

  /**
   * Get Arbitrum signer balance
   */
  async getArbSignerBalance(): Promise<bigint> {
    const provider = this.providerService.getArbProvider();
    return provider.getBalance(this.getArbSigner().address);
  }

  /**
   * Get current nonce (transaction count) for XDC signer
   * 
   * WHY NEEDED:
   * ethers.js automatically manages nonce
   * But manual verification helpful for debugging
   * Nonce = how many transactions sent from this address
   * Used to prevent double-spending
   */
  async getXdcSignerNonce(): Promise<number> {
    const provider = this.providerService.getXdcProvider();
    return provider.getTransactionCount(this.getXdcSigner().address);
  }

  /**
   * Get current nonce for Arbitrum signer
   */
  async getArbSignerNonce(): Promise<number> {
    const provider = this.providerService.getArbProvider();
    return provider.getTransactionCount(this.getArbSigner().address);
  }
}
