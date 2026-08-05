import { none, some } from './option.js';
import type { Option } from './option.js';

export type ErrorCategory = 'transient' | 'invalid' | 'refused' | 'client' | 'unknown';

export type NeriumError = {
  category: ErrorCategory;
  code: string;
  provider: string;
  status: Option<number>;
  message: string;
  raw: Option<unknown>;
};

const isNeriumErrorObj = (e: unknown): e is Record<string, unknown> =>
  typeof e === 'object' && e !== null && 'category' in e && 'code' in e && 'message' in e;

const normalizeObjectError = (e: unknown, provider: string): Option<NeriumError> => {
  if (isNeriumErrorObj(e)) {
    const ne = e as NeriumError; // sadist-exception: error-normalization-guard
    return some(ne.provider === '' ? { ...ne, provider } : ne);
  }
  return none;
};

const normalizeJsError = (e: Error, provider: string): NeriumError => {
  const isAbort = e.name === 'AbortError';
  return {
    category: isAbort ? 'client' : 'unknown',
    code: isAbort ? 'aborted' : e.name || 'error',
    provider,
    status: none,
    message: e.message,
    raw: some(e),
  };
};

export const normalizeError = (e: unknown, provider: string): NeriumError => {
  const objErr = normalizeObjectError(e, provider);
  if (objErr.some) return objErr.value;
  if (e instanceof Error) return normalizeJsError(e, provider);
  return { category: 'unknown', code: 'unknown_error', provider, status: none, message: String(e), raw: some(e) };
};