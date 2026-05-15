'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { USDC_DECIMALS } from '@/contracts/addresses';
import { xdcTestnet } from '@/config/chains';
import { getDepositsByWallet, type BackendDeposit } from '@/services/backend-api';
import { formatTokenAmount } from '@/utils/token-format';

export function WalletDeposits() {
  const { address, isConnected } = useAccount();
  const [deposits, setDeposits] = useState<BackendDeposit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!isConnected || !address) {
      setDeposits([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    void getDepositsByWallet(address)
      .then((response) => {
        if (cancelled) return;
        setDeposits(response.deposits);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDeposits([]);
        setError(err instanceof Error ? err.message : 'Failed to load deposits');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, isConnected, reloadKey]);

  return (
    <Card className="border-border/90 bg-card/90">
      <CardHeader>
        <CardTitle>Wallet Deposits</CardTitle>
        <CardDescription>
          {isConnected && address ? `Showing deposits for ${address}` : 'Connect your wallet to view deposit history.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isConnected ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Connect your wallet to load your deposit history.
          </div>
        ) : loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading deposits...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <p className="font-medium">Unable to load deposits</p>
            <p className="mt-1 break-words">{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => setReloadKey((value) => value + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : deposits.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            No deposits found for this wallet.
          </div>
        ) : (
          <div className="space-y-3">
            {deposits.map((deposit) => {
              const explorerBaseUrl = xdcTestnet.blockExplorers.default.url;
              const txUrl = `${explorerBaseUrl}/tx/${deposit.txHash}`;
              const amount = formatTokenAmount(BigInt(deposit.amount), USDC_DECIMALS);

              return (
                <div key={deposit.id} className="rounded-lg border border-border bg-background/60 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold">{amount} USDC</p>
                      <p className="mt-1 text-xs text-muted-foreground">Status: {deposit.status}</p>
                    </div>

                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      View tx
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>

                  <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-foreground/80">Tx hash</dt>
                      <dd className="break-all">{deposit.txHash}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground/80">Block</dt>
                      <dd>{deposit.blockNumber}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground/80">Created</dt>
                      <dd>{new Date(deposit.createdAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground/80">Chain</dt>
                      <dd>{deposit.chain}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}