import { ok, err, type Result } from '../types/result.js';

export const safeJsonParse = (text: string): Result<unknown, string> => {
  try {
    return ok(JSON.parse(text));
  } catch {
    return err(`No se pudo parsear como JSON: ${text.slice(0, 100)}`);
  }
};