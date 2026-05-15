import { WalletSection } from '@/components/wallet/wallet-section';
import { DepositCard } from '@/components/deposit/deposit-card';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-10 md:px-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border/80 pb-6 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">bond.credit</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">USDC Deposit Flow on XDC Testnet</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            Connect your wallet, approve USDC spending, and deposit into the vault. This page is intentionally focused on
            Phase 1 only.
          </p>
        </div>
        <WalletSection />
      </header>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <DepositCard />
        <aside className="rounded-lg border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm">
          <h2 className="text-lg font-semibold">How this works</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Connect wallet via RainbowKit.</li>
            <li>Switch to XDC Testnet (chain ID 51).</li>
            <li>Approve USDC allowance for the vault contract.</li>
            <li>Submit deposit transaction to the vault.</li>
            <li>Wait for transaction confirmation and success state.</li>
          </ol>
          <div className="mt-6">
            <Link
              href="/deposits"
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border bg-transparent px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              View deposit history
            </Link>
          </div>
        </aside>
      </section>
    </main>
  );
}
