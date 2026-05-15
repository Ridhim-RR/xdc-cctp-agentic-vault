export const GIZA_PARTNER_NAME = process.env.GIZA_PARTNER_NAME || 'bond-credit';
export const GIZA_API_URL = process.env.GIZA_API_URL || 'https://api.gizatech.xyz';
export const GIZA_API_KEY = process.env.GIZA_API_KEY || '';

export const GIZA_DEFAULT_CHAIN = process.env.GIZA_CHAIN || 'ARBITRUM';
export const GIZA_DEFAULT_TOKEN = process.env.GIZA_TOKEN_ADDRESS || process.env.USDC_ADDRESS_ARB || '';

export const GIZA_SUPPORTED_PROTOCOLS = ['aave', 'compound', 'moonwell', 'fluid'] as const;