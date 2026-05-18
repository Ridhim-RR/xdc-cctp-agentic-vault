import 'dotenv/config';
import 'reflect-metadata';

/**
 * main.ts
 *
 * The main entry point for the NestJS application.
 *
 * What Happens Here:
 * ===================
 * 1. Create a NestJS application instance
 * 2. Load the AppModule (which loads all services, controllers, listeners)
 * 3. Start listening on a port
 * 4. Log the startup message
 *
 * This is similar to how Express.js or other servers start,
 * but with automatic dependency injection and module organization.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Create the NestJS application
  // AppModule brings in all controllers, services, and listeners
  const app = await NestFactory.create(AppModule);

  // Enable CORS (Cross-Origin Resource Sharing) for frontend requests
  app.enableCors();

  // Get the port from environment or use default 3001
  const port = process.env.BACKEND_PORT || 3001;

  // Start listening for HTTP requests
  await app.listen(port);

  console.log(`========================================`);
  console.log(`BondCredit Backend Started`);
  console.log(`========================================`);
  console.log(`Listening on http://localhost:${port}`);
  console.log(`Deposit listener running in background`);
  console.log(`API endpoints:`);
  console.log(`  GET /deposits/:wallet - Deposits by wallet`);
  console.log(`  GET /deposits - All deposits (paginated)`);
  console.log(`  GET /vault/total - Vault statistics`);
  console.log(`  GET /health - Health check`);
  console.log(`========================================\n`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
