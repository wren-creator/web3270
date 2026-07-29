/**
 * mock-lpar/rpg/dds.js
 * ─────────────────────────────────────────────────────────────────
 * Minimal DDS parser for WORKSTN display files, scoped to what the
 * mock-as400 RPG interpreter needs: record formats, constants, and
 * named input/output fields, plus record-level CFnn/CAnn (command
 * key -> response indicator) keywords and field-level indicator
 * conditioning.
 *
 * Column positions are IBM's documented DDS-for-display-files layout
 * (verified against the DDS Reference: Display Files manual during
 * this session, not reconstructed from memory):
 *   6      Form type ('A')
 *   7      Comment marker ('*') -- rest of line is comment text
 *   7-16   Indicator conditioning (this parser reads one N?nn pair)
 *   17     'R' starts a record format; blank = field/constant line
 *   19-28  Name (record format name, field name, or blank = constant)
 *   30-34  Length
 *   35     Data type
 *   36-37  Decimal positions
 *   38     Usage (O=output, I=input, B=both)
 *   39-41  Line (screen row, 1-based)
 *   42-44  Position (screen column, 1-based)
 *   45-80  Keywords, or the quoted literal for a constant
 *
 * Not supported (not needed by the v1 game content, and not worth
 * the added complexity): OR'd/multi-line ANDed indicator conditions,
 * subfiles, window/keyword continuation lines.
 */

'use strict';

function col(line, a, b) {
  return (line.slice(a - 1, b) || '').trim();
}

function parseIndicators(line) {
  const raw = line.slice(6, 16); // columns 7-16, 0-indexed slice
  const m = /(N?)(\d{2})/.exec(raw);
  if (!m) return [];
  return [{ not: m[1] === 'N', num: m[2] }];
}

// Parses "CF03(03) DSPATR(HI)" into [{name:'CF03', params:['03']}, ...].
function parseKeywords(text) {
  const out = [];
  const re = /([A-Z0-9]+)(\(([^)]*)\))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1], params: m[3] ? m[3].split(/\s+/) : [] });
  }
  return out;
}

function parseDds(source) {
  const formats = {};
  let current = null;

  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.length < 6) continue;
    if (line[5] !== 'A') continue; // column 6
    if (line[6] === '*') continue; // column 7: comment

    const isRecord = col(line, 17, 17) === 'R';
    const name = col(line, 19, 28);
    const keywordArea = line.length >= 45 ? line.slice(44) : '';

    if (isRecord) {
      current = { name, fields: [], keys: {} };
      formats[name] = current;
      for (const kw of parseKeywords(keywordArea)) {
        const m = /^C[AF](\d{2})$/.exec(kw.name);
        if (m && kw.params[0]) current.keys[`F${parseInt(m[1], 10)}`] = kw.params[0];
      }
      continue;
    }

    if (!current) continue; // stray field line before any R spec

    const lineNo = col(line, 39, 41);
    const posNo = col(line, 42, 44);
    if (!lineNo || !posNo) continue; // not a locatable field/constant line

    const row = parseInt(lineNo, 10) - 1; // convert to 0-indexed, matching buildScreen()
    const dcol = parseInt(posNo, 10) - 1;
    const indicators = parseIndicators(line);

    if (!name) {
      // Constant: literal text quoted somewhere in the keyword area.
      const m = /'([^']*)'/.exec(keywordArea);
      current.fields.push({ kind: 'const', row, col: dcol, text: m ? m[1] : '', indicators });
      continue;
    }

    const length = col(line, 30, 34);
    const dtype = col(line, 35, 35);
    const dec = col(line, 36, 37);
    const usage = col(line, 38, 38);
    current.fields.push({
      kind: 'field',
      name,
      row, col: dcol,
      length: length ? parseInt(length, 10) : 0,
      dtype: dtype || (dec ? 'N' : 'A'),
      dec: dec ? parseInt(dec, 10) : null,
      usage: usage || 'O', // O=output, I=input, B=both
      indicators,
    });
  }

  return { formats };
}

module.exports = { parseDds };
