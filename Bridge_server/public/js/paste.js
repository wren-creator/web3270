// Pure helpers for pasting into the green screen, tested without a browser.
//
// A 3270 has no newline character, and a pasted block must never fire Enter
// by accident, so line breaks are stripped rather than turned into keys.
// Anything outside printable ASCII is dropped too: a smart quote or emoji has
// no EBCDIC slot and would only reach the host as garbage.
export function cleanPaste(text) {
  return String(text ?? '')
    .replace(/[\r\n]+/g, '')
    .replace(/\t/g, ' ')
    .replace(/[^\x20-\x7E]/g, '');
}

// How many characters fit from (row, col) to the end of the unprotected field
// the cursor is in. 0 when the cursor is on a protected field or an attribute
// byte, the same way a real keyboard would lock. An unformatted screen has no
// fields, so it runs to the end of the buffer.
export function pasteRoom(screen, row, col) {
  if (!screen || !screen.rows) return 0;
  const cols = screen.cols || 80;
  const total = screen.rows.length * cols;
  const addr = row * cols + col;
  const fields = screen.fields;
  if (!fields || fields.length === 0) return Math.max(0, total - addr);
  let fi = -1;
  for (let i = 0; i < fields.length; i++) { if (fields[i].startAddr <= addr) fi = i; else break; }
  const wrapped = fi === -1;
  if (wrapped) fi = fields.length - 1;            // before the first FA: wraps into the last field
  const f = fields[fi];
  if (f.protected || f.startAddr === addr) return 0;
  if (wrapped) return Math.max(0, fields[0].startAddr - addr);
  const dataStart = f.startAddr + 1;
  let end = (fields[fi + 1] ? fields[fi + 1].startAddr : total) - 1;
  if (f.length > 0) end = Math.min(end, dataStart + f.length - 1);
  return Math.max(0, end - addr + 1);
}
