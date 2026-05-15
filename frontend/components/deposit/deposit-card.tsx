'use client';

import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TxStatus } from '@/components/tx-status';
import { useApproveUsdc } from '@/hooks/use-approve-usdc';
import { useDepositVault } from '@/hooks/use-deposit-vault';
import { useWalletState } from '@/hooks/use-wallet-state';

export function DepositCard() {
  const [amount, setAmount] = useState('');
  const { address, isConnected } = useAccount();
  const { isWrongNetwork } = useWalletState();
  const approveFlow = useApproveUsdc();
  const depositFlow = useDepositVault();

  const approveBusy = approveFlow.txState.stage === 'submitting' || approveFlow.txState.stage === 'pending';
  const depositBusy = depositFlow.txState.stage === 'submitting' || depositFlow.txState.stage === 'pending';

  const isAmountValid = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  }, [amount]);

  const actionsDisabled = !isConnected || isWrongNetwork || !isAmountValid;

  async function onApproveClick() {
    await approveFlow.approve(amount);
  }

  async function onDepositClick() {
    await depositFlow.deposit(amount);
  }

  return (
    <Card className="border-border/90 bg-card/90">
      <CardHeader>
        <CardTitle>Deposit USDC</CardTitle>
        <CardDescription>
          Step 1 approve USDC allowance, Step 2 deposit into the vault contract.
          {address ? ` Connected: ${address.slice(0, 6)}...${address.slice(-4)}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="deposit-amount">
            Amount (USDC)
          </label>
          <Input
            id="deposit-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.000001"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">USDC has 6 decimals. Example: 1.5 USDC.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button onClick={onApproveClick} disabled={actionsDisabled || approveBusy || depositBusy}>
            {approveBusy ? 'Approving...' : 'Approve USDC'}
          </Button>
          <Button onClick={onDepositClick} disabled={actionsDisabled || depositBusy || approveBusy}>
            {depositBusy ? 'Depositing...' : 'Deposit'}
          </Button>
        </div>

        {!isConnected ? (
          <p className="text-sm text-muted-foreground">Connect your wallet to continue.</p>
        ) : null}

        <TxStatus txState={approveFlow.txState} />
        <TxStatus txState={depositFlow.txState} />
      </CardContent>
    </Card>
  );
}
