/**
 * CCTP BURN SERVICE
 * 
 * RESPONSIBILITY:
 * Execute the burn phase of CCTP workflow
 * Call TokenMessenger.depositForBurn() on XDC
 * 
 * WHY THIS SERVICE EXISTS:
 * - Single responsibility: burn logic only
 * - Reusable across different transfer types
 * - Error handling specific to burn phase
 * - Retry logic for blockchain failures
 * 
 * WHAT IS BURNING:
 * CCTP requires the USDC to be burned (destroyed) on source chain
 * This creates a proof-of-burn that Circle validates
 * Once Circle validates, new USDC minted on destination chain
 * 
 * FLOW:
 * 1. Backend checks USDC balance
 * 2. Approves TokenMessenger to spend USDC
 * 3. Calls depositForBurn() on TokenMessenger
 * 4. Waits for transaction confirmation
 * 5. Extracts message bytes from receipt
 */

import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainContractsService } from '../blockchain/contracts.service';
import { BlockchainSignerService } from '../blockchain/signer.service';
import { BlockchainProviderService } from '../blockchain/provider.service';

/**
 * Burn operation details
 * Used internally to track burn execution
 */
interface BurnOperationDetails {
  amount: string; // In wei
  destinationDomain: number; // 6 for Arbitrum
  mintRecipient: string; // Encoded backend wallet address (bytes32)
  burnToken: string; // USDC token address on XDC
  destinationCaller: string; // Allowed relayer/caller on destination chain (bytes32)
  maxFee: bigint;
  minFinalityThreshold: number;
  gasLimit?: number;
  gasPrice?: string;
}

/**
 * Result of successful burn
 * Returned to caller for further processing
 */
interface BurnResult {
  bridgeWalletAddress: string;
  destinationDomain: number;
  burnTokenAddress: string;
  tokenMessengerAddress: string;
  approvalTxHash?: string;
  approvalSkipped: boolean;
  preBurnBalance: string;
  postBurnBalance: string;
  txHash: string;
  blockNumber: number;
  messageHash: string;
  messageBytes: string;
  burnedAmount: string;
  burnTimestamp: number;
}

@Injectable()
export class CctpBurnService {
  private readonly logger = new Logger(CctpBurnService.name);

  constructor(
    private readonly contractsService: BlockchainContractsService,
    private readonly signerService: BlockchainSignerService,
    private readonly providerService: BlockchainProviderService,
  ) {}

  /**
   * Execute complete burn flow
   * 
   * FLOW:
   * 1. Validate input parameters
   * 2. Check balance
   * 3. Approve spending
   * 4. Call depositForBurn()
   * 5. Wait for confirmation
   * 6. Extract message bytes
   * 
   * WHY STEPS SEPARATED:
   * - Easier to test each step
   * - Easier to handle failures at specific points
   * - Can resume if partial failure
   * 
   * @param amount Amount to burn (in wei)
   * @param recipientAddressArb Recipient on Arbitrum (will be converted to bytes32)
   * @returns BurnResult with transaction details and message bytes
   * @throws Error if burn fails
   */
  async executeBurn(
    amount: string,
  ): Promise<BurnResult> {
    const signer = this.signerService.getXdcSigner();
    const recipientAddressArb = signer.address;

    this.logger.log(
      `Starting burn flow: amount=${amount}, recipient=${recipientAddressArb}`
    );

    try {
      // Step 1: Validate inputs
      this.validateBurnInputs(amount, recipientAddressArb);

      // Step 2: Get contract instances
      const tokenMessenger = this.contractsService.getXdcTokenMessenger();
      const usdc = this.contractsService.getXdcUsdc();
      const tokenMessengerAddress = this.toChecksumAddress(await tokenMessenger.getAddress(), 'TokenMessenger');
      const burnTokenAddress = this.toChecksumAddress(await usdc.getAddress(), 'USDC burn token');
      const destinationDomain = Number.parseInt(process.env.ARB_DOMAIN_ID || '3', 10);

      // Step 3: Check balance
      const amountBigInt = BigInt(amount);
      const balance = await usdc.balanceOf(signer.address);
      this.assertSufficientBalance(balance, amountBigInt);

      this.logger.debug(
        `[Burn] Balance check passed. Balance: ${balance.toString()}`
      );

      const preBurnBalance = balance;

      // Step 4: Approve spending
      this.logger.log(`[Burn] Approving USDC spending...`);
      const approvalResult = await this.approveTokenMessenger(usdc, tokenMessengerAddress, amount);
      const allowanceAfterApprove = await usdc.allowance(signer.address, tokenMessengerAddress);
      this.assertSufficientAllowance(allowanceAfterApprove, amountBigInt);

      // Step 5: Call depositForBurn()
      this.logger.log(`[Burn] Executing depositForBurn()...`);
      const burnDetails: BurnOperationDetails = {
        amount,
        destinationDomain,
        mintRecipient: this.encodeAddressToBytes32(recipientAddressArb, 'mintRecipient'),
        burnToken: burnTokenAddress,
        // CCTP V2 destinationCaller is an authorization field for receiveMessage() on destination.
        // Using the backend signer address restricts finalize rights to our relayer wallet.
        destinationCaller: this.encodeAddressToBytes32(signer.address, 'destinationCaller'),
        maxFee: 0n,
        minFinalityThreshold: 1000,
      };

      this.logger.debug(`[Burn] signer.address: ${signer.address}`);
      this.logger.debug(`[Burn] TokenMessenger: ${tokenMessengerAddress}`);
      this.logger.debug(`[Burn] burnToken: ${burnDetails.burnToken}`);
      this.logger.debug(`[Burn] destinationDomain: ${burnDetails.destinationDomain}`);
      this.logger.debug(`[Burn] mintRecipient(bytes32): ${burnDetails.mintRecipient}`);
      this.logger.debug(`[Burn] destinationCaller(bytes32): ${burnDetails.destinationCaller}`);
      this.logger.debug(`[Burn] amount: ${burnDetails.amount}`);

      const tx = await tokenMessenger.depositForBurn(
        burnDetails.amount,
        burnDetails.destinationDomain,
        burnDetails.mintRecipient,
        burnDetails.burnToken,
        burnDetails.destinationCaller,
        burnDetails.maxFee,
        burnDetails.minFinalityThreshold,
      );

      this.logger.log(`[Burn] depositForBurn submitted. Tx hash: ${tx.hash}`);

      // Step 6: Wait for confirmation
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error('Transaction receipt is null (transaction failed)');
      }

      this.logger.log(
        `[Burn] Transaction confirmed. Status: ${receipt.status}, Block: ${receipt.blockNumber}, Gas used: ${receipt.gasUsed}`
      );

      const postBurnBalance = await usdc.balanceOf(signer.address);
      if (postBurnBalance >= preBurnBalance) {
        throw new Error(
          `Burn verification failed. Pre-balance=${preBurnBalance.toString()}, post-balance=${postBurnBalance.toString()}`
        );
      }

      const burnedDelta = preBurnBalance - postBurnBalance;
      if (burnedDelta < BigInt(amount)) {
        throw new Error(
          `Burn verification mismatch. Expected >= ${amount}, observed ${burnedDelta.toString()}`
        );
      }

      // Step 7: Extract message bytes and hash
      const { messageBytes, messageHash } = this.extractMessageFromReceipt(
        receipt
      );

      this.logger.log(`[Burn] Message extracted. Hash: ${messageHash}`);

      return {
        bridgeWalletAddress: signer.address,
        destinationDomain,
        burnTokenAddress,
        tokenMessengerAddress,
        approvalTxHash: approvalResult.approvalTxHash,
        approvalSkipped: approvalResult.approvalSkipped,
        preBurnBalance: preBurnBalance.toString(),
        postBurnBalance: postBurnBalance.toString(),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        messageHash,
        messageBytes,
        burnedAmount: amount,
        burnTimestamp: Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      this.logger.error('[Burn] Raw error object follows');
      this.logger.error(error as any);
      throw error;
    }
  }

  /**
   * Validate burn inputs before execution
   * 
   * CHECKS:
   * - Amount is valid number
   * - Recipient address is valid Ethereum address
   * - Amount is positive
   * 
   * WHY VALIDATE EARLY:
   * - Fail fast before spending gas
   * - Better error messages
   * - Prevent invalid transactions reaching blockchain
   */
  private validateBurnInputs(
    amount: string,
    recipientAddress: string,
  ): void {
    // Check amount
    if (!/^\d+$/.test(amount)) {
      throw new Error(`Invalid amount: ${amount}. Must be valid integer.`);
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      throw new Error('Amount must be greater than 0');
    }

    // Check recipient address
    if (!ethers.isAddress(recipientAddress)) {
      throw new Error(
        `Invalid recipient address: ${recipientAddress}. Must be valid Ethereum address.`
      );
    }
  }

  /**
   * Ensure an address is valid and normalized to EIP-55 checksum form.
   * Accepts mixed-case hex input by normalizing to lowercase before checksum conversion.
   */
  private toChecksumAddress(address: string, label: string): string {
    const normalized = address.toLowerCase();
    if (!ethers.isAddress(normalized)) {
      throw new Error(`Invalid ${label} address: ${normalized}`);
    }
    const checksummed = ethers.getAddress(normalized);
    if (checksummed !== normalized) {
      this.logger.warn(`[Burn] ${label} was not checksummed. Normalized to ${checksummed}`);
    }
    return checksummed;
  }

  /**
   * Convert EVM address to bytes32 for CCTP payload fields.
   */
  private encodeAddressToBytes32(address: string, label: string): string {
    const checksummed = this.toChecksumAddress(address, label);
    const bytes32 = ethers.zeroPadValue(checksummed, 32);
    if (ethers.dataLength(bytes32) !== 32) {
      throw new Error(`Failed ${label} bytes32 conversion`);
    }
    return bytes32;
  }

  /**
   * Ensure source balance is enough for the requested burn amount.
   */
  private assertSufficientBalance(balance: bigint, required: bigint): void {
    if (required <= 0n) {
      throw new Error('Amount must be greater than 0');
    }
    if (balance < required) {
      throw new Error(`Insufficient balance. Required: ${required.toString()}, Available: ${balance.toString()}`);
    }
  }

  /**
   * Ensure allowance covers requested burn amount before depositForBurn.
   */
  private assertSufficientAllowance(allowance: bigint, required: bigint): void {
    if (allowance < required) {
      throw new Error(`Allowance too low after approval. Required: ${required.toString()}, Available: ${allowance.toString()}`);
    }
  }

  /**
   * Approve TokenMessenger to spend USDC
   * 
   * WHY APPROVAL NEEDED:
   * ERC20 standard requires two-step transfer:
   * 1. Owner approves spender to use tokens
   * 2. Spender calls transferFrom() to take tokens
   * 
   * Without approval, depositForBurn() will fail
   * TokenMessenger cannot access USDC until approved
   * 
   * @param usdc USDC contract instance
   * @param spenderAddress TokenMessenger address
   * @param amount Amount to approve
   */
  private async approveTokenMessenger(
    usdc: ethers.Contract,
    spenderAddress: string,
    amount: string,
  ): Promise<{ approvalTxHash?: string; approvalSkipped: boolean }> {
    try {
      // Check current allowance
      const signer = this.signerService.getXdcSigner();
      const currentAllowance = await usdc.allowance(signer.address, spenderAddress);

      if (currentAllowance >= BigInt(amount)) {
        this.logger.debug(
          `Already approved. Current allowance: ${currentAllowance.toString()}`
        );
        return { approvalSkipped: true };
      }

      // Approve with buffer (allow 10x the amount for multiple burns)
      const approveAmount = (BigInt(amount) * 10n).toString();

      this.logger.debug(
        `Approving ${approveAmount} to ${spenderAddress}...`
      );

      const approveTx = await usdc.approve(spenderAddress, approveAmount);
      const approveReceipt = await approveTx.wait(1);

      if (!approveReceipt) {
        throw new Error('Approval transaction failed');
      }

      this.logger.log(
        `Approval confirmed. Tx: ${approveReceipt.hash}`
      );

      return { approvalTxHash: approveReceipt.hash, approvalSkipped: false };
    } catch (error) {
      throw new Error(
        `Approval failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Convert Ethereum address to bytes32 for CCTP
   * 
   * WHY NEEDED:
   * CCTP protocol uses bytes32 for addresses
   * This allows addresses to be encoded compactly
   * 
   * PROCESS:
   * 1. Validate address (is valid Ethereum address)
   * 2. Pad with zeros to make 32 bytes
   * 
   * EXAMPLE:
   * Input: 0x742d35Cc6634C0532925a3b844Bc9e7595f42e7e (20 bytes)
   * Output: 0x000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f42e7e (32 bytes)
   * 
   * @param address Ethereum address
   * @returns Address as bytes32 string
   */
  private convertAddressToBytes32(address: string): string {
    // Ensure address is valid
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }

    // Convert to checksum address (standardized format)
    const checksumAddress = ethers.getAddress(address);

    // Pad to 32 bytes (24 zero bytes + 20 byte address)
    const bytes32 = ethers.zeroPadValue(checksumAddress, 32);

    return bytes32;
  }

  /**
   * Extract message bytes and hash from transaction receipt
   * 
   * WHY NEEDED:
   * TokenMessenger emits DepositForBurn event with message bytes
   * Message bytes are the proof of burn
   * This proof is needed by Circle to generate attestation
   * 
   * PROCESS:
   * 1. Get logs from receipt
   * 2. Find DepositForBurn event
   * 3. Extract message bytes from event log
   * 4. Calculate message hash
   * 
   * MESSAGE BYTES:
   * Contains: source domain, nonce, recipient, amount, etc.
   * Used by Circle to validate burn
   * 
   * MESSAGE HASH:
   * Keccak256 hash of message bytes
   * Used as unique identifier for polling attestation API
   * 
   * @param receipt Transaction receipt
   * @returns messageBytes and messageHash
   * @throws Error if message not found in receipt
   */
  private extractMessageFromReceipt(receipt: ethers.TransactionReceipt | null): {
    messageBytes: string;
    messageHash: string;
  } {
    if (!receipt?.logs?.length) {
      throw new Error('No logs in transaction receipt');
    }

    const tokenMessenger = this.contractsService.getXdcTokenMessenger();
    const tokenMessengerAddress = this.toChecksumAddress(
      tokenMessenger.target as string,
      'TokenMessenger',
    );
    const messageTransmitterAddress = this.getMessageTransmitterAddress();

    // Canonical CCTP flow: use the full MessageSent(bytes) payload emitted by
    // the MessageTransmitter. Do not hash the burn-body event payload.
    const candidateEvents = [
      {
        name: 'MessageSent',
        signature: 'MessageSent(bytes)',
        topic0: ethers.id('MessageSent(bytes)'),
        iface: new ethers.Interface(['event MessageSent(bytes message)']),
        priority: 0,
      },
    ] as const;

    try {
      console.dir(receipt.logs, { depth: null });
      this.logger.debug(
        `[Receipt] txHash=${receipt.hash}, blockNumber=${receipt.blockNumber}, status=${receipt.status}, logCount=${receipt.logs.length}`
      );

      for (const [arrayIndex, log] of receipt.logs.entries()) {
        this.logger.debug(
          `[Receipt Log] ${JSON.stringify({
            arrayIndex,
            logIndex: arrayIndex,
            address: log.address,
            topics: log.topics,
            dataLength: log.data?.length ?? 0,
            txHash: receipt.hash,
          })}`
        );
      }

      const allowedEmitters = this.getAllowedCctpEmitterAddresses(
        tokenMessengerAddress,
        messageTransmitterAddress,
      );
      const candidates = this.collectMessageCandidates(receipt, allowedEmitters, candidateEvents);

      if (candidates.length === 0) {
        throw new Error(
          `No valid CCTP message candidate found for tx ${receipt.hash}. Receipt summary: ${JSON.stringify(this.getReceiptSummary(receipt))}`
        );
      }

      const selectedCandidate = this.selectMessageCandidate(candidates, receipt.hash);

      if (!selectedCandidate.messageBytes?.startsWith('0x')) {
        throw new Error(
          `Invalid message payload selected for tx ${receipt.hash}. Candidate: ${JSON.stringify(selectedCandidate, null, 2)}`
        );
      }

      const hashInput = selectedCandidate.messageBytes;
      const hashInputLength = ethers.dataLength(hashInput);

      this.logger.log(
        `[Canonical Message] fullMessage=${hashInput}`
      );
      this.logger.log(
        `[Canonical Message] fullMessageLength=${hashInputLength}`
      );

      const messageHash = ethers.keccak256(hashInput);

      this.logger.log(
        `[Message Selection] selectedLogIndex=${selectedCandidate.logIndex}, selectedEmitter=${selectedCandidate.emitter}, selectedEvent=${selectedCandidate.eventName}, payloadLength=${hashInputLength}`
      );
      this.logger.log(
        `[Canonical Message] messageHash=${messageHash}`
      );
      this.logger.log(
        `[Message Debug] txHash=${receipt.hash}, messageLength=${hashInputLength}, messageHash=${messageHash}, selectedLogIndex=${selectedCandidate.logIndex}, selectedEventSignature=${selectedCandidate.eventSignature}`
      );

      return {
        messageBytes: selectedCandidate.messageBytes,
        messageHash,
      };
    } catch (error) {
      throw new Error(
        `Failed to extract message from receipt: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private getAllowedCctpEmitterAddresses(
    tokenMessengerAddress: string,
    messageTransmitterAddress: string,
  ): string[] {
    const allowed = new Set<string>([
      ethers.getAddress(tokenMessengerAddress),
      ethers.getAddress(messageTransmitterAddress),
    ]);

    this.logger.log(
      `[CCTP Config] MSGTX_ADDRESS_XDC=${messageTransmitterAddress}`
    );

    return [...allowed];
  }

  private getMessageTransmitterAddress(): string {
    const rawAddress =
      process.env.MSGTX_ADDRESS_XDC ||
      process.env.MESSAGE_TRANSMITTER_ADDRESS_XDC ||
      process.env.CIRCLE_MESSAGE_TRANSMITTER_XDC ||
      process.env.CIRCLE_MESSAGE_TRANSMITTER_ADDRESS_XDC;

    if (!rawAddress) {
      throw new Error(
        'MSGTX_ADDRESS_XDC is not configured. Add the official XDC MessageTransmitter address to .env.'
      );
    }

    return this.toChecksumAddress(rawAddress, 'MSGTX_ADDRESS_XDC');
  }

  private collectMessageCandidates(
    receipt: ethers.TransactionReceipt,
    allowedEmitters: string[],
    candidateEvents: ReadonlyArray<{
      name: string;
      signature: string;
      topic0: string;
      iface: ethers.Interface;
      priority: number;
    }>,
  ): Array<{
    logIndex: number;
    emitter: string;
    eventName: string;
    eventSignature: string;
    topic0: string;
    messageBytes: string;
    priority: number;
  }> {
    const allowedEmitterSet = new Set(
      allowedEmitters.map((address) => ethers.getAddress(address))
    );

    const candidates: Array<{
      logIndex: number;
      emitter: string;
      eventName: string;
      eventSignature: string;
      topic0: string;
      messageBytes: string;
      priority: number;
    }> = [];

    for (const [arrayIndex, log] of receipt.logs.entries()) {
      const normalizedEmitter = ethers.getAddress(log.address);
      const topic0 = log.topics?.[0];

      this.logger.debug(
        `[Receipt Log Check] logIndex=${arrayIndex}, address=${normalizedEmitter}, topic0=${topic0 ?? 'null'}, dataLength=${log.data?.length ?? 0}`
      );

      if (!allowedEmitterSet.has(normalizedEmitter)) {
        this.logger.debug(
          `[Receipt Log Skip] logIndex=${arrayIndex}, reason=unapproved_emitter, address=${normalizedEmitter}`
        );
        continue;
      }

      for (const candidateEvent of candidateEvents) {
        if (!topic0 || topic0 !== candidateEvent.topic0) {
          continue;
        }

        const decodedMessage = this.decodeMessageCandidate(
          log,
          candidateEvent.iface,
          candidateEvent.name,
          arrayIndex,
        );

        if (!decodedMessage) {
          this.logger.debug(
            `[Receipt Log Skip] logIndex=${arrayIndex}, reason=decode_failed, event=${candidateEvent.name}, address=${normalizedEmitter}`
          );
          continue;
        }

        this.logger.debug(
          `[Receipt Candidate] logIndex=${arrayIndex}, emitter=${normalizedEmitter}, event=${candidateEvent.name}, topic0=${topic0}, payloadLength=${decodedMessage.length}`
        );

        candidates.push({
          logIndex: arrayIndex,
          emitter: normalizedEmitter,
          eventName: candidateEvent.name,
          eventSignature: candidateEvent.signature,
          topic0,
          messageBytes: decodedMessage,
          priority: candidateEvent.priority,
        });
      }
    }

    return candidates;
  }

  private decodeMessageCandidate(
    log: ethers.Log,
    iface: ethers.Interface,
    expectedEventName: string,
    arrayIndex: number,
  ): string | null {
    try {
      this.logger.log(
        `[Message Bytes] rawLogData=${log.data}`
      );

      const decoded = iface.parseLog({ topics: log.topics, data: log.data });
      if (decoded?.name !== expectedEventName) {
        return null;
      }

      this.logger.log(
        `[Message Bytes] decoded.args=${JSON.stringify(decoded.args, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}`
      );

      if (expectedEventName === 'MessageSent') {
        return this.extractMessageBytesField(decoded.args?.message, 'decoded.args.message');
      }

      return null;
    } catch (error) {
      this.logger.debug(
        `[Receipt Decode Fail] logIndex=${arrayIndex}, event=${expectedEventName}, address=${log.address}, error=${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  private extractMessageBytesField(value: unknown, fieldName: string): string | null {
    this.logger.log(
      `[Message Bytes] ${fieldName}=${JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry)}`
    );
    this.logger.log(
      `[Message Bytes] typeof ${fieldName}=${typeof value}`
    );

    if (ethers.isBytesLike(value)) {
      const hexValue = ethers.hexlify(value);
      this.logger.log(
        `[Message Bytes] ethers.hexlify(${fieldName})=${hexValue}`
      );
      this.logger.log(
        `[Message Bytes] messageBytes.length=${hexValue.length}`
      );

      if (hexValue.startsWith('0x') && ethers.dataLength(hexValue) > 0) {
        return hexValue;
      }

      return null;
    }

    if (typeof value === 'string' && value.startsWith('0x') && ethers.dataLength(value) > 0) {
      this.logger.log(
        `[Message Bytes] ethers.hexlify(${fieldName})=${value}`
      );
      this.logger.log(
        `[Message Bytes] messageBytes.length=${value.length}`
      );
      return value;
    }

    return null;
  }

  private selectMessageCandidate(
    candidates: Array<{
      logIndex: number;
      emitter: string;
      eventName: string;
      eventSignature: string;
      topic0: string;
      messageBytes: string;
      priority: number;
    }>,
    txHash: string,
  ) {
    const pool = candidates.filter((candidate) => candidate.eventName === 'MessageSent');
    if (pool.length === 0) {
      throw new Error(
        `No CCTP message candidates found for tx ${txHash}. Candidates: ${JSON.stringify(candidates, null, 2)}`
      );
    }

    let selected = pool[0];
    for (const current of pool.slice(1)) {
      if (current.logIndex < selected.logIndex) {
        selected = current;
        continue;
      }
      if (current.logIndex === selected.logIndex && current.priority < selected.priority) {
        selected = current;
      }
    }

    const selectedBytesLength = ethers.dataLength(selected.messageBytes);
    if (selectedBytesLength <= 0) {
      throw new Error(
        `Selected message candidate has invalid payload length for tx ${txHash}. Selected: ${JSON.stringify(selected, null, 2)}`
      );
    }

    if (pool.length > 1) {
      this.logger.warn(
        `[Message Selection] Multiple candidates found for tx ${txHash}. Candidate summary: ${JSON.stringify(pool.map((candidate) => ({ logIndex: candidate.logIndex, emitter: candidate.emitter, eventName: candidate.eventName, payloadLength: candidate.messageBytes.length })), null, 2)}`
      );
    }

    return selected;
  }

  private getReceiptSummary(receipt: ethers.TransactionReceipt) {
    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed?.toString?.() ?? null,
      logCount: receipt.logs.length,
      logs: receipt.logs.map((log, arrayIndex) => ({
        arrayIndex,
        logIndex: arrayIndex,
        address: log.address,
        topic0: log.topics?.[0] ?? null,
        topicsLength: log.topics?.length ?? 0,
        dataLength: log.data?.length ?? 0,
      })),
    };
  }
}
