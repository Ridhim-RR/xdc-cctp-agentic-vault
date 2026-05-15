export type GizaChainName = 'ARBITRUM' | 'BASE' | 'ETHEREUM' | 'POLYGON' | 'SEPOLIA' | 'BASE_SEPOLIA' | 'DEVNET';

export interface GizaAgentActivationRequest {
  owner: string;
  token: string;
  protocols: string[];
  txHash: string;
  constraints?: Array<Record<string, unknown>>;
}

export interface GizaPositionAllocation {
  protocol: string;
  allocation: string;
  apr?: number;
}

export interface GizaPortfolioSnapshot {
  wallet: string;
  status: string;
  principal: string;
  currentValue: string;
  yieldEarned: string;
  apr: number | null;
  allocations: GizaPositionAllocation[];
  capturedAt: Date;
}

export interface GizaAgentHandle {
  wallet: string;
  status?: string;
}

export interface GizaSdkClient {
  createAgent(wallet: string): Promise<GizaAgentHandle>;
  getAgent(wallet: string): Promise<GizaAgentHandle>;
  agent(wallet: string): GizaAgentHandle;
}