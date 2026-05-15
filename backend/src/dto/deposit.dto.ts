/**
 * dto/deposit.dto.ts
 *
 * Data Transfer Objects (DTOs) define the shape of data returned by the API.
 * DTOs ensure consistent, well-typed responses.
 *
 * Why DTOs?
 * =========
 * 1. Type safety: The API response structure is defined and enforced
 * 2. Documentation: Developers know what fields to expect
 * 3. Validation: Input validation can be added later
 * 4. Serialization: BigInt values are converted to strings for JSON compatibility
 */

/**
 * DepositResponseDto: A single deposit record as returned by the API.
 *
 * Fields:
 * - id: Unique identifier from the database
 * - walletAddress: The user who made the deposit
 * - amount: The USDC amount as a string (BigInt converted to string for JSON)
 * - txHash: The on-chain transaction hash
 * - blockNumber: The block where the event was emitted (as string)
 * - chain: The blockchain (XDC_TESTNET)
 * - status: Ingestion status (confirmed, pending, failed)
 * - createdAt: When the backend stored this record
 * - updatedAt: Last update timestamp
 */
export class DepositResponseDto {
  id!: string;
  walletAddress!: string;
  amount!: string; // BigInt converted to string
  txHash!: string;
  blockNumber!: string; // BigInt converted to string
  chain!: string;
  status!: string;
  createdAt!: string;
  updatedAt!: string;
}

/**
 * DepositsListResponseDto: Response for listing multiple deposits.
 *
 * Fields:
 * - deposits: Array of DepositResponseDto
 * - total: Total number of deposits across all pages
 * - limit: Number of deposits per page
 * - offset: Current page offset
 */
export class DepositsListResponseDto {
  deposits!: DepositResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

/**
 * VaultTotalResponseDto: Response for vault aggregates.
 *
 * Fields:
 * - totalDeposits: Total USDC deposited across all users (as string)
 * - totalCount: Number of deposit transactions
 * - uniqueWallets: Number of unique users who have deposited
 */
export class VaultTotalResponseDto {
  totalDeposits!: string;
  totalCount!: number;
  uniqueWallets!: number;
}

/**
 * WalletDepositsResponseDto: Response for deposits by a specific wallet.
 *
 * Fields:
 * - wallet: The queried wallet address
 * - deposits: Array of DepositResponseDto for that wallet
 * - totalByWallet: Total USDC deposited by this wallet (as string)
 */
export class WalletDepositsResponseDto {
  wallet!: string;
  deposits!: DepositResponseDto[];
  totalByWallet!: string;
}
