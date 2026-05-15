import { formatUnits, parseUnits } from 'ethers';

export function parseTokenAmount(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Amount is required');
  }
  if (Number(normalized) <= 0) {
    throw new Error('Amount must be greater than 0');
  }
  return parseUnits(normalized, decimals);
}

export function formatTokenAmount(amount: bigint, decimals: number, fractionDigits = 4): string {
  const formatted = formatUnits(amount, decimals);
  const numberValue = Number(formatted);
  if (Number.isNaN(numberValue)) {
    return formatted;
  }
  return numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  });
}
