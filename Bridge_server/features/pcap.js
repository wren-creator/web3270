// Raw TN3270 wire-byte capture, replayed as a synthetic Ethernet/IPv4/TCP
// stream so the result opens directly in Wireshark (Decode As → TN3270).

const CAPTURE_MAX_BYTES = 10 * 1024 * 1024; // per session

const captures = new Map(); // wsId -> { host, port, bytes, frames: [{ ts, dir, data }] }

export function captureRaw(wsId, host, port, dir, data) {
  let cap = captures.get(wsId);
  if (!cap) {
    cap = { host, port, bytes: 0, frames: [] };
    captures.set(wsId, cap);
  }
  if (cap.bytes >= CAPTURE_MAX_BYTES) return;
  cap.frames.push({ ts: Date.now(), dir, data });
  cap.bytes += data.length;
}

export function clearCaptures() {
  captures.clear();
}

// Read-only accessor for the wire inspector: returns [{wsId, host, port, frames}]
// for every session with captured traffic (or just the requested wsId).
export function getCaptures(wsId = null) {
  const ids = wsId != null ? [wsId] : [...captures.keys()];
  return ids
    .filter(id => captures.has(id))
    .map(id => ({ wsId: id, ...captures.get(id) }));
}

// ── PCAP framing ────────────────────────────────────────────────────

function ipChecksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) sum += (i + 1 < buf.length) ? buf.readUInt16BE(i) : (buf[i] << 8);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return (~sum) & 0xffff;
}

function tcpChecksum(srcIp, dstIp, tcpSegment) {
  const pseudo = Buffer.alloc(12);
  srcIp.copy(pseudo, 0);
  dstIp.copy(pseudo, 4);
  pseudo[9] = 6; // TCP protocol
  pseudo.writeUInt16BE(tcpSegment.length, 10);
  return ipChecksum(Buffer.concat([pseudo, tcpSegment]));
}

function sessionIps(wsId) {
  const octet = wsId % 250;
  return {
    client: Buffer.from([10, 0, octet, 1]),
    server: Buffer.from([10, 0, octet, 2]),
  };
}

function buildEthIpTcp({ srcIp, dstIp, srcPort, dstPort, seq, ack, flags, payload, ipId }) {
  const tcp = Buffer.alloc(20 + payload.length);
  tcp.writeUInt16BE(srcPort, 0);
  tcp.writeUInt16BE(dstPort, 2);
  tcp.writeUInt32BE(seq >>> 0, 4);
  tcp.writeUInt32BE(ack >>> 0, 8);
  tcp[12] = 5 << 4; // data offset, no options
  tcp[13] = flags;
  tcp.writeUInt16BE(64240, 14); // window
  tcp.writeUInt16BE(0, 16); // checksum placeholder
  tcp.writeUInt16BE(0, 18); // urgent pointer
  payload.copy(tcp, 20);
  tcp.writeUInt16BE(tcpChecksum(srcIp, dstIp, tcp), 16);

  const ip = Buffer.alloc(20);
  ip[0] = 0x45; // version 4, header length 5 words
  ip[1] = 0; // DSCP/ECN
  ip.writeUInt16BE(20 + tcp.length, 2); // total length
  ip.writeUInt16BE(ipId & 0xffff, 4);
  ip.writeUInt16BE(0x4000, 6); // flags: don't fragment
  ip[8] = 64; // TTL
  ip[9] = 6; // protocol: TCP
  ip.writeUInt16BE(0, 10); // checksum placeholder
  srcIp.copy(ip, 12);
  dstIp.copy(ip, 16);
  ip.writeUInt16BE(ipChecksum(ip), 10);

  const eth = Buffer.alloc(14);
  eth.writeUInt8(0x02, 0); eth.writeUInt8(0x00, 5); // dst mac 02:00:00:00:00:00
  eth[6] = 0x02; eth[11] = 0x01; // src mac 02:00:00:00:00:01
  eth.writeUInt16BE(0x0800, 12); // IPv4

  return Buffer.concat([eth, ip, tcp]);
}

function pcapRecord(tsMs, packet) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(Math.floor(tsMs / 1000), 0);
  header.writeUInt32LE((tsMs % 1000) * 1000, 4);
  header.writeUInt32LE(packet.length, 8);
  header.writeUInt32LE(packet.length, 12);
  return Buffer.concat([header, packet]);
}

function pcapGlobalHeader() {
  const h = Buffer.alloc(24);
  h.writeUInt32LE(0xa1b2c3d4, 0); // magic (microsecond resolution)
  h.writeUInt16LE(2, 4);  // version major
  h.writeUInt16LE(4, 6);  // version minor
  h.writeInt32LE(0, 8);   // thiszone
  h.writeUInt32LE(0, 12); // sigfigs
  h.writeUInt32LE(65535, 16); // snaplen
  h.writeUInt32LE(1, 20); // network: Ethernet
  return h;
}

// Builds one pcap Buffer covering the given wsIds (all captured sessions if omitted).
export function buildPcap(wsIds = null) {
  const ids = wsIds || [...captures.keys()];
  const records = [];

  for (const wsId of ids) {
    const cap = captures.get(wsId);
    if (!cap || cap.frames.length === 0) continue;

    const { client, server } = sessionIps(wsId);
    const clientPort = 40000 + (wsId % 20000);
    const serverPort = cap.port || 23;

    let clientSeq = 1000, serverSeq = 5000, ipId = 1;
    const firstTs = cap.frames[0].ts - 3;

    // Synthetic three-way handshake so the stream reassembles cleanly.
    records.push({ ts: firstTs, pkt: buildEthIpTcp({ srcIp: client, dstIp: server, srcPort: clientPort, dstPort: serverPort, seq: clientSeq, ack: 0, flags: 0x02, payload: Buffer.alloc(0), ipId: ipId++ }) });
    clientSeq += 1;
    records.push({ ts: firstTs + 1, pkt: buildEthIpTcp({ srcIp: server, dstIp: client, srcPort: serverPort, dstPort: clientPort, seq: serverSeq, ack: clientSeq, flags: 0x12, payload: Buffer.alloc(0), ipId: ipId++ }) });
    serverSeq += 1;
    records.push({ ts: firstTs + 2, pkt: buildEthIpTcp({ srcIp: client, dstIp: server, srcPort: clientPort, dstPort: serverPort, seq: clientSeq, ack: serverSeq, flags: 0x10, payload: Buffer.alloc(0), ipId: ipId++ }) });

    for (const frame of cap.frames) {
      if (frame.data.length === 0) continue;
      const outbound = frame.dir === 'sent'; // client(bridge) → server(host)
      const pkt = outbound
        ? buildEthIpTcp({ srcIp: client, dstIp: server, srcPort: clientPort, dstPort: serverPort, seq: clientSeq, ack: serverSeq, flags: 0x18, payload: frame.data, ipId: ipId++ })
        : buildEthIpTcp({ srcIp: server, dstIp: client, srcPort: serverPort, dstPort: clientPort, seq: serverSeq, ack: clientSeq, flags: 0x18, payload: frame.data, ipId: ipId++ });
      if (outbound) clientSeq += frame.data.length;
      else serverSeq += frame.data.length;
      records.push({ ts: frame.ts, pkt });
    }
  }

  records.sort((a, b) => a.ts - b.ts);
  return Buffer.concat([pcapGlobalHeader(), ...records.map(r => pcapRecord(r.ts, r.pkt))]);
}
