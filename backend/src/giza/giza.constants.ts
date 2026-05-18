export const GIZA_DEFAULT_PROTOCOLS = (process.env.GIZA_DEFAULT_PROTOCOLS || 'aave')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p) => p.length > 0);

export const GIZA_TARGET_CHAIN = (process.env.GIZA_CHAIN || 'ARBITRUM_SEPOLIA').toUpperCase();

export const GIZA_USDC_ARB =
  process.env.USDC_ADDRESS_ARB ||
  process.env.USDC_ADDRESS ||
  '';

export const GIZA_ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
