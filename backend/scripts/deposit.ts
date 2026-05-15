/**
 * scripts/deposit.ts
 *
 * Demonstration script: Deposit USDC into the BondCreditVault contract.
 *
 * The Deposit Flow:
 * ====================
 * 1. User has USDC and has already approved the vault to spend it
 * 2. User calls vault.deposit(amount)
 * 3. Vault's deposit() function:
 *    a. Calls usdc.transferFrom(user, vault, amount)
 *    b. Updates the user's balance in the vault
 *    c. Updates the total deposits counter
 *    d. Emits a Deposited event
 * 4. The backend listener detects the Deposited event
 * 5. Backend stores the deposit in PostgreSQL
 *
 * Before Running This Script:
 * ===========================
 * 1. Run approve-usdc.ts first to grant approval
 * 2. Ensure your .env file has all required variables
 * 3. Ensure you have XDC for gas fees
 *
 * Usage:
 * npm run script:deposit
 *
 * What to Expect:
 * ===============
 * - Script connects to vault contract
 * - Calls deposit() with the amount
 * - Prints transaction hash
 * - Waits for confirmation
 * - Queries the vault to verify your new balance
 */

import * as dotenv from 'dotenv';
import {
  getProvider,
  getWallet,
  getVaultContract,
  getSignableVaultContract,
  getUsdcContract
} from '../src/blockchain';

dotenv.config({ path: '.env' });

// Amount to deposit (in token units)
// For USDC with 6 decimals: 1 USDC = 1_000_000 units
// This example deposits 1 USDC
const AMOUNT_TO_DEPOSIT = 1_000_000n; // BigInt: 1 USDC

async function main() {
  console.log('=== BondCredit USDC Deposit Script ===\n');

  // 1. Validate environment
  const rpcUrl = process.env.XDC_TESTNET_RPC;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const vaultAddress = process.env.VAULT_ADDRESS;
  const usdcAddress = process.env.USDC_ADDRESS;

  if (!rpcUrl || !privateKey || !vaultAddress || !usdcAddress) {
    throw new Error(
      'Missing required environment variables. Check .env file:\n' +
        '- XDC_TESTNET_RPC\n' +
        '- DEPLOYER_PRIVATE_KEY\n' +
        '- VAULT_ADDRESS\n' +
        '- USDC_ADDRESS'
    );
  }

  // 2. Setup provider and wallet
  console.log('Connecting to XDC testnet...');
  const provider = getProvider(rpcUrl);
  const wallet = getWallet(privateKey, provider);
  const walletAddress = wallet.address;

  console.log(`Connected wallet: ${walletAddress}\n`);

  // 3. Get contract instances
  console.log('Fetching vault and USDC contracts...');
  const vaultReadOnly = getVaultContract(provider, vaultAddress);
  const vault = getSignableVaultContract(vaultReadOnly, wallet);

  const usdcReadOnly = getUsdcContract(provider, usdcAddress);

  // 4. Check user's balance in the vault BEFORE deposit
  console.log('Checking vault balance before deposit...');
  let balanceBefore = await vaultReadOnly.getBalance(walletAddress);
  console.log(`Balance in vault: ${balanceBefore.toString()} units\n`);

  // 5. Check USDC balance
  console.log('Checking USDC balance...');
  const usdcBalance = await usdcReadOnly.balanceOf(walletAddress);
  console.log(`Your USDC balance: ${usdcBalance.toString()} units`);

  if (usdcBalance < AMOUNT_TO_DEPOSIT) {
    throw new Error(
      `Insufficient USDC balance. You have ${usdcBalance.toString()}, ` +
        `but want to deposit ${AMOUNT_TO_DEPOSIT.toString()}`
    );
  }

  // 6. Check approval
  console.log('Checking vault allowance...');
  const allowance = await usdcReadOnly.allowance(walletAddress, vaultAddress);
  console.log(`Vault allowance: ${allowance.toString()} units`);

  if (allowance < AMOUNT_TO_DEPOSIT) {
    throw new Error(
      `Insufficient allowance. Vault can spend ${allowance.toString()}, ` +
        `but you want to deposit ${AMOUNT_TO_DEPOSIT.toString()}. ` +
        `Run approve-usdc.ts first.`
    );
  }

  // 7. Call deposit()
  console.log(`\nDepositing ${AMOUNT_TO_DEPOSIT.toString()} units into vault...\n`);

  // This call:
  // 1. Sends the transaction to the vault
  // 2. The vault calls usdc.transferFrom(wallet, vault, amount)
  // 3. The vault updates accounting
  // 4. The vault emits the Deposited event
  // 5. Returns a transaction response (promise)
  const depositTx = await vault.deposit(AMOUNT_TO_DEPOSIT);
  console.log(`Transaction hash: ${depositTx.hash}`);
  console.log('Waiting for confirmation...\n');

  // 8. Wait for confirmation
  const receipt = await depositTx.wait();

  if (receipt?.status === 1) {
    console.log('✓ Deposit successful!\n');
    console.log(`Block number: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}\n`);

    // 9. Query the vault to verify the new balance
    console.log('Verifying new vault balance...');
    const balanceAfter = await vaultReadOnly.getBalance(walletAddress);
    const expectedBalance = balanceBefore + AMOUNT_TO_DEPOSIT;

    console.log(`Balance before: ${balanceBefore.toString()} units`);
    console.log(`Balance after:  ${balanceAfter.toString()} units`);
    console.log(`Expected:       ${expectedBalance.toString()} units\n`);

    if (balanceAfter === expectedBalance) {
      console.log('✓ Balance verified! Deposit was successful on-chain.');
    } else {
      console.warn('⚠ Balance mismatch. This is unusual.');
    }

    // 10. Explain what happened
    console.log('\n--- What Happened On-Chain ---');
    console.log('1. Your USDC was transferred to the vault');
    console.log('2. The vault updated your balance');
    console.log('3. A Deposited event was emitted');
    console.log('4. The backend listener will detect this event');
    console.log('5. The event will be stored in PostgreSQL');
    console.log('6. You can query the deposit via the REST API');
  } else {
    console.error('✗ Deposit transaction failed!');
    console.error('Receipt:', receipt);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});
