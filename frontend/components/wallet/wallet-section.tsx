'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWalletState } from '@/hooks/use-wallet-state';

export function WalletSection() {
  const { isWrongNetwork, switchToSupportedNetwork, isSwitching } = useWalletState();

  return (
    <div className="flex flex-col items-start gap-3 md:items-end">
      <ConnectButton />
      {isWrongNetwork && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Wrong network
          <Button size="sm" variant="destructive" onClick={switchToSupportedNetwork} disabled={isSwitching}>
            {isSwitching ? 'Switching...' : 'Switch to XDC Testnet'}
          </Button>
        </div>
      )}
    </div>
  );
}
