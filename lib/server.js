const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { port, idleSleepMs, getConfig, saveConfig } = require('./config');
const { getMachineId, launchChrome, waitForDebuggerUrl, DATA_DIR } = require('./chrome');
const { bridgeCdp } = require('./bridge');
const { tmsFetch } = require('./tmsFetch');
const { probeAgent } = require('./probe');

let state = 'idle';
let chromeChild = null;
let bridgeHandle = null;
let idleTimer = null;
let sessionCount = 0;
/** @type {import('ws').WebSocketServer | null} */
let wss = null;

function agentStatusPayload() {
  return {
    ok: true,
    version: require('../package.json').version,
    state,
    machineId: getMachineId(),
    sessions: sessionCount,
    sessionActive: sessionCount > 0,
    configured: Boolean(getConfig().apiUrl),
  };
}

function broadcastStatus() {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'status', ...agentStatusPayload() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function bumpSession() {
  sessionCount += 1;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function releaseSession() {
  sessionCount = Math.max(0, sessionCount - 1);
  if (sessionCount === 0 && state === 'idle') {
    scheduleSleep();
  }
  broadcastStatus();
}

function scheduleSleep() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => sleep(), idleSleepMs);
}

function closeChromeOnly() {
  if (bridgeHandle) {
    bridgeHandle.close();
    bridgeHandle = null;
  }
  if (chromeChild) {
    try { process.kill(-chromeChild.pid); } catch { /* ignore */ }
    chromeChild = null;
  }
}

function sleep() {
  state = 'idle';
  closeChromeOnly();
  broadcastStatus();
}

async function validateAndRun(runToken, machineId) {
  const res = await tmsFetch('/automation/agent/validate-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runToken}`,
    },
    body: JSON.stringify({ machineId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Token validation failed');
    err.code = data.code;
    throw err;
  }
  return data;
}

async function handleRun(runToken) {
  if (state === 'running') {
    const err = new Error('A run is already in progress');
    err.code = 'run_in_progress';
    throw err;
  }

  state = 'running';
  if (idleTimer) clearTimeout(idleTimer);
  closeChromeOnly();
  broadcastStatus();

  try {
    const machineId = getMachineId();
    const validated = await validateAndRun(runToken, machineId);

    if (validated.browserLaunch?.supported === false) {
      const err = new Error(validated.browserLaunch.unsupportedReason
        || 'This project requires a browser TMS does not support yet.');
      err.code = 'unsupported_browser';
      throw err;
    }

    const debugPort = 9222 + Math.floor(Math.random() * 100);
    const profileDir = path.join(DATA_DIR, 'chrome-profile');
    chromeChild = launchChrome(debugPort, profileDir, validated.browserLaunch || null);
    const chromeWsUrl = await waitForDebuggerUrl(debugPort, chromeChild);

    const readyRes = await tmsFetch('/automation/agent/run-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: validated.runId,
        machineId,
        browserWsUrl: chromeWsUrl,
        browserHttpUrl: `http://127.0.0.1:${debugPort}`,
      }),
    });
    if (!readyRes.ok) {
      const err = await readyRes.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to register Chrome with TMS');
    }

    if (validated.bridgeTunnel) {
      bridgeHandle = await bridgeCdp(validated.runId, chromeWsUrl);
    }

    broadcastStatus();
    return { ok: true, runId: validated.runId, machineId };
  } catch (err) {
    sleep();
    throw err;
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const { originAllowlist } = getConfig();
  return originAllowlist.some((allowed) => origin === allowed || origin.startsWith(allowed));
}

function applyConfigureMessage(msg) {
  const origin = String(msg.origin || '').trim();
  const apiUrl = String(msg.apiUrl || (origin ? `${origin}/api` : '')).replace(/\/$/, '');
  let tunnelUrl = String(msg.tunnelUrl || '').trim();
  if (!tunnelUrl && origin) {
    try {
      const u = new URL(origin);
      tunnelUrl = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/automation-ws`;
    } catch {
      tunnelUrl = 'ws://127.0.0.1:8787';
    }
  }
  const tlsInsecure = msg.tlsInsecure === true || msg.tlsInsecure === 'true';
  return saveConfig({
    apiUrl,
    tunnelUrl,
    originAllowlist: origin ? [origin] : undefined,
    tlsInsecure: msg.tlsInsecure !== undefined ? tlsInsecure : undefined,
  });
}

function attachWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    bumpSession();
    ws.send(JSON.stringify({ type: 'status', ...agentStatusPayload() }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'configure') {
          applyConfigureMessage(msg);
          ws.send(JSON.stringify({ type: 'status', ...agentStatusPayload() }));
        }
      } catch {
        /* ignore malformed messages */
      }
    });

    ws.on('close', () => {
      releaseSession();
    });
  });
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const { originAllowlist } = getConfig();
    if (origin && originAllowlist.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (originAllowlist[0]) {
      res.setHeader('Access-Control-Allow-Origin', originAllowlist[0]);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agentStatusPayload()));
      return;
    }

    if (req.url === '/run/complete' && req.method === 'POST') {
      sleep();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, state: 'idle' }));
      return;
    }

    if (req.url === '/run/cancel' && req.method === 'POST') {
      sleep();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, state: 'idle' }));
      return;
    }

    if (req.url === '/configure' && req.method === 'POST') {
      if (!isOriginAllowed(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Origin not allowed' }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          applyConfigureMessage(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, config: getConfig() }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: err.message || 'Invalid configure payload' }));
        }
      });
      return;
    }

    if (req.url === '/run' && req.method === 'POST') {
      if (!isOriginAllowed(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Origin not allowed' }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (parsed.configure) {
            applyConfigureMessage(parsed.configure);
          }
          const runToken = parsed.runToken || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
          if (!runToken) throw new Error('runToken required');
          const result = await handleRun(runToken);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(err.code === 'consent_required' ? 403 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: err.message, code: err.code }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  attachWebSocket(server);

  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('tms-agent failed to start:', err.message);
      process.exit(1);
      return;
    }
    probeAgent(port).then((healthy) => {
      if (healthy) {
        console.log(`tms-agent already running on http://127.0.0.1:${port}`);
        process.exit(0);
        return;
      }
      console.error(
        `Port ${port} is in use by another process (not tms-agent).`
        + ` Stop it with: fuser -k ${port}/tcp`,
      );
      process.exit(1);
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`tms-agent listening on http://127.0.0.1:${port} (local only — no firewall rule needed)`);
  });
  return server;
}

module.exports = { startServer, sleep, get state() { return state; } };
