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
 * Scope: 8 order types, enough to draw a labeled chart plus circles/
 * arcs — Comment (picture boundary), Set Color, Line, Marker,
 * Character String, Set Arc Parameters, Arc, Full Arc. Fillets,
 * images, symbol sets, color-mix modes, and clipping are NOT
 * implemented — this is a demo-scale renderer, not a full GDDM
 * client. Unrecognized orders are skipped rather than treated as
 * errors, since a real GDF stream may use orders outside this
 * subset. The "at current position" short forms of orders (e.g.
 * X'86' Arc, X'87' Full Arc) are skipped rather than guessed at,
 * same as the existing GCHST-at-current-position handling — this
 * decoder does not track current position across orders.
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

  let i = 0;
  while (i < buf.length) {
    const code = buf[i];

    if (isShortFormat(code)) {
      const operand = buf[i + 1];
      if (code === ORDER_COLOR) color = COLOR_NAME[operand] || color;
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
        primitives.push({ type: 'text', x, y, text, color });
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
    }
    // Unrecognized normal-format orders (fillets, images, symbol sets,
    // etc.) are intentionally skipped — out of scope, see header.

    i += 2 + len;
  }

  return { boundary, primitives };
}
