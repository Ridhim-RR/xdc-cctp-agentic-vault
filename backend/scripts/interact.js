require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

/**
 * Example interaction script using ethers v6 style (Node.js).
 * - Demonstrates approve -> deposit -> getBalance -> withdraw flows.
 * - This script assumes you have a deployed BondCreditVault and a USDC token.
 *
 * Usage:
 * 1) Set .env with XDC_TESTNET_RPC, DEPLOYER_PRIVATE_KEY, VAULT_ADDRESS, USDC_ADDRESS
 * 2) node scripts/interact.js
 */

const RPC = process.env.XDC_TESTNET_RPC;
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

if (!RPC || !DEPLOYER_KEY || !VAULT_ADDRESS || !USDC_ADDRESS) {
  console.error('Please set XDC_TESTNET_RPC, DEPLOYER_PRIVATE_KEY, VAULT_ADDRESS and USDC_ADDRESS in .env');
  process.exit(1);
}

// Minimal ERC20 ABI fragments needed for approve/transferFrom/transfer
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Vault ABI fragments we need
const VAULT_ABI = [
  'function deposit(uint256 amount) external',
  'function withdraw(uint256 amount) external',
  'function getBalance(address user) external view returns (uint256)',
  'event Deposited(address indexed user, uint256 amount)',
  'event Withdrawn(address indexed user, uint256 amount)'
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

  // Example amount: 1 USDC with 6 decimals (adjust decimals to match token)
  const amount = 1_000_000n; // 1 * 10^6 (if USDC has 6 decimals)

  console.log('Wallet address:', await wallet.getAddress());
  console.log('Approving vault to spend', amount.toString(), 'USDC...');

  const approveTx = await usdc.approve(VAULT_ADDRESS, amount);
  console.log('Approve tx hash:', approveTx.hash);
  await approveTx.wait();
  console.log('Approve confirmed. Calling deposit...');

  const depositTx = await vault.deposit(amount);
  console.log('Deposit tx hash:', depositTx.hash);
  await depositTx.wait();
  console.log('Deposit confirmed. Querying balance...');

  const bal = await vault.getBalance(await wallet.getAddress());
  console.log('Vault balance (user):', bal.toString());

  console.log('Withdrawing', amount.toString(), 'USDC...');
  const withdrawTx = await vault.withdraw(amount);
  console.log('Withdraw tx hash:', withdrawTx.hash);
  await withdrawTx.wait();
  console.log('Withdraw confirmed.');

  const balAfter = await vault.getBalance(await wallet.getAddress());
  console.log('Vault balance after withdraw:', balAfter.toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
