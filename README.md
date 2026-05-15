# BondCredit Monorepo

BondCredit is a full-stack cross-chain finance project with a Next.js frontend and a NestJS backend. The current implementation focuses on the XDC testnet deposit flow, with supporting backend services for deposit indexing, transfer state management, and a CCTP-oriented orchestration layer.

## What’s Included

- `frontend/` - Next.js 15 app for wallet connection, USDC approval, deposits, and deposit history
- `backend/` - NestJS 10 API and blockchain services for deposit tracking, vault interaction, and transfer orchestration
- `prisma/` - Database schema and seed data for the backend
- `contracts/` - Solidity smart contracts and deployment artifacts in the backend
- Project docs for architecture, environment configuration, testing, and implementation notes

## Project Goals

- Let users connect a wallet on XDC testnet
- Approve USDC spending for the vault contract
- Deposit USDC into the vault
- Index deposit events off-chain in PostgreSQL
- Provide API endpoints for querying deposits and vault totals
- Support a broader cross-chain transfer workflow in the backend

## Repository Layout

```text
.
├── frontend/        # Next.js client app
├── backend/         # NestJS API, blockchain services, Prisma schema, Hardhat contracts
├── CCTP_*.md        # Architecture, environment, and testing documentation
├── INSTALLATION_GUIDE.sh
└── PROJECT_SUMMARY.md
```

## Tech Stack

### Frontend
- Next.js 15
- React 18
- TypeScript
- Tailwind CSS
- Wagmi
- RainbowKit
- viem
- ethers

### Backend
- NestJS
- TypeScript
- Prisma
- PostgreSQL
- Hardhat
- ethers v6
- BullMQ
- ioredis

### Smart Contracts
- Solidity
- OpenZeppelin
- XDC testnet deployment workflow

## Prerequisites

- Node.js 18+ or newer
- npm
- PostgreSQL
- Redis for queue processing
- A wallet with XDC testnet funds and test USDC
- Access to XDC testnet RPC endpoints

## Quick Start

### 1. Clone and install

Install dependencies separately for each app:

```bash
cd backend
npm install

cd ../frontend
npm install
```

### 2. Configure environment variables

Create `.env` files for the backend and frontend using the templates and the environment guide in this repo.

### 3. Run the backend

```bash
cd backend
npm run dev
```

### 4. Run the frontend

```bash
cd frontend
npm run dev
```

The frontend typically runs on `http://localhost:3000` and the backend on `http://localhost:3001`.

## Backend

The backend is a NestJS application that listens for deposit events, stores them in PostgreSQL, and exposes REST endpoints for querying deposit data. It also contains the blockchain abstraction layer and CCTP workflow services.

### Backend scripts

From `backend/`:

```bash
npm run dev           # Start NestJS in watch mode
npm run build         # Build the backend
npm run start         # Start the compiled backend
npm run compile       # Compile Solidity contracts with Hardhat
npm run deploy        # Deploy the vault contract to XDC testnet
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
npm run script:approve
npm run script:deposit
```

### Backend endpoints

- `GET /deposits/:wallet` - Deposits for a specific wallet
- `GET /deposits` - Paginated list of deposits
- `GET /vault/total` - Aggregate vault statistics
- `GET /health` - Listener and backend health status

### Backend architecture summary

- `src/blockchain/` handles providers, wallets, contracts, and blockchain config
- `src/listeners/` watches for on-chain deposit events
- `src/services/` contains deposit business logic
- `src/controllers/` exposes REST APIs
- `src/cctp/` contains burn, attestation, mint, and orchestration services
- `src/transfers/` manages transfer state and audit logs
- `src/queues/` contains BullMQ worker and queue wiring
- `prisma/` stores the database schema and seed scripts

## Frontend

The frontend is a wallet-enabled Next.js application that lets users connect a wallet, approve USDC, deposit into the vault, and inspect deposit history.

### Frontend scripts

From `frontend/`:

```bash
npm run dev
npm run build
npm run start
npm run lint
```

### Frontend features

- Wallet connection via RainbowKit
- XDC testnet chain guard
- USDC approval flow
- Vault deposit flow
- Wallet-specific deposit history
- Backend API integration for deposit queries

### Frontend architecture summary

- `app/` contains the Next.js routes and global layout
- `components/` contains UI, wallet, deposit, and transaction status components
- `hooks/` contains the approval, deposit, and wallet state logic
- `services/` contains backend API calls
- `contracts/` stores contract addresses and ABIs
- `config/` stores chain and Wagmi configuration
- `utils/` contains formatting and Web3 error helpers

## Environment Variables

### Backend

Common backend variables include:

- `BACKEND_PORT` - HTTP server port, default `3001`
- `XDC_TESTNET_RPC` - RPC URL for XDC testnet
- `ARB_TESTNET_RPC` - RPC URL for Arbitrum testnet, if used by cross-chain services
- `DEPLOYER_PRIVATE_KEY` - Backend signer private key
- `VAULT_ADDRESS` - Deployed vault contract address
- `USDC_ADDRESS` - USDC token address on XDC
- `USDC_ADDRESS_XDC` - Alternate USDC address field used by some services
- `USDC_ADDRESS_ARB` - USDC address on Arbitrum
- `TOKENM_ADDRESS_XDC` - TokenMessenger address on XDC
- `MSGTX_ADDRESS_ARB` - MessageTransmitter address on Arbitrum
- `REDIS_URL` - Redis connection string for BullMQ
- `DATABASE_URL` - PostgreSQL connection string

Useful optional variables:

- `LISTENER_BLOCK_LOOKBACK` - How far back the listener replays events
- `LISTENER_POLL_INTERVAL` - Polling interval for missed events
- `XDC_CONFIRMATIONS_REQUIRED` - Confirmation depth for vault bridge actions
- `ARB_CONFIRMATIONS_REQUIRED` - Confirmation depth for Arbitrum transactions
- `ARB_DOMAIN_ID` - Circle CCTP destination domain identifier
- `ATTESTATION_MAX_RETRIES` - Maximum Circle attestation retries
- `CIRCLE_IRIS_API_URL` - Circle IRIS attestation API URL
- `CIRCLE_IRIS_API_KEY` - Optional Circle API key

### Frontend

- `NEXT_PUBLIC_BACKEND_URL` - Base URL of the backend API
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` - WalletConnect project ID
- `NEXT_PUBLIC_XDC_RPC_URL` - Public RPC used for receipt polling in the deposit hook

## Database

The backend uses Prisma with PostgreSQL. The deposit flow stores and queries data through Prisma models for:

- Deposits
- Cross-chain transfers
- Transfer logs
- CCTP burn records
- Giza-related portfolio and withdrawal records

Use `npm run prisma:migrate` from `backend/` after updating the schema.

## Smart Contracts

The backend includes Hardhat support for compiling and deploying the vault contract. The deployment and interaction scripts are in `backend/scripts/`.

Common commands:

```bash
cd backend
npm run compile
npm run deploy
npm run script:approve
npm run script:deposit
```

## Testing and Validation

Recommended docs in this repo:

- `CCTP_TESTING_GUIDE.md`
- `CCTP_ENV_CONFIGURATION.md`
- `CCTP_ARCHITECTURE.md`
- `CCTP_DEEP_CONCEPTS.md`

If you want to validate the basic user flow locally, start the backend, start the frontend, connect a wallet on XDC testnet, approve USDC, and submit a deposit. Then verify the deposit appears through the frontend history and the backend API.

## Common Troubleshooting

- If the frontend says the wallet is on the wrong network, switch to XDC testnet.
- If approval or deposit fails, confirm the wallet has test USDC and gas on XDC testnet.
- If deposit history is empty, check that the backend is running and that `NEXT_PUBLIC_BACKEND_URL` points to the correct port.
- If the backend cannot start, check `DATABASE_URL`, `REDIS_URL`, `XDC_TESTNET_RPC`, and `DEPLOYER_PRIVATE_KEY`.
- If event indexing looks stale, check the deposit listener logs and the listener lookback configuration.

## Current Scope

The user-facing flow is centered on XDC testnet deposits. The backend also contains broader CCTP, transfer-state, queue, and yield/Giza scaffolding for future expansion.

## Contributing

- Keep backend and frontend changes aligned with the monorepo structure
- Update the relevant environment docs when adding new variables
- Prefer small, focused changes that preserve the current deposit flow
- Document any new scripts, routes, or contracts in this README

## License

No license file is present in this repository snapshot. Add one if the project is intended for external distribution.
