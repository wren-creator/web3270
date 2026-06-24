import { Client as SshClient } from 'ssh2';

export function handleSshConnect(ws, wsId, params, send, logger) {
  const { host, port = 22, username, password } = params;
  if (!host || !username || !password) {
    send(ws, { type: 'ssh.error', message: 'host, username and password are required' });
    ws.close(); return;
  }

  logger.info(`[ws:${wsId}] SSH → ${username}@${host}:${port}`);
  send(ws, { type: 'ssh.status', state: 'connecting' });

  const conn = new SshClient();
  let stream = null;

  conn.on('ready', () => {
    const sshVersion = conn._remoteVer || 'SSH';
    logger.info(`[ws:${wsId}] SSH authenticated (${sshVersion})`);
    send(ws, { type: 'ssh.status', state: 'connected', sshVersion });

    conn.shell({ term: 'xterm-256color', rows: params.rows || 24, cols: params.cols || 80 }, (err, sh) => {
      if (err) {
        send(ws, { type: 'ssh.error', message: err.message });
        conn.end(); ws.close(); return;
      }
      stream = sh;
      sh.on('data',   d  => { if (ws.readyState === 1) send(ws, { type: 'ssh.data', data: d.toString('base64') }); });
      sh.stderr.on('data', d => { if (ws.readyState === 1) send(ws, { type: 'ssh.data', data: d.toString('base64') }); });
      sh.on('close', () => {
        logger.info(`[ws:${wsId}] SSH shell closed`);
        send(ws, { type: 'ssh.status', state: 'disconnected' });
        conn.end();
        ws.close();
      });
    });
  });

  conn.on('error', err => {
    logger.warn(`[ws:${wsId}] SSH error: ${err.message}`);
    send(ws, { type: 'ssh.error', message: err.message });
    ws.close();
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ssh.data' && stream) {
      stream.write(Buffer.from(msg.data, 'base64'));
    } else if (msg.type === 'ssh.resize' && stream) {
      stream.setWindow(msg.rows || 24, msg.cols || 80);
    } else if (msg.type === 'ssh.disconnect') {
      if (stream) stream.end();
      conn.end();
    }
  });

  ws.on('close', () => {
    if (stream) stream.end();
    conn.end();
  });

  conn.on('keyboard-interactive', (_name, _instructions, _lang, _prompts, finish) => {
    finish(Array(_prompts.length).fill(password));
  });

  conn.connect({ host, port, username, password, tryKeyboard: true, readyTimeout: 15000 });
}
