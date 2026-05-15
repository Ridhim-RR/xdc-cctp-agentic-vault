import { DepositCard } from '@/components/deposit/deposit-card';
import { WalletDeposits } from '@/components/deposits/wallet-deposits';
import { WalletSection } from '@/components/wallet/wallet-section';

export default function DepositsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-10 md:px-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border/80 pb-6 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">bond.credit</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">Deposits</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            Approve USDC, deposit into the vault, and inspect your wallet&apos;s deposit history.
          </p>
        </div>
        <WalletSection />
      </header>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DepositCard />
        <WalletDeposits />
      </section>
    </main>
  );
}