const TRAFFIC_LOG_MAX = 1000;
export const trafficLog = [];

export function logTraffic(entry) {
  trafficLog.push(entry);
  if (trafficLog.length > TRAFFIC_LOG_MAX) trafficLog.shift();
}

// wsIds omitted clears everything (single-tenant/unscoped); passed,
// removes only that set's entries — same "don't wipe other
// customers' data" reasoning as features/pcap.js's clearCaptures.
export function clearTraffic(wsIds = null) {
  if (wsIds == null) { trafficLog.length = 0; return; }
  const idSet = new Set(wsIds);
  for (let i = trafficLog.length - 1; i >= 0; i--) {
    if (idSet.has(trafficLog[i].wsId)) trafficLog.splice(i, 1);
  }
}
