import { match } from 'ts-pattern';
import type { ErrorCategory } from '../types/error.js';

export const categorizeByStatus = (status: number): ErrorCategory =>
  match(status)
    .with(401, () => 'invalid' as const)
    .with(403, () => 'invalid' as const)
    .with(429, () => 'transient' as const)
    .when((s) => s >= 500, () => 'transient' as const)
    .with(400, () => 'invalid' as const)
    // sadist-exception: status is the full HTTP number domain — not enumerable exhaustively.
    .otherwise(() => 'unknown' as const);