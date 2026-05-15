import { Injectable } from '@nestjs/common';
import { GizaRepository } from '../repositories/giza.repository';

@Injectable()
export class WithdrawService {
  constructor(private readonly gizaRepository: GizaRepository) {}

  requestWithdrawal(params: {
    userPositionId: string;
    gizaPositionId?: string;
    amount?: bigint;
    withdrawalType: 'PARTIAL' | 'FULL';
    requestedBy: string;
  }) {
    return this.gizaRepository.createWithdrawalRequest(params);
  }

  requestReverseTransfer(params: {
    withdrawalRequestId: string;
    recipientAddressXdc: string;
    amount: bigint;
  }) {
    return this.gizaRepository.createReverseCctpTransfer(params);
  }
}