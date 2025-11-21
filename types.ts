import { GroundingChunk } from '@google/genai';

export enum Role {
  USER = 'user',
  MODEL = 'model',
}

export interface ChatMessage {
  role: Role;
  text: string;
  groundingChunks?: GroundingChunk[];
}

export enum ConnectionState {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
  ERROR,
}