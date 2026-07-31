import type { Option } from './option.js';

export type ErrorCategory = 'transient' | 'invalid' | 'refused' | 'client' | 'unknown';

export type NeriumError = {
  category: ErrorCategory;
  code: string;
  provider: string;
  status: Option<number>;
  message: string;
  raw: unknown;
};