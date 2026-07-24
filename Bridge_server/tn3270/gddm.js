/**
 * tn3270/gddm.js
 * ─────────────────────────────────────────────────────────────────
 * Decoder for the GDF (Graphics Data Format) order stream carried
 * inside a 3270 Object Data/Picture structured field (see
 * tn3270/session.js _processWriteStructuredField, sfId 0x0F) when
 * OBJTYP is Graphics. Per the GDDM Base Application Programming
 * Reference, ch.10 "GDF order descriptions" (order codes and operand
 * layouts below cross-checked against GDDM Base Programming
 * Reference Volume 2, SC33-0332-1, Appendix D).
 *
 * Scope: 13 order types, enough to draw a labeled chart plus circles/
 * arcs/fillets, non-default character sets, and monochrome images —
 * Comment (picture boundary), Set Color, Line, Marker, Character
 * String, Set Arc Parameters, Arc, Full Arc, Fillet, Character Set,
 * Begin Image, Image Data, End Image. Color-mix modes and clipping
 * are NOT implemented — this is a demo-scale renderer, not a full
 * GDDM client. Unrecognized orders are skipped rather than treated as
 * errors, since a real GDF stream may use orders outside this subset.
 * The "at current position" short forms of orders (e.g. X'86' Arc,
 * X'87' Full Arc, X'85' Fillet, X'91' Begin Image) are skipped rather
 * than guessed at, same as the existing GCHST-at-current-position
 * handling — this decoder does not track current position across
 * orders.
 *
 * Character Set (X'38') doesn't carry symbol-set glyph data itself —
 * per the 3270 Data Stream Programmer's Reference (GA23-0059), the
 * Object Data structured field's OBJTYP only defines Graphics (X'00')
 * and Image (X'01'); there is no wire format for transmitting a
 * symbol set. In real GDDM a symbol set is a resource the terminal
 * already has (like a built-in font); Character Set just selects one
 * by LCID. This decoder mirrors that: it passes the LCID and the
 * decoded character string through, and leaves glyph lookup to the
 * renderer (see public/js/gddm.js's VECTOR_SYMBOL_SETS).
 */

import * as Ebcdic from './ebcdic.js';

const CP037 = 37;
const toAscii = buf => Ebcdic.toAscii(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), CP037);

const ORDER_COMMENT = 0x01; // GCOMT
const ORDER_COLOR   = 0x0A; // GSCOL — short format
const ORDER_LINE     = 0xC1, ORDER_LINE_CP     = 0x81; // GLINE
const ORDER_MARKER   = 0xC2, ORDER_MARKER_CP   = 0x82; // GMRK
const ORDER_CHARSTR  = 0xC3, ORDER_CHARSTR_CP  = 0x83; // GCHST
const ORDER_ARC_PARAMS = 0x22;                          // GSAP  — Set Arc Parameters
const ORDER_ARC         = 0xC6, ORDER_ARC_CP      = 0x86; // GARC  — three-point arc
const ORDER_FULL_ARC    = 0xC7, ORDER_FULL_ARC_CP = 0x87; // GFARC — full circle/ellipse
const ORDER_FILLET      = 0xC5, ORDER_FILLET_CP    = 0x85; // GFLT  — curved fillet (polyfillet)
const ORDER_CHARSET     = 0x38;                             // GSCS  — Set Character Set, short format
const ORDER_IMAGE_BEGIN = 0xD1, ORDER_IMAGE_BEGIN_CP = 0x91; // GSIMG — Begin Image
const ORDER_IMAGE_DATA  = 0x92;                              // GIMD  — Image Data (one row per order, FORMAT 0)
const ORDER_IMAGE_END   = 0x93;                              // GEIMG — End Image

// Character Set LCID values (GDDM Base Programming Reference, Appendix D,
// "Character set"): X'00' Default, X'01' APL, X'41'-X'DF' user-defined.
const CHARSET_DEFAULT = 0x00;

// Default Arc Parameters (P,Q,R,S): P=Q, R=S=0 maps the unit circle to
// itself — a circle, per the manual's "A circle results if P=Q and
// R=S=0" (Appendix D, "Arc parameters").
const DEFAULT_ARC_PARAMS = { P: 1, Q: 1, R: 0, S: 0 };

// The Full Arc order's Multiplier is an unsigned 8.8 fixed-point value
// — high byte is the integer part, low byte is the fractional part.
function readMultiplier(buf, offset) {
  return buf[offset] + buf[offset + 1] / 256;
}

// Set Color order palette (GDDM Base Application Programming Reference
// ch.10, "Color" section) — a real, documented palette, not invented.
const COLOR_NAME = {
  0x00: 'default', 0x01: 'blue', 0x02: 'red', 0x03: 'pink',
  0x04: 'green', 0x05: 'turquoise', 0x06: 'yellow', 0x07: 'white',
  0x08: 'background',
};

// Is `code` a short-format order? (first nibble < 8, second nibble >= 8 —
// same rule documented for the Wire Inspector's structured-field work.)
function isShortFormat(code) {
  return (code >> 4) < 8 && (code & 0x0F) >= 8;
}

// Reads a sequence of (x,y) 2-byte halfword coordinate pairs from `buf`.
function readCoordPairs(buf) {
  const points = [];
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    const x = buf.readInt16BE(i);
    const y = buf.readInt16BE(i + 2);
    points.push([x, y]);
  }
  return points;
}

/**
 * @param {Buffer} buf — the DATA portion of an Object Data/Picture
 *   structured field (i.e. everything after the OBJTYP byte).
 * @returns {{ boundary: {xL:number,xU:number,yL:number,yU:number}|null,
 *             primitives: Array }}
 */
export function decodeGdfStream(buf) {
  let boundary = null;
  const primitives = [];
  let color = COLOR_NAME[0x00];
  let arcParams = { ...DEFAULT_ARC_PARAMS };
  let charSet = CHARSET_DEFAULT;
  let buildingImage = null; // { x0, y0, width, depth, imageWidth, imageDepth, rows, color } while between Begin/End Image

  let i = 0;
  while (i < buf.length) {
    const code = buf[i];

    if (isShortFormat(code)) {
      const operand = buf[i + 1];
      if (code === ORDER_COLOR) color = COLOR_NAME[operand] || color;
      else if (code === ORDER_CHARSET) charSet = operand;
      i += 2;
      continue;
    }

    // Normal format: order(1) + len(1) + operand(len bytes)
    const len = buf[i + 1];
    if (len === undefined || i + 2 + len > buf.length) break; // truncated
    const operand = buf.slice(i + 2, i + 2 + len);

    if (code === ORDER_COMMENT) {
      // Picture-boundary convention: coordType(2) + xL(2) + xU(2) + yL(2) + yU(2)
      if (operand.length >= 10) {
        boundary = {
          xL: operand.readInt16BE(2), xU: operand.readInt16BE(4),
          yL: operand.readInt16BE(6), yU: operand.readInt16BE(8),
        };
      }
    } else if (code === ORDER_LINE || code === ORDER_LINE_CP) {
      const points = readCoordPairs(operand);
      if (points.length) primitives.push({ type: 'line', points, color });
    } else if (code === ORDER_MARKER || code === ORDER_MARKER_CP) {
      const points = readCoordPairs(operand);
      if (points.length) primitives.push({ type: 'marker', points, color });
    } else if (code === ORDER_CHARSTR || code === ORDER_CHARSTR_CP) {
      if (code === ORDER_CHARSTR) {
        const x = operand.readInt16BE(0), y = operand.readInt16BE(2);
        const text = toAscii(operand.slice(4));
        if (charSet === CHARSET_DEFAULT) primitives.push({ type: 'text', x, y, text, color });
        else primitives.push({ type: 'vtext', x, y, text, charSet, color });
      } else {
        // At-current-position form has no coordinate — nothing to anchor
        // it to without tracking current position, which this demo-scale
        // decoder doesn't model. Skip rather than guess a position.
      }
    } else if (code === ORDER_ARC_PARAMS) {
      // P,Q,R,S: linear map from the unit circle to the target ellipse
      // (x'=Px+Ry, y'=Sx+Qy). Circle when P=Q, R=S=0.
      if (operand.length >= 8) {
        arcParams = {
          P: operand.readInt16BE(0), Q: operand.readInt16BE(2),
          R: operand.readInt16BE(4), S: operand.readInt16BE(6),
        };
      }
    } else if (code === ORDER_ARC) {
      // Three-point arc: start(x0,y0), a point along the arc(x1,y1), end(x2,y2).
      if (operand.length >= 12) {
        const p0 = [operand.readInt16BE(0), operand.readInt16BE(2)];
        const p1 = [operand.readInt16BE(4), operand.readInt16BE(6)];
        const p2 = [operand.readInt16BE(8), operand.readInt16BE(10)];
        primitives.push({ type: 'arc3', p0, p1, p2, arcParams, color });
      }
    } else if (code === ORDER_ARC_CP) {
      // At-current-position form — skipped, see header.
    } else if (code === ORDER_FULL_ARC) {
      // Full circle/ellipse: center(x,y) + Multiplier scaling the
      // current arc-parameter axes (major/minor axis lengths = M*P, M*Q).
      if (operand.length >= 6) {
        const cx = operand.readInt16BE(0), cy = operand.readInt16BE(2);
        const scale = readMultiplier(operand, 4);
        primitives.push({ type: 'fullArc', cx, cy, scale, arcParams, color });
      }
    } else if (code === ORDER_FULL_ARC_CP) {
      // At-current-position form — skipped, see header.
    } else if (code === ORDER_FILLET) {
      // Polyfillet: 2+ points, joined by imaginary straight lines, with
      // a curve fitted tangential to the first/last line at their
      // endpoints and to any intermediate lines at their midpoints
      // (2 points is the special case that degenerates to a straight line).
      const points = readCoordPairs(operand);
      if (points.length >= 2) primitives.push({ type: 'fillet', points, color });
    } else if (code === ORDER_FILLET_CP) {
      // At-current-position form — skipped, see header.
    } else if (code === ORDER_IMAGE_BEGIN) {
      // FORMAT 0 only (1 bit per display point). IMAGEWIDTH/IMAGEDEPTH
      // are optional (present together or not at all) — when absent,
      // each display point is 1 coordinate unit (GDDM Base Programming
      // Reference, Appendix D, "Image - begin").
      if (operand.length >= 10) {
        const x0 = operand.readInt16BE(0), y0 = operand.readInt16BE(2);
        const format = operand.readInt16BE(4);
        const width = operand.readUInt16BE(6), depth = operand.readUInt16BE(8);
        if (format === 0) {
          const hasScale = operand.length >= 14;
          buildingImage = {
            x0, y0, width, depth,
            imageWidth: hasScale ? operand.readInt16BE(10) : width,
            imageDepth: hasScale ? operand.readInt16BE(12) : depth,
            rows: [], color,
          };
        }
      }
    } else if (code === ORDER_IMAGE_BEGIN_CP) {
      // At-current-position form — skipped, see header.
    } else if (code === ORDER_IMAGE_DATA) {
      // One row of WIDTH display points per order, packed 1 bit each,
      // MSB first, padded to a byte boundary. Stored as a plain array,
      // not the Buffer slice itself — decodeGdfStream's result crosses
      // a JSON.stringify/WebSocket boundary (utils/send.js) on its way
      // to the browser, and Buffer serializes there as
      // {type:'Buffer',data:[...]}, silently breaking the renderer's
      // row[c>>3] indexing (every byte read comes back undefined, so
      // every image primitive draws as fully transparent).
      if (buildingImage) buildingImage.rows.push([...operand]);
    } else if (code === ORDER_IMAGE_END) {
      if (buildingImage) {
        primitives.push({ type: 'image', ...buildingImage });
        buildingImage = null;
      }
    }
    // Unrecognized normal-format orders (color-mix, clipping, etc.) are
    // intentionally skipped — out of scope, see header.

    i += 2 + len;
  }

  return { boundary, primitives };
}
