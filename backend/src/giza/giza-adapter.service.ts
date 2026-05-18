import { Injectable, Logger } from '@nestjs/common';
import { Agent, Chain, Giza } from '@gizatech/agent-sdk';
import { ethers } from 'ethers';
import { BlockchainProviderService } from '../blockchain/provider.service';
import { BlockchainSignerService } from '../blockchain/signer.service';
import {
  GIZA_ARBITRUM_SEPOLIA_CHAIN_ID,
  GIZA_DEFAULT_PROTOCOLS,
  GIZA_TARGET_CHAIN,
  GIZA_USDC_ARB,
} from './giza.constants';
import {
  ActivateAgentParams,
  CreateOrFetchAgentResult,
  GizaClientContext,
  HexAddress,
  NormalizedPortfolio,
} from './giza.types';

@Injectable()
export class GizaAdapterService {
  private readonly logger = new Logger(GizaAdapterService.name);
  private gizaClientPromise: Promise<Giza> | null = null;

  constructor(
    private readonly providerService: BlockchainProviderService,
    private readonly signerService: BlockchainSignerService,
  ) {}

  async getClientContext(): Promise<GizaClientContext> {
    const ownerAddress = this.ensureAddress(this.signerService.getArbSignerAddress());
    const chain = this.resolveGizaChain();

    return {
      chain,
      ownerAddress,
    };
  }

  async createOrFetchAgent(ownerAddress: string): Promise<CreateOrFetchAgentResult> {
    const giza = await this.getClient();
    const owner = this.ensureAddress(ownerAddress);

    try {
      const existingAgent = await giza.getAgent(owner);
      this.logger.log(`[Giza] Existing agent reuse: owner=${owner}, agent=${existingAgent.wallet}`);

      return {
        agentWallet: existingAgent.wallet,
        reusedExistingAgent: true,
      };
    } catch (error) {
      this.logger.log(`[Giza] Agent not found, creating new agent for owner=${owner}`);
      const createdAgent = await giza.createAgent(owner);
      this.logger.log(`[Giza] Agent creation success: owner=${owner}, agent=${createdAgent.wallet}`);

      return {
        agentWallet: createdAgent.wallet,
        reusedExistingAgent: false,
      };
    }
  }

  async activateAgent(params: ActivateAgentParams): Promise<unknown> {
    const giza = await this.getClient();
    const agent = giza.agent(this.ensureAddress(params.owner));

    this.logger.log(`[Giza] Activation start: owner=${params.owner}, token=${params.token}, tx=${params.txHash}`);

    const activation = await agent.activate({
      owner: this.ensureAddress(params.owner),
      token: this.ensureAddress(params.token),
      protocols: params.protocols.length > 0 ? params.protocols : GIZA_DEFAULT_PROTOCOLS,
      txHash: params.txHash,
    });

    this.logger.log(`[Giza] Activation success: owner=${params.owner}, response=${JSON.stringify(activation)}`);

    return activation;
  }

  async fetchPortfolio(agentWallet: string): Promise<NormalizedPortfolio> {
    const giza = await this.getClient();
    const agent: Agent = giza.agent(this.ensureAddress(agentWallet));
    const portfolio = await agent.portfolio();

    const totalValue = this.estimatePortfolioValue(portfolio);

    this.logger.log(`[Giza] Portfolio sync: agent=${agentWallet}, status=${portfolio.status}`);
    this.logger.log(`[Giza] Returned portfolio value: agent=${agentWallet}, value=${totalValue}`);

    return {
      raw: portfolio,
      totalValue,
      status: portfolio.status,
    };
  }

  getUsdcTokenAddress(): HexAddress {
    if (!GIZA_USDC_ARB) {
      throw new Error('GIZA token address missing. Set USDC_ADDRESS_ARB (or USDC_ADDRESS).');
    }

    return this.ensureAddress(GIZA_USDC_ARB);
  }

  private async getClient(): Promise<Giza> {
    if (!this.gizaClientPromise) {
      this.gizaClientPromise = this.initializeClient();
    }

    return this.gizaClientPromise;
  }

  private async initializeClient(): Promise<Giza> {
    const chain = this.resolveGizaChain();
    const chainLabel = this.resolveChainLabel(chain);
    const arbProvider = this.providerService.getArbProvider();
    const network = await arbProvider.getNetwork();

    this.logger.log(
      `[Giza] SDK initialization: configuredChain=${chainLabel}(${chain}), arbProviderChainId=${network.chainId.toString()}`,
    );

    return new Giza({
      chain,
      apiKey: process.env.GIZA_API_KEY || undefined,
      partner: process.env.GIZA_PARTNER_NAME || undefined,
      bearerToken: process.env.GIZA_BEARER_TOKEN || undefined,
      apiUrl: process.env.GIZA_API_URL || undefined,
      enableRetry: true,
      timeout: Number.parseInt(process.env.GIZA_TIMEOUT_MS || '45000', 10),
    });
  }

  private resolveGizaChain(): Chain {
    if (GIZA_TARGET_CHAIN === 'ARBITRUM_SEPOLIA') {
      return GIZA_ARBITRUM_SEPOLIA_CHAIN_ID as Chain;
    }

    const enumRecord = Chain as unknown as Record<string, Chain>;
    if (enumRecord[GIZA_TARGET_CHAIN] !== undefined) {
      return enumRecord[GIZA_TARGET_CHAIN];
    }

    this.logger.warn(`[Giza] Unknown chain ${GIZA_TARGET_CHAIN}. Falling back to ARBITRUM.`);
    return Chain.ARBITRUM;
  }

  private resolveChainLabel(chain: Chain): string {
    if ((chain as unknown as number) === GIZA_ARBITRUM_SEPOLIA_CHAIN_ID) {
      return 'ARBITRUM_SEPOLIA';
    }

    return Chain[chain as unknown as number] || 'UNKNOWN';
  }

  private estimatePortfolioValue(portfolio: { deposits: Array<{ amount: number }> }): string {
    if (!Array.isArray(portfolio.deposits) || portfolio.deposits.length === 0) {
      return '0';
    }

    const aggregate = portfolio.deposits.reduce((sum, deposit) => {
      const amount = Number.isFinite(deposit.amount) ? deposit.amount : 0;
      return sum + amount;
    }, 0);

    return aggregate.toString();
  }

  private ensureAddress(value: string): HexAddress {
    if (!ethers.isAddress(value)) {
      throw new Error(`Invalid address: ${value}`);
    }

    return value as HexAddress;
  }
}
