import { parsePhoneNumberWithError } from 'libphonenumber-js';

/**
 * Normalizes a user-entered phone number to E.164 (e.g. "+15555550100").
 * Throws if the number can't be parsed as valid — callers should treat
 * that as a 400, not attempt to send SMS to an unnormalized string.
 */
export function normalizePhone(raw, defaultCountry = 'US') {
  let parsed;
  try {
    parsed = parsePhoneNumberWithError(raw, defaultCountry);
  } catch {
    throw new Error(`"${raw}" is not a valid phone number`);
  }
  if (!parsed.isValid()) {
    throw new Error(`"${raw}" is not a valid phone number`);
  }
  return parsed.number;
}
