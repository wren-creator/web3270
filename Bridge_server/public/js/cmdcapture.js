// Reads the text of the input field the cursor is in, for the command history.
// Pure, so it is tested without a browser.
//
// The 3270 path decides protection from the field attribute byte (bit 0x20).
// That is wrong on 5250, where the byte in the cell is a display attribute
// (0x20 is plain green) and protection lives in the field format word. Nearly
// every 5250 attribute has 0x20 set, so every field read as protected and no
// command was ever recorded. 5250 uses the bridge's `fields` list instead,
// which already carries protected, nondisplay and the host's field length.
const FA_PROTECTED = 0x20;

function cellText(cells) {
  return cells.map(c => (c && c.char && c.char !== '\x00') ? c.char : ' ').join('').trimEnd();
}

function fromFields(screen, row, col) {
  const cols = screen.cols || 80;
  const total = screen.rows.length * cols;
  const addr = row * cols + col;
  const fields = screen.fields;
  let fi = -1;
  for (let i = 0; i < fields.length; i++) { if (fields[i].startAddr <= addr) fi = i; else break; }
  if (fi === -1) return null;
  const f = fields[fi];
  if (f.protected || f.nondisplay || f.startAddr === addr) return null;
  const dataStart = f.startAddr + 1;
  let end = (fields[fi + 1] ? fields[fi + 1].startAddr : total) - 1;
  if (f.length > 0) end = Math.min(end, dataStart + f.length - 1);
  const cells = [];
  for (let a = dataStart; a <= end; a++) cells.push(screen.rows[Math.floor(a / cols)]?.[a % cols]);
  if (cells.some(c => c && c.nondisplay)) return null;
  return cellText(cells);
}

function fromAttributeBytes(screen, row, col) {
  const rows = screen.rows;
  const cmdRow = rows[row];
  if (!cmdRow) return null;
  // Walk backward from the cursor, crossing rows, to the FA byte that opens the
  // field. A 3270 field starting at col 0 has its FA at the end of the row above.
  let fieldStart = 0;
  let unprotected = null;
  outer: for (let ri = row; ri >= 0; ri--) {
    const r = rows[ri] || [];
    const startCol = (ri === row) ? col : r.length - 1;
    for (let ci = startCol; ci >= 0; ci--) {
      if (r[ci] && r[ci].fa !== undefined) {
        unprotected = !(r[ci].fa & FA_PROTECTED);
        if (ri === row) fieldStart = ci + 1;
        break outer;
      }
    }
  }
  if (!unprotected) return null;
  let fieldEnd = cmdRow.length;
  for (let i = fieldStart; i < cmdRow.length; i++) {
    if (cmdRow[i] && cmdRow[i].fa !== undefined) { fieldEnd = i; break; }
  }
  const cells = cmdRow.slice(fieldStart, fieldEnd);
  if (cells.some(c => c && c.nondisplay)) return null;
  return cellText(cells);
}

// Returns the field's text, or null for a protected or password field.
export function captureCommand(screen, row, col, is5250) {
  if (!screen || !screen.rows) return null;
  if (is5250 && screen.fields) return fromFields(screen, row, col);
  return fromAttributeBytes(screen, row, col);
}
