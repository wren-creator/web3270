const TRAFFIC_LOG_MAX = 1000;
export const trafficLog = [];

export function logTraffic(entry) {
  trafficLog.push(entry);
  if (trafficLog.length > TRAFFIC_LOG_MAX) trafficLog.shift();
}
