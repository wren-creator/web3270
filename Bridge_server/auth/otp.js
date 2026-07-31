/**
 * auth/otp.js
 * ─────────────────────────────────────────────────────────────────
 * 6-digit verification codes, shared shape for phone signup OTP and
 * the generic email/password-reset verification_codes table.
 */

import { randomInt } from 'crypto';

export function generateOtp() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

export function otpExpiry(minutesFromNow = 10) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000);
}

export function isExpired(expiresAt) {
  return new Date(expiresAt).getTime() < Date.now();
}
