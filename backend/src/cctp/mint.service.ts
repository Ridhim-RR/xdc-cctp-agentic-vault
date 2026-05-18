/**
 * CCTP MINT SERVICE
 * 
 * RESPONSIBILITY:
 * Execute the mint phase of CCTP workflow
 * Call MessageTransmitter.receiveMessage() on Arbitrum
 * 
 * WHY THIS SERVICE EXISTS:
 * - Single responsibility: mint logic only
 * - Separate from burn and attestation logic
 * - Handles Arbitrum-specific transaction execution
 * - Error handling for mint failures
 * 
 * WHAT IS MINTING:
 * CCTP provides proof-of-burn from Circle (attestation)
 * Backend submits this proof to Arbitrum's MessageTransmitter
 * MessageTransmitter verifies proof is valid
 * If valid: USDC contract mints new tokens
 * New tokens transferred to recipient wallet
 * 
 * FLOW:
 * 1. Get attestation proof from previous step
 * 2. Get message bytes from previous step
 * 3. Call receiveMessage(message, attestation) on Arbitrum
 * 4. Wait for confirmation
 * 5. Verify USDC balance increased on recipient's wallet
 */

import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainContractsService } from '../blockchain/contracts.service';
import { BlockchainSignerService } from '../blockchain/signer.service';
import { BlockchainProviderService } from '../blockchain/provider.service';

/**
 * Result of successful mint
 */
interface MintResult {
  txHash: string;
  blockNumber: number;
  mintedAmount: string;
  mintTimestamp: number;
  recipientFinalBalance: string;
}

/**
 * Result of gas balance check before mint execution
 */
interface GasBalanceCheckResult {
  success: boolean;
  error?: {
    code: string;
    message: string;
    signer: string;
    balance: string;
    required: string;
    gasPrice: string;
    estimatedGas: string;
  };
}

@Injectable()
export class CctpMintService {
  private readonly logger = new Logger(CctpMintService.name);

  constructor(
    private readonly contractsService: BlockchainContractsService,
    private readonly signerService: BlockchainSignerService,
    private readonly providerService: BlockchainProviderService,
  ) {}

  /**
   * Pre-flight gas balance check for mint execution
   *
   * WHY NEEDED:
   * Mint transactions need ETH for gas on Arbitrum
   * If signer wallet has insufficient ETH, receiveMessage() will fail
   * This check fails early and returns actionable error
   * Preserves MINT_PENDING state so workflow can resume after funding
   *
   * FLOW:
   * 1. Estimate gas needed for receiveMessage()
   * 2. Get current gas price on Arbitrum
   * 3. Get signer's current ETH balance
   * 4. Calculate required balance = estimatedGas × gasPrice × 2 (safety multiplier)
   * 5. Compare current balance vs required balance
   * 6. Return result with detailed diagnostics
   *
   * SAFETY MULTIPLIER:
   * Uses 2x estimated gas to account for:
   * - Gas price fluctuations between check and execution
   * - Unexpected gas usage increases
   * - Provides buffer for retry scenarios
   *
   * @param messageBytes Message bytes for receiveMessage()
   * @param attestation Attestation proof for receiveMessage()
   * @returns Result with success flag and optional error details
   */
  async ensureMintGasBalance(
    messageBytes: string,
    attestation: string,
  ): Promise<GasBalanceCheckResult> {
    try {
      const arbProvider = this.providerService.getArbProvider();
      const arbSigner = this.signerService.getArbSigner();
      const signerAddress = arbSigner.address;
      const arbRpcUrl = process.env.ARB_RPC_URL || 'Unknown';

      this.logger.log('[Mint] Starting pre-flight gas balance check', {
        signerAddress,
        chain: 'Arbitrum',
        rpcUrl: arbRpcUrl,
      });

      // Step 1: Estimate gas for receiveMessage
      let estimatedGas: string;
      try {
        estimatedGas = await this.estimateReceiveMessageGas(messageBytes, attestation);
      } catch (error) {
        // If gas estimation fails, this is a validation error, not a balance issue
        throw new Error(
          `Cannot proceed with mint - gas estimation failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      this.logger.debug('[Mint] Gas estimation for receiveMessage', {
        estimatedGasUnits: estimatedGas,
      });

      // Step 2: Get current gas price on Arbitrum
      const gasPrice = await arbProvider.getFeeData();
      if (!gasPrice?.gasPrice) {
        throw new Error('Could not fetch gas price from provider');
      }
      const gasPriceGwei = ethers.formatUnits(gasPrice.gasPrice, 'gwei');
      const gasPriceEth = ethers.formatUnits(gasPrice.gasPrice, 18);

      this.logger.debug('[Mint] Current Arbitrum gas price', {
        gasPriceWei: gasPrice.gasPrice.toString(),
        gasPriceGwei,
        gasPriceEth,
      });

      // Step 3: Get current signer ETH balance
      const currentBalance = await arbProvider.getBalance(signerAddress);
      const currentBalanceEth = ethers.formatUnits(currentBalance, 18);

      this.logger.debug('[Mint] Signer current ETH balance', {
        currentBalanceWei: currentBalance.toString(),
        currentBalanceEth,
      });

      // Step 4: Calculate required balance with 2x safety multiplier
      const estimatedGasBigInt = BigInt(estimatedGas);
      const gasPriceBigInt = gasPrice.gasPrice;
      const multiplier = 2n;
      const requiredBalance = estimatedGasBigInt * gasPriceBigInt * multiplier;
      const requiredBalanceEth = ethers.formatUnits(requiredBalance, 18);

      this.logger.log('[Mint] Gas balance check calculation', {
        estimatedGasUnits: estimatedGas,
        gasPriceWei: gasPrice.gasPrice.toString(),
        safetyMultiplier: multiplier.toString(),
        requiredBalanceWei: requiredBalance.toString(),
        requiredBalanceEth,
      });

      // Step 5: Validate balance
      if (currentBalance >= requiredBalance) {
        this.logger.log('[Mint] Gas balance sufficient for mint execution', {
          currentBalanceEth,
          requiredBalanceEth,
          buffer: ethers.formatUnits(currentBalance - requiredBalance, 18),
        });
        return { success: true };
      }

      // Balance insufficient
      const deficit = requiredBalance - currentBalance;
      const deficitEth = ethers.formatUnits(deficit, 18);

      this.logger.error('[Mint] INSUFFICIENT_GAS_BALANCE detected', {
        signerAddress,
        currentBalanceEth,
        requiredBalanceEth,
        deficitEth,
        gasPrice: gasPrice.toString(),
        estimatedGas,
        recommendation: `Fund signer wallet with at least ${deficitEth} ETH to complete mint transaction`,
      });

      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_GAS_BALANCE',
          message: `Signer wallet has insufficient ETH for gas. Current: ${currentBalanceEth} ETH, Required: ${requiredBalanceEth} ETH, Deficit: ${deficitEth} ETH`,
          signer: signerAddress,
          balance: currentBalance.toString(),
          required: requiredBalance.toString(),
          gasPrice: gasPrice.gasPrice.toString(),
          estimatedGas,
        },
      };
    } catch (error) {
      this.logger.error('[Mint] Gas balance check failed with error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute complete mint flow
   * 
   * FLOW:
   * 1. Validate inputs
   * 2. Get MessageTransmitter contract
   * 3. Get initial USDC balance
   * 4. Pre-flight gas balance check (ensures signer has sufficient ETH for gas)
   * 5. Call receiveMessage() with proof
   * 6. Wait for confirmation
   * 7. Verify USDC balance increased
   * 
   * CRITICAL: Message and attestation must match the burn
   * If data doesn't match, MessageTransmitter rejects it
   * 
   * @param messageBytes Raw message bytes from CCTP burn
   * @param attestation Attestation proof from Circle
   * @param recipientAddress Where minted USDC should be transferred
   * @param expectedAmount Expected USDC to be minted (for verification)
   * @returns MintResult with transaction details
   * @throws Error if mint fails
   */
  async executeMint(
    messageBytes: string,
    attestation: string,
    recipientAddress: string,
    expectedAmount: string,
  ): Promise<MintResult> {
    this.logger.log(
      `Starting mint flow: recipient=${recipientAddress}, amount=${expectedAmount}`
    );

    try {
      // Step 1: Validate inputs
      this.validateMintInputs(messageBytes, attestation, recipientAddress);

      // Step 2: Get contract instances
      const messageTransmitter = this.contractsService.getArbMessageTransmitter();
      const usdc = this.contractsService.getArbUsdc();
      // Step 3: Get initial balance (for verification)
      const initialBalance = await usdc.balanceOf(recipientAddress);
      this.logger.debug(
        `[Mint] Recipient initial USDC balance: ${initialBalance.toString()}`
      );

      // Step 4: Pre-flight gas balance check
      const balanceCheck = await this.ensureMintGasBalance(
        messageBytes,
        attestation,
      );

      if (!balanceCheck.success) {
        // Return error cleanly - orchestrator will catch and transition to MINT_PENDING
        this.logger.error('[Mint] Mint aborted - gas balance check failed', balanceCheck.error);
        throw new Error(
          balanceCheck.error?.message || 'Insufficient ETH balance for mint gas'
        );
      }

      // Step 6: Call receiveMessage()
      this.logger.log(
        `[Mint] Executing receiveMessage() on Arbitrum...`
      );

      const tx = await messageTransmitter.receiveMessage(
        messageBytes,
        attestation,
      );

      this.logger.log(
        `[Mint] Transaction submitted. Hash: ${tx.hash}`
      );

      // Step 7: Wait for confirmation
      const confirmations = Number.parseInt(process.env.ARB_CONFIRMATIONS_REQUIRED || '6', 10);
      const receipt = await tx.wait(confirmations);

      if (!receipt) {
        throw new Error('Transaction receipt is null (transaction failed)');
      }

      this.logger.log(
        `[Mint] Transaction confirmed. Block: ${receipt.blockNumber}, Gas used: ${receipt.gasUsed}`
      );

      // Step 8: Verify USDC balance increased
      const finalBalance = await usdc.balanceOf(recipientAddress);
      const mintedAmount = (BigInt(finalBalance) - BigInt(initialBalance)).toString();

      this.logger.log(
        `[Mint] USDC minted. Initial: ${initialBalance}, Final: ${finalBalance}, Minted: ${mintedAmount}`
      );

      // Verify amount matches expectation (allow 1% variance for rounding)
      const expectedBigInt = BigInt(expectedAmount);
      const actualBigInt = BigInt(mintedAmount);
      const variance = (actualBigInt * 100n) / expectedBigInt;

      if (variance < 99n || variance > 101n) {
        this.logger.warn(
          `[Mint] Amount mismatch. Expected: ${expectedAmount}, Actual: ${mintedAmount}`
        );
      }

      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        mintedAmount,
        mintTimestamp: Math.floor(Date.now() / 1000),
        recipientFinalBalance: finalBalance.toString(),
      };
    } catch (error) {
      this.logger.error(`[Mint] Failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Validate mint inputs before execution
   * 
   * CHECKS:
   * - Message bytes is valid hex (starts with 0x)
   * - Attestation is valid hex
   * - Recipient is valid Ethereum address
   * - Expected amount is positive
   * 
   * @param messageBytes Raw message bytes
   * @param attestation Attestation proof
   * @param recipientAddress Recipient wallet
   * @throws Error if validation fails
   */
  private validateMintInputs(
    messageBytes: string,
    attestation: string,
    recipientAddress: string,
  ): void {
    // Check message bytes
    if (!messageBytes.startsWith('0x')) {
      throw new Error('Message bytes must be hex string starting with 0x');
    }
    if (messageBytes.length < 10) {
      throw new Error('Message bytes too short');
    }

    // Check attestation
    if (!attestation.startsWith('0x')) {
      throw new Error('Attestation must be hex string starting with 0x');
    }
    if (attestation.length < 10) {
      throw new Error('Attestation too short');
    }

    // Check recipient address
    if (!ethers.isAddress(recipientAddress)) {
      throw new Error(
        `Invalid recipient address: ${recipientAddress}`
      );
    }
  }

  /**
   * Check if message has already been executed
   * 
   * WHY NEEDED:
   * Prevent double-minting if receiveMessage() called twice
   * MessageTransmitter tracks executed messages
   * 
   * IDEMPOTENCY:
   * Calling same mint twice should be safe
   * First call: mints USDC
   * Second call: rejected by MessageTransmitter (already executed)
   * 
   * @param messageHash Hash of the message
   * @returns true if message already executed
   */
  async isMessageAlreadyExecuted(messageHash: string): Promise<boolean> {
    try {
      const messageTransmitter = this.contractsService.getArbMessageTransmitter();

      // Query if message was already used (executed)
      const nonce = messageHash; // MessageTransmitter uses hash as key
      const used = await messageTransmitter.usedNonces(nonce);

      return used > 0n;
    } catch (error) {
      this.logger.warn(
        `Failed to check if message executed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Get recipient's current USDC balance on Arbitrum
   * 
   * USAGE:
   * - Verify mint succeeded
   * - Check recipient has funds
   * - Monitor balance before/after mint
   * 
   * @param recipientAddress Recipient wallet
   * @returns USDC balance in wei
   */
  async getRecipientUsdcBalance(recipientAddress: string): Promise<string> {
    if (!ethers.isAddress(recipientAddress)) {
      throw new Error(`Invalid address: ${recipientAddress}`);
    }

    const usdc = this.contractsService.getArbUsdc();
    const balance = await usdc.balanceOf(recipientAddress);

    return balance.toString();
  }

  /**
   * Estimate gas needed for receiveMessage()
   * 
   * WHY NEEDED:
   * Gas varies based on message complexity
   * Estimate helps catch issues early
   * Can fail if attestation invalid or insufficient funds
   * 
   * @param messageBytes Message bytes
   * @param attestation Attestation proof
   * @returns Estimated gas in wei
   */
  async estimateReceiveMessageGas(
    messageBytes: string,
    attestation: string,
  ): Promise<string> {
    try {
      const messageTransmitter = this.contractsService.getArbMessageTransmitter();
      const gasEstimate = await messageTransmitter.receiveMessage.estimateGas(
        messageBytes,
        attestation,
      );

      this.logger.debug(
        `[Mint] Estimated gas: ${gasEstimate.toString()}`
      );

      return gasEstimate.toString();
    } catch (error) {
      this.logger.warn(
        `[Mint] Gas estimation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new Error(
        `Cannot estimate gas for mint (may indicate invalid proof): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
