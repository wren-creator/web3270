export function handleFuzz(msg, ws, wsId, session, send, logger) {
  const fuzzBuf = Buffer.from((msg.rawBytes || []).map(b => b & 0xFF));
  if (!fuzzBuf.length) {
    send(ws, { type: 'sec.fuzz.result', label: msg.label, response: 'error', detail: 'empty payload' });
    return;
  }

  const fuzzTimeout = Math.min(msg.timeoutMs || 3000, 10000);
  let fuzzDone = false;

  const onFuzzScreen = () => {
    if (fuzzDone) return;
    fuzzDone = true;
    clearTimeout(fuzzTimer);
    session.removeListener('disconnected', onFuzzDisconnect);
    send(ws, { type: 'sec.fuzz.result', label: msg.label, rawBytes: msg.rawBytes, response: 'screen' });
  };
  const onFuzzDisconnect = () => {
    if (fuzzDone) return;
    fuzzDone = true;
    clearTimeout(fuzzTimer);
    session.removeListener('screen', onFuzzScreen);
    send(ws, { type: 'sec.fuzz.result', label: msg.label, rawBytes: msg.rawBytes, response: 'disconnect' });
  };
  const fuzzTimer = setTimeout(() => {
    if (fuzzDone) return;
    fuzzDone = true;
    session.removeListener('screen', onFuzzScreen);
    session.removeListener('disconnected', onFuzzDisconnect);
    send(ws, { type: 'sec.fuzz.result', label: msg.label, rawBytes: msg.rawBytes, response: 'no-response' });
  }, fuzzTimeout);

  session.once('screen', onFuzzScreen);
  session.once('disconnected', onFuzzDisconnect);

  try {
    // Telnet-layer negotiation fuzzing (z/TPF Handshake Fuzzer's negotiation
    // cases) bypasses the 3270 data-record framing entirely — a raw IAC
    // sequence is never going to arrive wrapped the way a real AID record is.
    if (msg.telnet) session.sendRawTelnet(fuzzBuf);
    else session.sendRawAid(fuzzBuf);
  } catch (err) {
    fuzzDone = true;
    clearTimeout(fuzzTimer);
    session.removeListener('screen', onFuzzScreen);
    session.removeListener('disconnected', onFuzzDisconnect);
    send(ws, { type: 'sec.fuzz.result', label: msg.label, rawBytes: msg.rawBytes, response: 'error', detail: err.message });
  }
}
