'use strict';

const fs   = require('fs');
const path = require('path');

const traffic   = require('../routes/traffic');
const logs      = require('../routes/logs');
const profiles  = require('../routes/profiles');
const sshHosts  = require('../routes/ssh-hosts');
const macros    = require('../routes/macros');
const recording = require('../routes/recording');
const security  = require('../routes/security');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const ROUTES = [traffic, logs, profiles, sshHosts, macros, recording, security];

function createRequestHandler({ config, logger, sessions }) {
  const ctx = { config, logger, sessions };

  return function handleRequest(req, res) {
    for (const route of ROUTES) {
      if (route.handle(req, res, ctx)) return;
    }

    // ── Static file server ─────────────────────────────────────────
    const urlPath = req.url.split('?')[0];
    let filePath;
    if (urlPath === '/' || urlPath === '')                           filePath = path.join(PUBLIC_DIR, 'tn3270-client.html');
    else if (urlPath === '/demo' || urlPath === '/demo.html')        filePath = path.join(PUBLIC_DIR, 'tn3270-client-demo.html');
    else if (urlPath === '/replay' || urlPath === '/replay.html')    filePath = path.join(PUBLIC_DIR, 'replay.html');
    else if (urlPath === '/logs' || urlPath === '/logs.html')        filePath = path.join(PUBLIC_DIR, 'logs.html');
    else if (urlPath === '/traffic' || urlPath === '/traffic.html')  filePath = path.join(PUBLIC_DIR, 'traffic.html');
    else if (urlPath === '/copilot' || urlPath === '/copilot.html')  filePath = path.join(PUBLIC_DIR, 'copilot-panel-standalone.html');
    else {
      filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
    }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end(`Not found: ${urlPath}`); return; }
      const ext  = path.extname(filePath);
      const mime = MIME[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  };
}

module.exports = { createRequestHandler };
