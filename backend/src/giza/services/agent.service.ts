import { Injectable } from '@nestjs/common';
import { GizaAgentActivationRequest } from '../interfaces/giza.interfaces';
import { GizaService } from './giza.service';

@Injectable()
export class AgentService {
  constructor(private readonly gizaService: GizaService) {}

  createAgent(walletAddress: string) {
    return this.gizaService.createAgent(walletAddress);
  }

  getAgent(walletAddress: string) {
    return this.gizaService.getAgent(walletAddress);
  }

  activateAgent(request: GizaAgentActivationRequest) {
    return this.gizaService.activateAgent(request);
  }
}