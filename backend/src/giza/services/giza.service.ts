import { Injectable, Logger } from '@nestjs/common';
import {
  GIZA_API_KEY,
  GIZA_API_URL,
  GIZA_DEFAULT_CHAIN,
  GIZA_PARTNER_NAME,
} from '../constants/giza.constants';
import { GizaAgentActivationRequest, GizaAgentHandle, GizaSdkClient } from '../interfaces/giza.interfaces';

@Injectable()
export class GizaService {
  private readonly logger = new Logger(GizaService.name);
  private sdkClient: Promise<GizaSdkClient> | null = null;

  getConfig() {
    return {
      chain: GIZA_DEFAULT_CHAIN,
      apiKey: GIZA_API_KEY,
      partner: GIZA_PARTNER_NAME,
      apiUrl: GIZA_API_URL,
    };
  }

  async createAgent(walletAddress: string): Promise<GizaAgentHandle> {
    const sdk = await this.loadSdkClient();
    return sdk.createAgent(walletAddress);
  }

  async getAgent(walletAddress: string): Promise<GizaAgentHandle> {
    const sdk = await this.loadSdkClient();
    return sdk.getAgent(walletAddress);
  }

  async getAgentHandle(walletAddress: string): Promise<GizaAgentHandle> {
    const sdk = await this.loadSdkClient();
    return sdk.agent(walletAddress);
  }

  async activateAgent(request: GizaAgentActivationRequest): Promise<unknown> {
    const agent = await this.getAgentHandle(request.owner);
    if (!agent) {
      throw new Error(`Unable to resolve Giza agent for ${request.owner}`);
    }

    const agentWithActivation = agent as unknown as { activate?: (payload: GizaAgentActivationRequest) => Promise<unknown> };

    if (typeof agentWithActivation.activate !== 'function') {
      throw new Error('Giza SDK is not available in the current environment');
    }

    return agentWithActivation.activate(request);
  }

  async loadSdkClient(): Promise<GizaSdkClient> {
    if (!this.sdkClient) {
      this.sdkClient = this.createSdkClient();
    }

    return this.sdkClient;
  }

  private async createSdkClient(): Promise<GizaSdkClient> {
    try {
      const sdkModuleName = '@gizatech/agent-sdk';
      const sdkModule = await import(sdkModuleName);
      const GizaCtor = sdkModule.Giza as new (config: Record<string, unknown>) => GizaSdkClient;
      const Chain = sdkModule.Chain as Record<string, string>;
      const chainKey = GIZA_DEFAULT_CHAIN in Chain ? GIZA_DEFAULT_CHAIN : 'ARBITRUM';

      this.logger.log(`Initializing Giza SDK for chain ${chainKey}`);

      return new GizaCtor({
        chain: Chain[chainKey],
        apiKey: GIZA_API_KEY || undefined,
        partner: GIZA_PARTNER_NAME || undefined,
        apiUrl: GIZA_API_URL || undefined,
        enableRetry: true,
      });
    } catch (error) {
      this.logger.warn('Giza SDK is not installed yet; returning a lazy client placeholder');
      throw new Error(
        `Giza SDK is unavailable. Install @gizatech/agent-sdk before enabling strategy execution. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}