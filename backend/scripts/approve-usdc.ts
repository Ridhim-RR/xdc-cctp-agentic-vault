/**
 * scripts/approve-usdc.ts
 *
 * Demonstration script: Approve the vault contract to spend USDC on your behalf.
 *
 * Why Approval is Needed:
 * =======================
 * ERC20 tokens like USDC use a two-step process to transfer tokens:
 *
 * Step 1: approve()
 * ─────────────────
 * You call token.approve(vaultAddress, amount)
 * This grants the vault permission to transfer UP TO 'amount' tokens from your account.
 * Think of it like giving a trusted friend a limited-amount gift card.
 *
 * Step 2: transferFrom()
 * ──────────────────────
 * The vault contract calls token.transferFrom(yourAddress, vaultAddress, amount)
 * This actually transfers the tokens from your account into the vault.
 *
 * Why this two-step flow?
 * - Security: You choose which addresses can spend your tokens and how much
 * - Atomic transactions: The approval doesn't move money; only transferFrom does
 * - Undo-able: You can approve 0 to revoke permissions
 *
 * Before Running This Script:
 * ===========================
 * 1. Ensure your .env file has:
 *    - DEPLOYER_PRIVATE_KEY (your wallet's private key)
 *    - XDC_TESTNET_RPC (RPC URL for XDC testnet)
 *    - USDC_ADDRESS (USDC token address on XDC testnet)
 *    - VAULT_ADDRESS (deployed BondCreditVault address)
 *
 * 2. Your wallet must have USDC tokens on XDC testnet
 *    (Get test USDC from a faucet or swap testnet gas for it)
 *
 * 3. Your wallet must have XDC tokens for gas fees
 *    (Get test XDC from a faucet)
 *
 * Usage:
 * npm run script:approve
 *
 * What to Expect:
 * ===============
 * - Script connects to USDC contract
 * - Calls approve() to grant permission
 * - Prints transaction hash
 * - Prints confirmation when done
 * - You can then call deposit()
 */

import * as dotenv from 'dotenv';
import { getProvider, getWallet, getUsdcContract, getSignableUsdcContract } from '../src/blockchain';

// Load environment variables from .env file
dotenv.config({ path: '.env' });

// Define the amount to approve (in token units)
// For USDC with 6 decimals: 1 USDC = 1_000_000 units
// This example approves 10 USDC
const AMOUNT_TO_APPROVE = 10_000_000n; // BigInt: 10 USDC

async function main() {
  console.log('=== BondCredit USDC Approval Script ===\n');

  // 1. Validate environment variables
  const rpcUrl = process.env.XDC_TESTNET_RPC;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const usdcAddress = process.env.USDC_ADDRESS;
  const vaultAddress = process.env.VAULT_ADDRESS;

  if (!rpcUrl || !privateKey || !usdcAddress || !vaultAddress) {
    throw new Error(
      'Missing required environment variables. Check .env file:\n' +
        '- XDC_TESTNET_RPC\n' +
        '- DEPLOYER_PRIVATE_KEY\n' +
        '- USDC_ADDRESS\n' +
        '- VAULT_ADDRESS'
    );
  }

  // 2. Setup provider and wallet
  console.log('Connecting to XDC testnet...');
  const provider = getProvider(rpcUrl);
  const wallet = getWallet(privateKey, provider);
  const walletAddress = wallet.address;

  console.log(`Connected wallet: ${walletAddress}\n`);

  // 3. Get USDC contract instance (read-only)
  console.log('Fetching USDC contract...');
  const usdcReadOnly = getUsdcContract(provider, usdcAddress);

  // 4. Connect wallet so we can sign transactions
  const usdc = getSignableUsdcContract(usdcReadOnly, wallet);

  // 5. Check current balance
  console.log('Checking USDC balance...');
  const balance = await usdcReadOnly.balanceOf(walletAddress);
  console.log(`Your USDC balance: ${balance.toString()} units\n`);

  if (balance < AMOUNT_TO_APPROVE) {
    console.warn(
      `Warning: Your balance (${balance.toString()}) is less than the approval amount (${AMOUNT_TO_APPROVE.toString()})`
    );
    console.warn('You may not have enough USDC to deposit after approval.\n');
  }

  // 6. Check current allowance
  console.log('Checking current allowance...');
  const currentAllowance = await usdcReadOnly.allowance(walletAddress, vaultAddress);
  console.log(`Current vault allowance: ${currentAllowance.toString()} units\n`);

  if (currentAllowance >= AMOUNT_TO_APPROVE) {
    console.log('✓ Vault already has sufficient allowance. No approval needed.');
    return;
  }

  // 7. Send the approve transaction
  console.log(`Approving vault to spend ${AMOUNT_TO_APPROVE.toString()} USDC units...`);
  console.log(`Vault address: ${vaultAddress}\n`);

  const approveTx = await usdc.approve(vaultAddress, AMOUNT_TO_APPROVE);
  console.log(`Transaction hash: ${approveTx.hash}`);
  console.log('Waiting for confirmation...\n');

  // 8. Wait for transaction confirmation
  // In ethers v6, waitForTransaction is replaced with wait()
  const receipt = await approveTx.wait();

  if (receipt?.status === 1) {
    console.log('✓ Approval successful!\n');
    console.log(`Block number: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    // 9. Verify the allowance was updated
    console.log('\nVerifying new allowance...');
    const newAllowance = await usdcReadOnly.allowance(walletAddress, vaultAddress);
    console.log(`New vault allowance: ${newAllowance.toString()} units`);

    if (newAllowance >= AMOUNT_TO_APPROVE) {
      console.log('\n✓ Approval confirmed on-chain!');
      console.log('You can now call deposit() to deposit USDC into the vault.');
    }
  } else {
    console.error('✗ Approval transaction failed!');
    console.error('Receipt:', receipt);
  }
}

// Run the script
main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});
