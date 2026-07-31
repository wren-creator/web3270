/**
 * notifications/telnyx-sms.js
 * ─────────────────────────────────────────────────────────────────
 * SMS delivery for phone-verification OTPs, via Telnyx's messaging API.
 * Same provider stock-alarm-service uses (migrated off Twilio 2026-07-27).
 *
 * Fail-closed: missing config throws rather than silently no-op'ing,
 * matching routes/macro-run.js's "unset means refuse, not open" rule.
 */

export async function sendSms(to, body) {
  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!apiKey || !from) {
    throw new Error('TELNYX_API_KEY/TELNYX_FROM_NUMBER are not configured — refusing to send SMS.');
  }

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, text: body }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Telnyx SMS send failed: ${res.status} ${errBody}`);
  }
}
