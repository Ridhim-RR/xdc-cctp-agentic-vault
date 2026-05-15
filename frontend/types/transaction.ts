export type TxStage = 'idle' | 'submitting' | 'pending' | 'confirmed' | 'error';

export interface TxState {
  stage: TxStage;
  txHash?: string;
  message?: string;
  error?: string;
}
