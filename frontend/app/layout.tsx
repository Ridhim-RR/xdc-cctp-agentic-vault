import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import '@/app/globals.css';
import { AppProviders } from '@/providers/app-providers';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk'
});

export const metadata: Metadata = {
  title: 'bond.credit | Deposit USDC',
  description: 'Phase 1 deposit flow for bond.credit on XDC testnet.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={spaceGrotesk.variable}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
