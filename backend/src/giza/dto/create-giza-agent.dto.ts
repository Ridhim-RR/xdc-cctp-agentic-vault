export class CreateGizaAgentDto {
  ownerAddress!: string;
  depositTxHash!: string;
  tokenAddress!: string;
  protocols!: string[];
  constraints?: Array<Record<string, unknown>>;
}