/**
 * mock-lpar/rpg/rpgle.js
 * ─────────────────────────────────────────────────────────────────
 * Fixed-form RPG IV tokenizer, scoped to the F/D/C-spec subset the
 * mock-as400 interpreter supports (see interpreter.js's header for
 * the exact opcode list). This module only tokenizes columns into
 * spec records in source order -- control-flow resolution (matching
 * IF/ELSE/ENDIF, DOW/ENDDO, SELECT/WHEN/OTHER/ENDSL, BEGSR/ENDSR)
 * happens in interpreter.js's compile step.
 *
 * Column positions are IBM's documented fixed-form layout (verified
 * against the ILE RPG Language Reference, SC09-2508, during this
 * session, not reconstructed from memory):
 *   F-spec: 7-16 name, 17 type, 18 designation, 19 EOF, 20 addition,
 *           21 sequence, 22 format, 23-27 record length, 36-42 device,
 *           44-80 keywords.
 *   D-spec: 7-21 name, 22 external desc, 23 DS type, 24-25 definition
 *           type, 26-32 from position, 33-39 to position/length,
 *           40 internal data type, 41-42 decimal positions,
 *           44-80 keywords.
 *   C-spec: 7-8 control level, 9-11 indicators, 12-25 factor 1,
 *           26-35 opcode, 36-80 factor 2 / extended factor 2 (this
 *           parser always reads 36-80 as one field -- every opcode
 *           this interpreter supports either leaves it blank, holds
 *           a bare name (EXSR/EXFMT/BEGSR target), or holds an
 *           extended-factor-2 expression).
 */

'use strict';

function col(line, a, b) {
  return (line.slice(a - 1, b) || '').trim();
}

function parseRpgle(source) {
  const file = { name: null, device: null, format: null };
  const dspecs = [];
  const statements = [];

  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.length < 6) continue;
    const specType = line[5]; // column 6
    if (specType === '*') continue; // comment line

    if (specType === 'F') {
      file.name = col(line, 7, 16);
      file.type = col(line, 17, 17);
      file.designation = col(line, 18, 18);
      file.format = col(line, 22, 22);
      file.device = col(line, 36, 42);
      continue;
    }

    if (specType === 'D') {
      const name = col(line, 7, 21);
      if (!name) continue;
      const deftype = col(line, 24, 25);
      const length = col(line, 33, 39);
      const dec = col(line, 41, 42);
      const keywords = line.length >= 44 ? line.slice(43).trim() : '';
      let init = null;
      const m = /INZ\(([^)]*)\)/i.exec(keywords);
      if (m) init = m[1].trim();
      dspecs.push({
        name,
        deftype,
        length: length ? parseInt(length, 10) : 0,
        // Blank decimal positions (real RPG default rule) means a
        // character field; a real "0" entry means numeric with zero
        // decimals -- so this must stay null, not collapse to 0, or
        // the interpreter can't tell the two cases apart.
        dec: dec === '' ? null : parseInt(dec, 10),
        init,
      });
      continue;
    }

    if (specType === 'C') {
      const indic = col(line, 9, 11);
      const factor1 = col(line, 12, 25);
      const opcode = col(line, 26, 35).toUpperCase();
      if (!opcode) continue;
      // Extended factor 2 (EVAL/IF/DOW/WHEN): free-form expression, 36-80.
      const expr = line.length >= 36 ? line.slice(35).trim() : '';
      // Classic factor 2 / result (DIV/MVR and any other traditional
      // fixed-column op): 36-49 and 50-63, read separately since they
      // aren't whitespace-delimited from each other in a reliable way.
      const factor2 = col(line, 36, 49);
      const result = col(line, 50, 63);
      statements.push({
        op: opcode, indic: indic || null, factor1: factor1 || null,
        expr: expr || null, factor2: factor2 || null, result: result || null,
      });
      continue;
    }
    // H-spec and other spec types: not needed for v1, ignored.
  }

  return { file, dspecs, statements };
}

module.exports = { parseRpgle };
