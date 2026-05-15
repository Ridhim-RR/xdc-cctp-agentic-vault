/**
 * BLOCKCHAIN MODULE
 * 
 * NestJS Module that provides blockchain infrastructure
 * Exports: Provider, Signer, Contracts services
 * 
 * WHY A MODULE:
 * - Organized scope for related services
 * - Services exported and available to other modules
 * - Shared single instances (singletons)
 * 
 * HOW OTHER MODULES USE IT:
 * import { BlockchainModule } from './blockchain/blockchain.module';
 * 
 * @Module({
 *   imports: [BlockchainModule],
 *   providers: [MyService],
 * })
 * export class MyModule {}
 * 
 * Now in MyService:
 * constructor(private readonly contractsService: BlockchainContractsService) {}
 * 
 * NestJS automatically provides the service (dependency injection)
 */

import { Module } from '@nestjs/common';
import { BlockchainProviderService } from './provider.service';
import { BlockchainSignerService } from './signer.service';
import { BlockchainContractsService } from './contracts.service';
import { BlockchainConfigService } from './config.service';

@Module({
  providers: [
    BlockchainConfigService,
    BlockchainProviderService,
    BlockchainSignerService,
    BlockchainContractsService,
  ],
  exports: [
    BlockchainConfigService,
    BlockchainProviderService,
    BlockchainSignerService,
    BlockchainContractsService,
  ],
})
export class BlockchainModule {}
