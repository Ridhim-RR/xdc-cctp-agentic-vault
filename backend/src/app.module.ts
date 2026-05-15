/**
 * app.module.ts
 *
 * The root NestJS module that wires all dependencies together.
 *
 * Module Pattern in NestJS:
 * ==========================
 * A module is a class decorated with @Module().
 * It declares:
 * - providers: Services that can be injected
 * - controllers: HTTP route handlers
 * - imports: Other modules to use
 * - exports: Services to expose to other modules
 *
 * The app.module is the entry point that brings everything together.
 */

import { Module } from '@nestjs/common';
import { DepositsService } from './services/deposits.service';
import { DepositEventsListener } from './listeners/deposit-events.listener';
import { DepositsController } from './controllers/deposits.controller';
import { VaultBridgeService } from './vault/vault-bridge.service';
import { TransfersModule } from './transfers/transfers.module';
import { CctpModule } from './cctp/cctp.module';
import { GizaModule } from './giza/giza.module';

@Module({
  imports: [TransfersModule, CctpModule, GizaModule],
  // Controllers: handle HTTP requests
  controllers: [DepositsController],

  // Providers: services and other injectable classes
  providers: [
    // DepositsService: handles database operations
    DepositsService,

    // DepositEventsListener: blockchain event listener
    // It automatically starts when the module initializes (onModuleInit)
    DepositEventsListener,
    VaultBridgeService,
  ],

  // Exports: services to expose to other modules (if any)
  exports: [DepositsService, DepositEventsListener, VaultBridgeService]
})
export class AppModule {}
