// Shared types and constants for eval scripts

export interface TestResult {
  questionId: string;
  model: string;
  question: string;
  answer: string;
  passed: boolean;
  failureType: FailureType;
  reasons: string[];
  toolCalls: number;
  durationMs: number;
  error?: string;
}

export type FailureType =
  | 'PASS'
  | 'WRONG_ANSWER'
  | 'SQL_ERROR'
  | 'LOOP'
  | 'TIMEOUT'
  | 'CLARIFICATION'
  | 'DATA_UNAVAILABLE';

export const ANSI = {
  BOLD: '\x1b[1m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m',
  DIM: '\x1b[2m',
} as const;
