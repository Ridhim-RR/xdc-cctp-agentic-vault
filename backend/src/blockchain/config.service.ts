import { Injectable } from '@nestjs/common';

@Injectable()
export class BlockchainConfigService {
  getXdcRpcUrl(): string {
    const value = process.env.XDC_TESTNET_RPC;
    if (!value) {
      throw new Error('XDC_TESTNET_RPC not configured');
    }
    return value;
  }

  getDeployerPrivateKey(): string {
    const value = process.env.DEPLOYER_PRIVATE_KEY;
    if (!value) {
      throw new Error('DEPLOYER_PRIVATE_KEY not configured');
    }
    return value;
  }

  getVaultAddress(): string {
    const value = process.env.VAULT_ADDRESS;
    if (!value) {
      throw new Error('VAULT_ADDRESS not configured');
    }
    return value;
  }

  getUsdcAddress(): string {
    const value = process.env.USDC_ADDRESS || process.env.USDC_ADDRESS_XDC;
    if (!value) {
      throw new Error('USDC_ADDRESS not configured');
    }
    return value;
  }
}
