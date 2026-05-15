# BondCredit Backend - Phase 1 Deposit Flow

Welcome to the BondCredit backend! This project implements Phase 1 of a DeFi vault system on the XDC blockchain testnet.

## What This Project Does

This backend:
1. Listens for USDC deposits into the BondCreditVault contract
2. Stores deposits in PostgreSQL
3. Exposes REST APIs to query deposits
4. Includes scripts to approve USDC and deposit funds
5. Tracks blockchain events off-chain for fast querying

## The Complete Deposit Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Wallet                              │
│  (Has test USDC and test XDC on XDC testnet)                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │  USDC.approve()        │
        │ Grants vault permission│
        │ to spend user's USDC   │
        └────────────┬───────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │  Vault.deposit()       │
        │ Transfers USDC to vault│
        │ Updates balances       │
        │ Emits Deposited event  │
        └────────────┬───────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│                  XDC Blockchain Testnet                         │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ Deposited(address user, uint256 amount)                 │  │
│ │ emitted with:                                            │  │
│ │ - user = 0x8975897f736fc85b0a17d79d1ab61e91e2b95680    │  │
│ │ - amount = 1000000 (1 USDC)                             │  │
│ │ - txHash = 0x123abc...                                  │  │
│ │ - blockNumber = 5234890                                 │  │
│ └──────────────────────────────────────────────────────────┘  │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│              Backend Event Listener (Node.js)                   │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ 1. Polls blockchain every 12 seconds                    │  │
│ │ 2. Detects Deposited event                              │  │
│ │ 3. Decodes event parameters                             │  │
│ │ 4. Prevents duplicates (checks txHash uniqueness)       │  │
│ │ 5. Stores deposit in database                           │  │
│ └──────────────────────────────────────────────────────────┘  │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│                   PostgreSQL Database                           │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ Deposit Table:                                           │  │
│ │ id: "abc123"                                             │  │
│ │ walletAddress: "0x8975897f..."                           │  │
│ │ amount: 1000000                                          │  │
│ │ txHash: "0x123abc..." (unique)                           │  │
│ │ blockNumber: 5234890                                    │  │
│ │ chain: "XDC_TESTNET"                                    │  │
│ │ status: "confirmed"                                     │  │
│ │ createdAt: 2026-05-13T10:30:00Z                        │  │
│ │ updatedAt: 2026-05-13T10:30:00Z                        │  │
│ └──────────────────────────────────────────────────────────┘  │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│                     REST API (NestJS)                           │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ GET /deposits/0x8975897f... → returns user's deposits   │  │
│ │ GET /deposits?offset=0&limit=10 → paginated list        │  │
│ │ GET /vault/total → aggregate statistics                 │  │
│ │ GET /health → backend and listener status               │  │
│ └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
backend/
├── src/
│   ├── blockchain/           # Ethers v6 setup and ABI constants
│   │   ├── constants.ts      # Vault and USDC ABI definitions
│   │   ├── provider.ts       # RPC provider setup
│   │   ├── contracts.ts      # Contract instance creation
│   │   ├── wallet.ts         # Wallet/Signer setup
│   │   └── index.ts          # Re-exports for clean imports
│   │
│   ├── services/             # Business logic
│   │   └── deposits.service.ts # Database operations
│   │
│   ├── listeners/            # Event indexing
│   │   └── deposit-events.listener.ts # Blockchain event listener
│   │
│   ├── controllers/          # HTTP endpoints
│   │   └── deposits.controller.ts # REST API routes
│   │
│   ├── dto/                  # Data Transfer Objects
│   │   └── deposit.dto.ts    # Response shapes
│   │
│   ├── app.module.ts         # Root NestJS module
│   └── main.ts               # Application entry point
│
├── scripts/
│   ├── approve-usdc.ts       # Approve script for user
│   └── deposit.ts            # Deposit script for user
│
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Database migrations
│
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
├── nest-cli.json             # NestJS config
└── .env.example              # Environment template
```

## Key Concepts Explained

### 1. Provider vs Signer

**Provider** = Read-only connection to blockchain
- Query account balances
- Get contract data
- Listen to events
- Estimate gas
- No private key

**Signer** = Provider + Private Key
- Can sign transactions
- Can send transactions (state changes)
- Proves you own an account
- The wallet

Example:
```typescript
// Provider (read-only)
const provider = new JsonRpcProvider(rpcUrl);
const balance = await provider.getBalance(address);

// Signer (can send transactions)
const wallet = new Wallet(privateKey, provider);
const tx = await vault.connect(wallet).deposit(amount);
```

### 2. Approval Flow (ERC20)

**Why two steps?**

USDC is an ERC20 token, which uses a two-step transfer model:

```
Step 1: approve()
├─ You call: USDC.approve(vaultAddress, amount)
├─ Effect: Vault can now spend UP TO 'amount' tokens on your behalf
├─ Like: Giving a friend a $10 gift card (limited spending power)
└─ No money moves yet

Step 2: transferFrom()
├─ Vault calls: USDC.transferFrom(yourAddress, vaultAddress, amount)
├─ Effect: Transfers UP TO 'amount' tokens from you to vault
├─ Like: Your friend uses the $10 gift card
└─ Money actually moves now
```

**Why this design?**
- Security: You control who can spend your tokens and how much
- Revocable: You can call `approve(vaultAddress, 0)` to remove permission
- Atomic: The approval doesn't move money; the transfer does
- Standard: This is how ALL ERC20 tokens work

### 3. Smart Contract State vs Off-Chain Mirroring

**On-Chain (Vault Contract):**
- `balances[user]` = authoritative state
- `totalDeposits` = real value
- Events = cryptographically secured history

**Off-Chain (Backend Database):**
- Mirrors on-chain state for fast queries
- NOT the source of truth
- Can be rebuilt by replaying events
- Allows filtering, pagination, aggregation

**Why both?**
- Blockchain is slow and expensive to query
- Database is fast for searches
- Blockchain is immutable; database is efficient

### 4. Event Listening & Indexing

**The Problem:**
- Blockchain events are hard to query
- You can't easily ask "get all deposits by user X"
- Events are just transaction logs

**The Solution:**
- Listen for events off-chain
- Decode event parameters
- Store in database
- Build fast query indexes

**How it works:**
```
1. Listener queries: "Give me events from block 5000000 to 5000100"
2. RPC returns: [Event1, Event2, Event3]
3. Listener decodes: { user: "0x...", amount: 1000000 }
4. Listener stores: INSERT INTO deposits VALUES (...)
5. API queries: SELECT * FROM deposits WHERE wallet = "0x..."
```

### 5. Duplicate Protection

**The Problem:**
- If the listener crashes and restarts, it might process the same event twice
- This would create duplicate deposits in the database

**The Solution:**
```
txHash is UNIQUE in the database
├─ Each transaction has a unique hash
├─ We store it in the Deposit table
├─ Database prevents duplicates automatically
└─ If we try to insert the same txHash: constraint violation → skip it
```

### 6. Block Reorganizations ("Reorgs")

**What is a reorg?**
- Blockchain miners can reorganize blocks (rare but happens)
- A deposit might appear in block 5000100, then get removed
- We need to handle this gracefully

**How Phase 1 handles it:**
- We store blockNumber with each deposit
- In future phases: track last known safe block, re-query on reorg

### 7. Why Events are Better Than Polling

**Polling (Less Efficient):**
```
While(true) {
  Call contract.getBalance(user) every 10 seconds
  // Lots of RPC calls, slow
}
```

**Events (More Efficient):**
```
Listen to Deposited event
When fired:
  Decode parameters
  Store immediately
  // One RPC call per deposit
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn
- XDC testnet RPC access
- Test USDC and XDC on testnet

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Set up environment
cp .env.example .env
# Edit .env with your values
```

### Database Setup

```bash
# Run Prisma migrations
npm run prisma:migrate

# Open Prisma Studio to view data
npm run prisma:studio
```

### Start the Backend

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

### Test the Approval Flow

```bash
# In a new terminal
npm run script:approve
```

Expected output:
```
=== BondCredit USDC Approval Script ===

Connecting to XDC testnet...
Connected wallet: 0x8975897f...

Fetching USDC contract...
Checking USDC balance...
Your USDC balance: 10000000 units

Approving vault to spend 10000000 USDC units...
Transaction hash: 0x123abc...
Waiting for confirmation...

✓ Approval successful!

Block number: 5234890
Gas used: 46123

Verifying new allowance...
New vault allowance: 10000000 units

✓ Approval confirmed on-chain!
You can now call deposit() to deposit USDC into the vault.
```

### Test the Deposit Flow

```bash
npm run script:deposit
```

Expected output:
```
=== BondCredit USDC Deposit Script ===

Connecting to XDC testnet...
Connected wallet: 0x8975897f...

Fetching vault and USDC contracts...
Checking vault balance before deposit...
Balance in vault: 0 units

Checking USDC balance...
Your USDC balance: 10000000 units

Checking vault allowance...
Vault allowance: 10000000 units

Depositing 1000000 units into vault...

Transaction hash: 0xabc123...
Waiting for confirmation...

✓ Deposit successful!

Block number: 5234901
Gas used: 89234

Verifying new vault balance...
Balance before: 0 units
Balance after:  1000000 units
Expected:       1000000 units

✓ Balance verified! Deposit was successful on-chain.

--- What Happened On-Chain ---
1. Your USDC was transferred to the vault
2. The vault updated your balance
3. A Deposited event was emitted
4. The backend listener will detect this event
5. The event will be stored in PostgreSQL
6. You can query the deposit via the REST API
```

### Verify the Backend Listener

The listener automatically starts when you start the backend. Check the logs:

```
[Listener] Initializing deposit events listener...
[Listener] Connecting to XDC testnet...
[Listener] Last processed block: 5234901
[Listener] Starting real-time event listener...
[Listener] Querying events from block 5235001 to 5235100
[Listener] Found 1 Deposited events
[Listener] Stored deposit: 0x8975897f... deposited 1000000 units (tx: 0xabc123...)
```

### Query the API

In another terminal:

```bash
# Get health status
curl http://localhost:3001/health

# Get deposits for a wallet
curl "http://localhost:3001/deposits/0x8975897f736fc85b0a17d79d1ab61e91e2b95680"

# Get all deposits (paginated)
curl "http://localhost:3001/deposits?offset=0&limit=10"

# Get vault totals
curl http://localhost:3001/vault/total
```

Example responses:

```json
{
  "wallet": "0x8975897f736fc85b0a17d79d1ab61e91e2b95680",
  "deposits": [
    {
      "id": "abc123",
      "walletAddress": "0x8975897f736fc85b0a17d79d1ab61e91e2b95680",
      "amount": "1000000",
      "txHash": "0xabc123...",
      "blockNumber": "5234901",
      "chain": "XDC_TESTNET",
      "status": "confirmed",
      "createdAt": "2026-05-13T10:30:00Z",
      "updatedAt": "2026-05-13T10:30:00Z"
    }
  ],
  "totalByWallet": "1000000"
}
```

```json
{
  "totalDeposits": "1000000",
  "totalCount": 1,
  "uniqueWallets": 1
}
```

```json
{
  "backend": "ok",
  "listener": {
    "isListening": true,
    "lastProcessedBlock": "5234901",
    "rpcConnected": true
  },
  "timestamp": "2026-05-13T10:35:00Z"
}
```

## Production Considerations

### 1. Idempotency

**Problem:** Event listener crashes after processing event but before database commit

**Solution:** Store txHash, use it as unique key

**Code:**
```typescript
await this.prisma.deposit.create({
  data: {
    txHash: eventTxHash,  // Unique
    ...
  }
});
// If it crashes here, re-running gets "unique constraint" error
// We detect this and skip (idempotent)
```

### 2. Chain Reorganizations

**Problem:** Block gets removed, event disappears

**Solution (Phase 2):**
- Track "safe finality"
- Only consider deposits after N confirmations
- Re-scan on reorg detection

### 3. RPC Reliability

**Problem:** RPC node goes down, blocks our queries

**Solutions:**
- Implement retry with backoff
- Use multiple RPC endpoints
- Add circuit breaker pattern
- Graceful degradation

Example retry logic:
```typescript
async function queryWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await sleep(1000 * Math.pow(2, i)); // Exponential backoff
    }
  }
}
```

### 4. Database Connection Pooling

For production, configure connection pooling:
```
DATABASE_URL=postgresql://user:pass@host/db?max_pool_size=20
```

### 5. Graceful Shutdown

When the server shuts down:
```typescript
process.on('SIGTERM', async () => {
  listener.stop();
  await db.disconnect();
  process.exit(0);
});
```

### 6. Monitoring

For production, add:
- **Logs:** Structure logs with timestamp, level, context
- **Metrics:** Track listener lag, database size, API response times
- **Alerts:** Alert on listener crashes, RPC failures, database issues
- **Dashboards:** Monitor in real-time with Grafana or Datadog

## Troubleshooting

### Listener not detecting events

**Check:**
1. Backend is running: `curl http://localhost:3001/health`
2. VAULT_ADDRESS is correct in .env
3. RPC is working: `curl -X POST https://51.rpc.thirdweb.com -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
4. Events are being emitted: check XDCScan explorer for Deposited events

### Database connection errors

**Check:**
1. PostgreSQL is running
2. DATABASE_URL is correct
3. Database exists: `psql -l`
4. Migrations have run: `npm run prisma:migrate`

### "txHash already exists" errors

This is normal! It means:
- Event was processed twice (listener restarted)
- Duplicate protection working correctly
- Check logs for `[Deposits] Skipped duplicate event`

### Private key not working

**Check:**
1. Format: Should be 64 hex chars with or without 0x prefix
2. Matches wallet address: `node -e "const {Wallet} = require('ethers'); console.log(new Wallet('0x...').address)"`
3. Testnet funds: `curl "https://51.rpc.thirdweb.com" -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x...","latest"],"id":1}'`

## Next Steps (Phase 2+)

- Add withdrawals
- Implement yield strategies
- Add CCTP for cross-chain deposits
- Add authentication/authorization
- Add frontend UI
- Add unit/integration tests
- Add monitoring and alerting
- Deploy on mainnet

## Resources

- [XDC Blockchain Documentation](https://docs.xdc.community/)
- [Ethers.js v6 Documentation](https://docs.ethers.org/v6/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [ERC20 Token Standard](https://ethereum.org/en/developers/docs/standards/tokens/erc-20/)

## Support

For issues or questions:
1. Check the logs: `cat logs/backend.log`
2. Check XDCScan: https://apothem.xdcscan.com/
3. Review the code comments
4. Check the troubleshooting section above
