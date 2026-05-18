/**
 * CIRCLE IRIS ATTESTATION SERVICE
 * 
 * RESPONSIBILITY:
 * Poll Circle's IRIS API for attestation proof after burn
 * Implement retry logic with exponential backoff
 * Handle timeouts and errors gracefully
 * 
 * WHY THIS SERVICE EXISTS:
 * - Circle validates burns asynchronously (takes 10-60 seconds)
 * - Backend cannot block waiting for attestation
 * - Uses BullMQ queue for reliable polling
 * - Automatic retries if Circle API unavailable
 * 
 * WHAT IS ATTESTATION:
 * Attestation = Circle's proof that USDC was burned on source chain
 * Circle validators (multi-sig) verify the burn
 * They sign the proof cryptographically
 * Proof is used to mint USDC on destination chain
 * 
 * EVENTUAL CONSISTENCY:
 * Attestation not available immediately after burn
 * Polling necessary because:
 * - Circle validators need time to verify (~30s typical)
 * - Block finality delays (~1-2 minutes typical)
 * - Blockchain network variance
 * 
 * POLLING STRATEGY:
 * Start: 5 second intervals
 * Max attempts: 100 (total ~30 minutes with backoff)
 * Backoff: Exponential (5s, 7s, 10s, 14s, 20s, ...)
 * Handles failures: RPC timeout, API errors, network issues
 */

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';

/**
 * Circle IRIS API response structure
 */
interface IrisAttestationResponse {
  status: 'pending' | 'attested' | 'failed';
  attestation?: string; // Hex-encoded attestation proof
  errorCode?: string;
  errorMessage?: string;
}

interface IrisV2AttestationResponse {
  status: string;
  message?: string;
  attestation?: string;
  eventNonce?: string | number;
  errorCode?: string;
  errorMessage?: string;
}

interface IrisV2MessagesEnvelope {
  messages?: Array<{
    status?: string;
    message?: string;
    attestation?: string;
    eventNonce?: string | number;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

interface AttestationPollOptions {
  burnTxHash?: string;
  sourceDomainId?: number;
  messageBytes?: string;
}

interface DecodedCanonicalMessage {
  sourceDomain: number;
  destinationDomain: number;
  nonce: string;
  sender: string;
}

/**
 * Attestation polling result
 */
interface AttestationResult {
  messageHash: string;
  message?: string;
  attestation: string;
  status: string;
  eventNonce?: string | number;
  attempts: number;
  totalTimeSeconds: number;
}

@Injectable()
export class CircleIrisAttestationService {
  private readonly logger = new Logger(CircleIrisAttestationService.name);
  private irisClient: AxiosInstance | null = null;

  constructor() {}

  /**
   * SAFE URL NORMALIZATION FOR CIRCLE IRIS API
   * 
   * FIX FOR DOUBLE-APPEND BUG:
   * Problem: If env = "https://iris-api-sandbox.circle.com/attestations"
   *          and endpoint = "/attestations/{hash}"
   *          Result = ".../attestations/attestations/{hash}" ← WRONG
   * 
   * Solution: Remove "/attestations" suffix from env value
   *           and all trailing slashes
   * 
   * @param rawUrl Raw URL from CIRCLE_IRIS_API_URL env
   * @returns Normalized URL for axios baseURL (e.g., "https://iris-api-sandbox.circle.com")
   */
  private normalizeIrisBaseUrl(rawUrl: string): string {
    // Step 1: Trim whitespace
    let normalized = rawUrl.trim();

    // Step 2: Remove all trailing slashes
    normalized = normalized.replace(/\/+$/, '');

    // Step 3: Remove accidental "/attestations" suffix (case-insensitive)
    if (normalized.toLowerCase().endsWith('/attestations')) {
      normalized = normalized.slice(0, -'/attestations'.length);
      this.logger.warn(
        `[Iris] Auto-corrected: Removed "/attestations" suffix from base URL.`
      );
    }

    return normalized;
  }

  /**
   * VALIDATE CIRCLE IRIS API CONFIGURATION AT STARTUP
   * 
   * Checks:
   * 1. URL is configured
   * 2. URL is valid (http/https)
   * 3. Warns if "/attestations" in URL (will be corrected)
   * 
   * @param rawUrl Raw URL from CIRCLE_IRIS_API_URL env
   * @throws Error if invalid
   */
  private validateIrisConfig(rawUrl: string): void {
    if (!rawUrl?.trim()) {
      throw new Error(
        'CIRCLE_IRIS_API_URL is not configured. Attestation polling disabled. ' +
        'Add to .env: CIRCLE_IRIS_API_URL=https://iris-api-sandbox.circle.com'
      );
    }

    const trimmed = rawUrl.trim();

    // Warn about common misconfiguration
    if (trimmed.includes('/attestations')) {
      this.logger.warn(
        `[Iris] ⚠️ CONFIG WARNING: CIRCLE_IRIS_API_URL contains "/attestations" path`
      );
      this.logger.warn(
        `[Iris]   This causes double-append bug (will be auto-corrected)`
      );
      this.logger.warn(
        `[Iris]   Expected: https://iris-api-sandbox.circle.com`
      );
      this.logger.warn(
        `[Iris]   Received: ${trimmed}`
      );
    }

    // Validate protocol
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new Error(
        `CIRCLE_IRIS_API_URL must start with http:// or https://. Got: ${trimmed}`
      );
    }
  }

  /**
   * Initialize Axios client for Circle IRIS API
   * 
   * CONFIGURATION:
   * - Base URL: Normalized Circle endpoint (trailing slashes removed)
   * - Timeout: 10 seconds per request
   * - Retries: Handled by our polling logic, not axios
   * - Headers: Authorization if configured
   * 
   * NORMALIZATION:
   * - Removes trailing slashes
   * - Removes accidental "/attestations" suffix from env
   * - Logs normalized base URL for debugging
   * 
   * VALIDATION:
   * - Checks env is set and valid
   * - Warns about "/attestations" in env
   * - Throws early if config is invalid
   */
  private initializeIrisClient(): void {
    const rawUrl = process.env.CIRCLE_IRIS_API_URL;

    if (!rawUrl) {
      this.logger.warn(
        'CIRCLE_IRIS_API_URL not configured; attestation polling is disabled until set'
      );
      this.irisClient = null;
      return;
    }

    try {
      // STEP 1: Validate configuration at startup
      this.validateIrisConfig(rawUrl);

      // STEP 2: Normalize the base URL (remove /attestations suffix, trailing slashes)
      const normalizedBaseUrl = this.normalizeIrisBaseUrl(rawUrl);

      this.logger.log(`[Iris] Raw env value: ${rawUrl}`);
      this.logger.log(`[Iris] Normalized base URL: ${normalizedBaseUrl}`);

      // STEP 3: Create axios client with normalized base URL
      this.irisClient = axios.create({
        baseURL: normalizedBaseUrl, // ← Now safe (no double-append)
        timeout: 10000, // 10 second timeout per request
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // STEP 4: Add authorization header if API key configured
      const apiKey = process.env.CIRCLE_IRIS_API_KEY;
      if (apiKey) {
        this.irisClient.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
        this.logger.debug('[Iris] Authorization header configured');
      }

      this.logger.log(
        `[Iris] ✅ Client initialized. Will make requests to: ${normalizedBaseUrl}/attestations/{messageHash}`
      );
    } catch (error) {
      this.logger.error(
        `[Iris] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`
      );
      this.irisClient = null;
      throw error;
    }
  }

  private getIrisClient(): AxiosInstance {
    if (!this.irisClient) {
      this.initializeIrisClient();
    }

    if (!this.irisClient) {
      throw new Error('CIRCLE_IRIS_API_URL not configured');
    }

    return this.irisClient;
  }

  /**
   * Poll Circle IRIS API for attestation
   * 
   * FLOW:
   * 1. Query attestation endpoint with message hash
   * 2. If status = "attested", return attestation proof
   * 3. If status = "pending", retry after delay
   * 4. If status = "failed", throw error
   * 5. Max retries: 100 with exponential backoff
   * 
   * WHY EXPONENTIAL BACKOFF:
   * - Avoid hammering API with rapid requests
   * - Give Circle time to validate between requests
   * - Reduce server load during high volume
   * - Fade out polling as time increases
   * 
   * BACKOFF FORMULA:
   * delay = baseDelay * (attempt ^ 1.5) + jitter
   * Attempt 1: ~5s
   * Attempt 5: ~20s
   * Attempt 10: ~50s
   * Attempt 20: ~150s
   * Attempt 100: ~2000s (plateau at ~30min)
   * 
   * @param messageHash Hash of the burn message (from CCTP)
   * @param maxAttempts Max polling attempts (default: 100)
   * @returns AttestationResult with proof
   * @throws Error if attestation failed or timeout
   */
  async pollForAttestation(
    messageHash: string,
    maxAttempts: number = 100,
    options?: AttestationPollOptions,
  ): Promise<AttestationResult> {
    if (!messageHash.startsWith('0x')) {
      throw new Error('Invalid message hash format. Must start with 0x');
    }

    const sourceDomainId = options?.sourceDomainId ?? 18;

    if (options?.messageBytes) {
      const decodedMessage = this.decodeCanonicalMessage(options.messageBytes);
      this.logger.log(
        `[Canonical Message] sourceDomain=${decodedMessage.sourceDomain}, destinationDomain=${decodedMessage.destinationDomain}, nonce=${decodedMessage.nonce}, sender=${decodedMessage.sender}`
      );
    }

    if (options?.burnTxHash) {
      try {
        return await this.pollForAttestationByTransactionHash(
          options.burnTxHash,
          sourceDomainId,
          messageHash,
          maxAttempts,
          options.messageBytes,
        );
      } catch (error) {
        this.logger.warn(
          `[Attestation] V2 lookup failed, falling back to legacy messageHash polling: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    this.logger.log(
      `[Attestation] Starting poll for message hash: ${messageHash.substring(0, 10)}...`
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Query Circle for attestation
        const response = await this.queryAttestation(messageHash);

        // Handle response based on status
        if (response.status === 'attested') {
          const totalTime = (Date.now() - startTime) / 1000;
          this.logger.log(
            `[Attestation] ✅ Received attestation after ${attempt} attempts (${totalTime.toFixed(1)}s)`
          );

          return {
            messageHash,
            message: undefined,
            attestation: response.attestation || '',
            status: 'attested',
            eventNonce: undefined,
            attempts: attempt,
            totalTimeSeconds: totalTime,
          };
        }

        if (response.status === 'failed') {
          throw new Error(
            `Circle attestation failed: ${response.errorMessage || 'Unknown error'}`
          );
        }

        // Status is 'pending', continue polling
        this.logger.debug(
          `[Attestation] Attempt ${attempt}/${maxAttempts}: Status still pending. Waiting before retry...`
        );

        // Calculate backoff delay
        const delay = this.calculateBackoffDelay(attempt);

        // Wait before next attempt
        await this.sleep(delay);
      } catch (error) {
        // Log error but continue retrying (except for permanent errors)
        lastError = error as Error;

        if (this.isPermanentError(error)) {
          this.logger.error(
            `[Attestation] Permanent error at attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`
          );
          throw error;
        }

        this.logger.warn(
          `[Attestation] Attempt ${attempt} failed (temporary): ${error instanceof Error ? error.message : String(error)}. Retrying...`
        );

        // For temporary errors, continue to next attempt
        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    const totalTime = (Date.now() - startTime) / 1000;
    const errorMsg = lastError
      ? `Last error: ${lastError.message}`
      : 'No attestation received';

    this.logger.error(
      `[Attestation] ❌ Max attempts (${maxAttempts}) exhausted after ${totalTime.toFixed(1)}s. ${errorMsg}`
    );

    throw new Error(
      `Attestation polling timeout after ${maxAttempts} attempts (${totalTime.toFixed(1)}s). ${errorMsg}`
    );
  }

  /**
   * Query Circle IRIS API for single attestation request
   * 
   * ENDPOINT PATTERN: /attestations/{messageHash}
   * METHOD: GET
   * 
   * RESPONSE CODES:
   * - 200 OK: Attestation found (status in body)
   * - 404 Not Found: Message hash not recognized yet
   * - 503 Service Unavailable: Circle API temporarily down
   * 
   * DEBUG LOGGING:
   * - Logs base URL + endpoint = final complete URL
   * - Shows HTTP method and request attempt
   * - Logs response status explicitly
   * 
   * @param messageHash Message hash to query (0x + 64 hex chars)
   * @returns Attestation response from Circle
   * @throws Error if request fails
   */
  private async queryAttestation(
    messageHash: string
  ): Promise<IrisAttestationResponse> {
    try {
      const client = this.getIrisClient();
      const endpoint = `/attestations/${messageHash}`;
      
      // Construct full URL for logging (shows what axios will actually call)
      const baseURL = client.defaults.baseURL || '';
      const fullUrl = `${baseURL}${endpoint}`;

      this.logger.debug(
        `[Iris] GET ${endpoint}`
      );
      this.logger.debug(
        `[Iris] Full URL: ${fullUrl}`
      );

      const response = await client.get<IrisAttestationResponse>(endpoint);

      this.logger.debug(
        `[Iris] ✓ Response status: ${response.data.status}`
      );

      return response.data;
    } catch (error: any) {
      // Handle different HTTP error codes
      if (error.response?.status === 404) {
        this.logger.debug(
          `[Iris] 404: Message not found yet on Circle (expected during early polling)`
        );
        return { status: 'pending' };
      }

      if (error.response?.status === 503) {
        throw new Error('Circle IRIS API temporarily unavailable (503)');
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error('Circle IRIS API request timeout (10s)');
      }

      if (error.message?.includes('Network Error') || error.message?.includes('ENOTFOUND')) {
        throw new Error(
          `Network error connecting to Circle IRIS API: ${error.message}`
        );
      }

      // Log unexpected errors with full context
      this.logger.error(
        `[Iris] Unexpected error: ${error.message}`,
        error.response?.data
      );

      throw new Error(
        `Circle IRIS API error: ${error.message || 'Unknown error'}`
      );
    }
  }

  private async pollForAttestationByTransactionHash(
    burnTxHash: string,
    sourceDomainId: number,
    messageHash: string,
    maxAttempts: number,
    canonicalMessageBytes?: string,
  ): Promise<AttestationResult> {
    if (!burnTxHash.startsWith('0x')) {
      throw new Error('Invalid burn transaction hash format. Must start with 0x');
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    this.logger.log(
      `[Attestation][V2] Starting poll for txHash=${burnTxHash}, sourceDomainId=${sourceDomainId}, messageHash=${messageHash}`
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.queryAttestationV2(burnTxHash, sourceDomainId);

        const isComplete = response.status === 'complete';
        const hasAttestation = Boolean(response.attestation);
        const hasMessage = Boolean(response.message);

        this.logger.log(`[Attestation][V2] parsed status=${response.status}`);
        this.logger.log(`[Attestation][V2] attestation exists=${hasAttestation}`);
        this.logger.log(`[Attestation][V2] message exists=${hasMessage}`);
        this.logger.log(`[Attestation][V2] nonce=${response.eventNonce ?? 'n/a'}`);
        this.logger.log(
          `[Attestation][V2] full parsed object=${JSON.stringify(response, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}`
        );

        if (isComplete && hasAttestation && hasMessage) {
          const message = response.message;
          if (!message) {
            throw new Error('Circle V2 attestation returned no message payload');
          }

          if (!response.attestation) {
            throw new Error('Circle V2 attestation returned no attestation payload');
          }

          this.logger.log(`[Attestation][V2] IRIS message length=${message.length}`);
          this.logger.log(
            `[Attestation][V2] local canonical message length=${canonicalMessageBytes ? canonicalMessageBytes.length : 'n/a'}`
          );
          this.logger.log('[Attestation][V2] comparison skipped=true');

          const totalTime = (Date.now() - startTime) / 1000;
          this.logger.log(
            `[Attestation][V2] ✅ Received attestation after ${attempt} attempts (${totalTime.toFixed(1)}s)`
          );

          return {
            messageHash,
            message,
            attestation: response.attestation,
            status: response.status,
            eventNonce: response.eventNonce,
            attempts: attempt,
            totalTimeSeconds: totalTime,
          };
        }

        if (response.status === 'failed') {
          throw new Error(
            `Circle V2 attestation failed: ${response.errorMessage || 'Unknown error'}`
          );
        }

        this.logger.debug(
          `[Attestation][V2] Attempt ${attempt}/${maxAttempts}: Status still pending. Waiting before retry...`
        );

        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
      } catch (error) {
        lastError = error as Error;

        if (this.isPermanentError(error)) {
          this.logger.error(
            `[Attestation][V2] Permanent error at attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`
          );
          throw error;
        }

        this.logger.warn(
          `[Attestation][V2] Attempt ${attempt} failed (temporary): ${error instanceof Error ? error.message : String(error)}. Retrying...`
        );

        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    const errorMsg = lastError
      ? `Last error: ${lastError.message}`
      : 'No attestation received';

    this.logger.error(
      `[Attestation][V2] ❌ Max attempts (${maxAttempts}) exhausted after ${totalTime.toFixed(1)}s. ${errorMsg}`
    );

    throw new Error(
      `V2 attestation polling timeout after ${maxAttempts} attempts (${totalTime.toFixed(1)}s). ${errorMsg}`
    );
  }

  private async queryAttestationV2(
    burnTxHash: string,
    sourceDomainId: number,
  ): Promise<IrisV2AttestationResponse> {
    try {
      const client = this.getIrisClient();
      const endpoint = `/v2/messages/${sourceDomainId}`;
      const requestUrl = `${client.defaults.baseURL || ''}${endpoint}?transactionHash=${encodeURIComponent(burnTxHash)}`;

      this.logger.log(`[Iris][V2] requestUrl=${requestUrl}`);
      this.logger.log(`[Iris][V2] txHash=${burnTxHash}`);
      this.logger.log(`[Iris][V2] sourceDomainId=${sourceDomainId}`);

      const response = await client.get<IrisV2AttestationResponse>(endpoint, {
        params: {
          transactionHash: burnTxHash,
        },
      });

      const irisResponse = response.data as unknown as IrisV2MessagesEnvelope;
      const irisMessage = irisResponse?.messages?.[0];
      const parsedResponse: IrisV2AttestationResponse = {
        status: irisMessage?.status || 'pending',
        attestation: irisMessage?.attestation,
        message: irisMessage?.message,
        eventNonce: irisMessage?.eventNonce,
        errorCode: irisMessage?.errorCode,
        errorMessage: irisMessage?.errorMessage,
      };

      this.logger.log(
        `[Iris][V2] IRIS response body=${JSON.stringify(response.data, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}`
      );
      this.logger.log(`[Iris][V2] parsed status=${parsedResponse.status}`);
      this.logger.log(`[Iris][V2] attestation exists=${Boolean(parsedResponse.attestation)}`);
      this.logger.log(`[Iris][V2] message exists=${Boolean(parsedResponse.message)}`);
      this.logger.log(`[Iris][V2] nonce=${parsedResponse.eventNonce ?? 'n/a'}`);
      this.logger.log(
        `[Iris][V2] full parsed object=${JSON.stringify(parsedResponse, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}`
      );

      return parsedResponse;
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.logger.debug(
          `[Iris][V2] 404: Message not found yet on Circle (expected during early polling)`
        );
        return { status: 'pending' };
      }

      if (error.response?.status === 503) {
        throw new Error('Circle IRIS V2 API temporarily unavailable (503)');
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error('Circle IRIS V2 API request timeout (10s)');
      }

      if (error.message?.includes('Network Error') || error.message?.includes('ENOTFOUND')) {
        throw new Error(
          `Network error connecting to Circle IRIS V2 API: ${error.message}`
        );
      }

      this.logger.error(
        `[Iris][V2] Unexpected error: ${error.message}`,
        error.response?.data
      );

      throw new Error(
        `Circle IRIS V2 API error: ${error.message || 'Unknown error'}`
      );
    }
  }

  private decodeCanonicalMessage(messageBytes: string): DecodedCanonicalMessage {
    if (!messageBytes.startsWith('0x')) {
      throw new Error('Canonical message must be hex string starting with 0x');
    }

    const bytes = ethers.getBytes(messageBytes);
    if (bytes.length < 52) {
      throw new Error(`Canonical message too short to decode. Length: ${bytes.length}`);
    }

    const sourceDomain = Number(ethers.toBigInt(bytes.slice(4, 8)));
    const destinationDomain = Number(ethers.toBigInt(bytes.slice(8, 12)));
    const nonce = ethers.toBigInt(bytes.slice(12, 20)).toString();
    const sender = ethers.hexlify(bytes.slice(20, 52));

    return {
      sourceDomain,
      destinationDomain,
      nonce,
      sender,
    };
  }

  /**
   * Calculate exponential backoff delay
   * 
   * FORMULA:
   * delay = Math.min(baseDelay * (attempt ^ 1.5) + random jitter, maxDelay)
   * 
   * This ensures:
   * - Early retries are fast (5s)
   * - Later retries have longer delays
   * - Random jitter prevents thundering herd (multiple requests at same time)
   * - Capped at maxDelay to prevent infinite waits
   * 
   * @param attempt Current attempt number (1-indexed)
   * @returns Delay in milliseconds
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = 5000; // 5 seconds
    const maxDelay = 120000; // 2 minutes max
    const jitterFactor = 0.1; // 10% jitter

    // Calculate exponential delay: 5s * (attempt ^ 1.5)
    const exponentialDelay = baseDelay * Math.pow(attempt, 1.5);

    // Add random jitter (±10%)
    const jitter = exponentialDelay * jitterFactor * (Math.random() - 0.5) * 2;

    // Apply cap
    const delay = Math.min(exponentialDelay + jitter, maxDelay);

    this.logger.debug(
      `[Backoff] Attempt ${attempt}: delay=${Math.round(delay)}ms`
    );

    return Math.round(delay);
  }

  /**
   * Check if error is permanent vs temporary
   * 
   * TEMPORARY (retry):
   * - Network timeouts
   * - 503 Service Unavailable
   * - 404 Not Found (message not indexed yet)
   * 
   * PERMANENT (fail immediately):
   * - 400 Bad Request (invalid input)
   * - 401 Unauthorized (API key issue)
   * - Invalid message hash format
   * 
   * @param error Error to classify
   * @returns true if permanent error, false if temporary
   */
  private isPermanentError(error: any): boolean {
    if (!error) return false;

    // HTTP status errors
    if (error.response?.status === 400) return true; // Bad request
    if (error.response?.status === 401) return true; // Unauthorized
    if (error.response?.status === 403) return true; // Forbidden

    // Validation errors
    if (error.message?.includes('Invalid')) return true;
    if (error.message?.includes('Bad Request')) return true;

    // Everything else is considered temporary
    return false;
  }

  /**
   * Sleep utility (promisified timeout)
   * 
   * @param ms Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Validate message hash format
   * 
   * EXPECTED FORMAT:
   * 0x + 64 hex characters = 32 bytes
   * 
   * @param messageHash Hash to validate
   * @throws Error if invalid format
   */
  validateMessageHashFormat(messageHash: string): void {
    if (!messageHash.startsWith('0x')) {
      throw new Error('Message hash must start with 0x');
    }

    if (messageHash.length !== 66) {
      // 0x + 64 hex chars
      throw new Error(
        `Message hash must be 66 characters (0x + 64 hex). Got: ${messageHash.length}`
      );
    }

    // Check if all chars after 0x are valid hex
    const hexPart = messageHash.substring(2);
    if (!/^[0-9a-fA-F]{64}$/.test(hexPart)) {
      throw new Error('Message hash contains invalid hex characters');
    }
  }
}
