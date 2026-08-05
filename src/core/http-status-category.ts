import type { ErrorCategory } from '../types/error.js';

const isTransientStatus = (s: number): boolean => s === 408 || s === 429 || s === 504 || s >= 500;
const isInvalidStatus = (s: number): boolean => s === 401 || s === 403 || s === 404 || s === 422 || s === 400;

export const categorizeByStatus = (status: number): ErrorCategory => {
  if (isTransientStatus(status)) return 'transient';
  if (isInvalidStatus(status)) return 'invalid';
  if (status === 402) return 'refused';
  return 'unknown';
};