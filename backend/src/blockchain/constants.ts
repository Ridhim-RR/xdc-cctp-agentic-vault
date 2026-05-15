/**
 * blockchain/constants.ts
 *
 * Stores ABI fragments for interacting with the vault contract and USDC token.
 * These are minimal ABIs that only include the functions and events needed for the deposit flow.
 *
 * ABI = Application Binary Interface
 * It tells ethers.js how to encode/decode function calls and events on the blockchain.
 */

/**
 * BondCreditVault ABI fragment
 * Only includes functions and events needed for Phase 1 deposits:
 * - deposit(uint256 amount): Function to deposit USDC
 * - Deposited(address indexed user, uint256 amount): Event emitted on deposit
 * - getBalance(address user): Function to read a user's deposited balance
 *
 * The "indexed" keyword on the user parameter means:
 * - The backend can filter events by user address very quickly
 * - It's stored in a separate field in the blockchain log, not in the data payload
 */
export const VAULT_ABI = [
  // deposit function: Accepts an amount parameter (uint256)
  // When called, transfers USDC from the user to the vault and updates accounting
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'deposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },

  // withdraw function: Accepts an amount parameter (uint256)
  // When called, transfers USDC back to the user from the vault
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },

  // transferToBridgeWallet: owner-only vault custody handoff for backend bridge orchestration
  {
    inputs: [
      { internalType: 'address', name: 'bridgeWallet', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'transferToBridgeWallet',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },

  // getBalance function: Query the deposited amount for a specific user
  // Returns a uint256: the balance amount
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getBalance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },

  // Deposited event: Emitted whenever a user deposits USDC
  // Parameters:
  // - user (indexed): The wallet address of the depositor
  // - amount (not indexed): The USDC amount deposited
  //
  // The "indexed" keyword on user allows efficient filtering by wallet
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'Deposited',
    type: 'event'
  },

  // Withdrawn event: Emitted whenever a user withdraws USDC
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'Withdrawn',
    type: 'event'
  },

  // BridgeTransferInitiated event: emitted when vault sends USDC to the bridge wallet
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'bridgeWallet', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'BridgeTransferInitiated',
    type: 'event'
  }
];

/**
 * ERC20 ABI fragment (standard for USDC and other ERC20 tokens)
 * Includes:
 * - approve(): Grants the vault permission to transfer tokens on behalf of the user
 * - balanceOf(): Checks a user's USDC balance
 * - allowance(): Checks how much the vault is allowed to spend
 * - Transfer event: Emitted when tokens move between accounts
 * - Approval event: Emitted when approve() is called
 *
 * Note: This is a simplified ABI for learning purposes.
 * In production, you'd typically use the full token contract ABI.
 */
export const ERC20_ABI = [
  // approve: Grant approval to a spender (the vault) to transfer a specific amount
  // Returns true if successful, false otherwise
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },

  // balanceOf: Check the USDC balance of an account
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },

  // allowance: Check how much a spender (vault) is allowed to transfer on behalf of an owner
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },

  // Transfer event: Emitted when tokens move from one account to another
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'from', type: 'address' },
      { indexed: true, internalType: 'address', name: 'to', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'value', type: 'uint256' }
    ],
    name: 'Transfer',
    type: 'event'
  },

  // Approval event: Emitted when approve() is called
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: true, internalType: 'address', name: 'spender', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'value', type: 'uint256' }
    ],
    name: 'Approval',
    type: 'event'
  }
];
