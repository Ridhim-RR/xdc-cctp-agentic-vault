export class RecordWithdrawalDto {
  userPositionId!: string;
  amount?: string;
  withdrawalType!: 'PARTIAL' | 'FULL';
  requestedBy!: string;
}