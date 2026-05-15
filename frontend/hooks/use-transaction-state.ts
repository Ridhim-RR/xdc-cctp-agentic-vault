'use client';

import { useState } from 'react';
import { TxState } from '@/types/transaction';

const initialState: TxState = { stage: 'idle' };

export function useTransactionState() {
  const [txState, setTxState] = useState<TxState>(initialState);

  return {
    txState,
    setSubmitting: (message = 'Submitting transaction...') => setTxState({ stage: 'submitting', message }),
    setPending: (txHash: string, message = 'Waiting for confirmation...') =>
      setTxState({ stage: 'pending', txHash, message }),
    setConfirmed: (txHash?: string, message = 'Transaction confirmed.') =>
      setTxState({ stage: 'confirmed', txHash, message }),
    setError: (error: string) => setTxState({ stage: 'error', error }),
    reset: () => setTxState(initialState)
  };
}
