export function normalizeWeb3Error(error: unknown): string {
  if (!error) {
    return 'Unknown error.';
  }

  const err = error as { code?: number; shortMessage?: string; message?: string; reason?: string };
  const raw = `${err.shortMessage || ''} ${err.reason || ''} ${err.message || ''}`.toLowerCase();

  if (err.code === 4001 || raw.includes('user rejected') || raw.includes('user denied')) {
    return 'Transaction was rejected in wallet.';
  }
  if (raw.includes('insufficient funds')) {
    return 'Insufficient native token balance for gas.';
  }
  if (raw.includes('insufficient allowance')) {
    return 'Allowance is too low. Approve USDC first.';
  }
  if (raw.includes('execution reverted')) {
    return 'Transaction reverted by contract execution.';
  }
  if (raw.includes('network') || raw.includes('chain')) {
    return 'Wrong network selected. Switch to XDC Testnet.';
  }

  return err.shortMessage || err.reason || err.message || 'Unexpected Web3 error.';
}
