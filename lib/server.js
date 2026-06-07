const http = require('http');
const path = require('path');
const { port, idleSleepMs, apiUrl, originAllowlist } = require('./config');
const { getMachineId, launchChrome, waitForDebuggerUrl, DATA_DIR } = require('./chrome');
const { bridgeCdp } = require('./bridge');

let state = 'idle';
let chromeChild = null;
let bridgeHandle = null;
let idleTimer = null;

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
}

async function validateAndRun(runToken, machineId) {
  const res = await fetch(`${apiUrl}/automation/agent/validate-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runToken}`,
    },
    body: JSON.stringify({ machineId }),
  });
  const data = await res.json();
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
  state = 'running';

  const machineId = getMachineId();
  const validated = await validateAndRun(runToken, machineId);

  if (validated.browserLaunch?.supported === false) {
    const err = new Error(validated.browserLaunch.unsupportedReason
      || 'This project requires a browser TMS does not support yet.');
    err.code = 'unsupported_browser';
    throw err;
  }

  // Server runs Playwright; agent opens Chrome and bridges CDP
  const debugPort = 9222 + Math.floor(Math.random() * 100);
  const profileDir = path.join(DATA_DIR, 'chrome-profile');
  chromeChild = launchChrome(debugPort, profileDir, validated.browserLaunch || null);
  const chromeWsUrl = await waitForDebuggerUrl(debugPort);

  const readyRes = await fetch(`${apiUrl}/automation/agent/run-ready`, {
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

  return { ok: true, runId: validated.runId, machineId };
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  return originAllowlist.some((allowed) => origin === allowed || origin.startsWith(allowed));
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
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
      res.end(JSON.stringify({
        ok: true,
        version: require('../package.json').version,
        state,
        machineId: getMachineId(),
      }));
      return;
    }

    if (req.url === '/run/complete' && req.method === 'POST') {
      sleep();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, state: 'idle' }));
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

  server.listen(port, '127.0.0.1', () => {
    console.log(`tms-agent listening on http://127.0.0.1:${port}`);
  });
  return server;
}

module.exports = { startServer, sleep, get state() { return state; } };
