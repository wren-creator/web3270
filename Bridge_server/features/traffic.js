'use strict';

const TRAFFIC_LOG_MAX = 1000;
const trafficLog = [];

function logTraffic(entry) {
  trafficLog.push(entry);
  if (trafficLog.length > TRAFFIC_LOG_MAX) trafficLog.shift();
}

module.exports = { trafficLog, logTraffic };
