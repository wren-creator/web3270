// Collects the input fields the user changed, as the bridge's `key` message
// wants them: [{ addr, data }]. Pure, so it is tested without a browser.
//
// A field ends where the host said it does (`length`, sent by 5250 hosts), or
// at the next field when there is no length (3270). Running to the next field
// alone is wrong on a real IBM i: PUB400's sign-on has no attribute between the
// user field and the next row's label, so the user ID went out with
// "Password (max. 128):" glued on the end and the host refused it.
export function collectModifiedFields(screen) {
  if (!screen || !screen.rows || !screen.fields) return [];
  const cols = screen.cols || 80;
  const rows = screen.rows;
  const fields = screen.fields;
  const result = [];
  for (let fi = 0; fi < fields.length; fi++) {
    const f = fields[fi]; if (f.protected) continue;
    const dataStart = f.startAddr + 1;
    const nextFa = fields[fi + 1] ? fields[fi + 1].startAddr : (rows.length * cols);
    let dataEnd = nextFa - 1;
    if (f.length > 0) dataEnd = Math.min(dataEnd, dataStart + f.length - 1);
    let data = ''; let hasModified = false;
    for (let addr = dataStart; addr <= dataEnd; addr++) {
      const r = Math.floor(addr / cols); const c = addr % cols;
      const cell = rows[r] && rows[r][c];
      if (!cell) { data += ' '; continue; }
      const ch = (cell.char && cell.char !== '\x00') ? cell.char : ' ';
      data += ch; if (cell.modified) hasModified = true;
    }
    if (hasModified) result.push({ addr: dataStart, data: data.trimEnd() });
  }
  return result;
}
