/**
 * notifications/smtp-email.js
 * ─────────────────────────────────────────────────────────────────
 * Email delivery for post-login email verification, via plain SMTP.
 * Same relay approach as stock-alarm-service (ForwardEmail.net or
 * equivalent — whatever SMTP_HOST is configured to).
 *
 * Fail-closed: missing config throws rather than silently no-op'ing.
 */

import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD) {
    throw new Error('SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD are not configured — refusing to send email.');
  }

  const port = parseInt(SMTP_PORT || '465', 10);
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
  });
  return transporter;
}

export async function sendEmail(to, subject, text) {
  const from = process.env.SMTP_FROM_EMAIL;
  if (!from) {
    throw new Error('SMTP_FROM_EMAIL is not configured — refusing to send email.');
  }
  await getTransporter().sendMail({ from, to, subject, text });
}
