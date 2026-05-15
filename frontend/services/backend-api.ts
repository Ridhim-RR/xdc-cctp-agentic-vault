const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    next: { revalidate: 0 }
  });

  if (!res.ok) {
    throw new Error(`Backend request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

export interface BackendDeposit {
  id: string;
  walletAddress: string;
  amount: string;
  txHash: string;
  blockNumber: string;
  chain: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function getDepositsByWallet(wallet: string) {
  return fetchJson<{ wallet: string; deposits: BackendDeposit[]; totalByWallet: string }>(`/deposits/${wallet}`);
}

export function getVaultTotals() {
  return fetchJson<{ totalDeposits: string; totalCount: number; uniqueWallets: number }>('/vault/total');
}
