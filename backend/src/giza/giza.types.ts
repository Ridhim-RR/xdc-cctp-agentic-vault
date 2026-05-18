import { AgentInfo, AgentStatus, Chain } from '@gizatech/agent-sdk';

export type HexAddress = `0x${string}`;

export interface InitializeGizaPositionParams {
  transferId: string;
  mintedAmount: string;
  mintTxHash: string;
  recipientAddress: string;
}

export interface CreateOrFetchAgentResult {
  agentWallet: HexAddress;
  reusedExistingAgent: boolean;
}

export interface ActivateAgentParams {
  owner: HexAddress;
  token: HexAddress;
  protocols: string[];
  txHash: string;
}

export interface GizaClientContext {
  chain: Chain;
  ownerAddress: HexAddress;
}

export interface GizaPositionInitResult {
  transferId: string;
  userId: string;
  gizaAgentId: string;
  status: AgentStatus | 'active';
  principalAmount: string;
  currentPortfolioValue: string;
}

export interface GizaPortfolioState {
  transferId: string;
  userId: string;
  gizaAgentId: string;
  principalAmount: string;
  currentPortfolioValue: string;
  status: string;
  sourceChain: string;
  destinationChain: string;
  lastSyncedAt: Date | null;
  metadata: unknown;
}

export interface NormalizedPortfolio {
  raw: AgentInfo;
  totalValue: string;
  status: string;
}
