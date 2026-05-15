import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { TxState } from '@/types/transaction';

export function TxStatus({ txState }: { txState: TxState }) {
  if (txState.stage === 'idle') return null;

  if (txState.stage === 'submitting' || txState.stage === 'pending') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 p-3 text-sm">
        <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-primary" />
        <div>
          <p className="font-medium">Transaction in progress</p>
          <p className="text-muted-foreground">{txState.message}</p>
          {txState.txHash ? <p className="mt-1 break-all text-xs">Hash: {txState.txHash}</p> : null}
        </div>
      </div>
    );
  }

  if (txState.stage === 'confirmed') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CircleCheck className="mt-0.5 h-4 w-4" />
        <div>
          <p className="font-medium">Transaction confirmed</p>
          <p>{txState.message}</p>
          {txState.txHash ? <p className="mt-1 break-all text-xs">Hash: {txState.txHash}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <CircleAlert className="mt-0.5 h-4 w-4" />
      <div>
        <p className="font-medium">Transaction failed</p>
        <p>{txState.error}</p>
      </div>
    </div>
  );
}
