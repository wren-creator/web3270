import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Per-account on-disk storage root for the hosted (multiTenant)
 * deployment — macros/accounts/<hex(email)>/. Hex-encoded rather than
 * used raw so nothing about an email's characters has to be trusted
 * as filesystem-safe.
 */
export function accountMacroDir(email) {
  const safe = Buffer.from(email.toLowerCase()).toString('hex');
  return path.join(__dirname, '..', 'macros', 'accounts', safe);
}
