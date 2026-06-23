'use strict';

const WebSocket = require('ws');

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

module.exports = send;
