const WebSocket = require('ws');
const { getConfig, isTlsInsecure } = require('./config');

/** Trailing slash before query avoids nginx 301 on WebSocket upgrade. */
function normalizeTunnelBase(url) {
  const base = String(url || '').replace(/\/$/, '');
  if (base.endsWith('/automation-ws')) return `${base}/`;
  return `${base}/`;
}

function buildHubUrl(tunnelUrl, runId, role) {
  const base = normalizeTunnelBase(tunnelUrl);
  return `${base}?runId=${encodeURIComponent(runId)}&role=${role}`;
}

function wsOptions(url) {
  if (!isTlsInsecure() || !String(url).startsWith('wss://')) return undefined;
  return { rejectUnauthorized: false };
}

/** Connect to Chrome first, then register with tunnel hub so the worker never races ahead. */
function bridgeCdp(runId, chromeWsUrl) {
  return new Promise((resolve, reject) => {
    const chromeWs = new WebSocket(chromeWsUrl);
    let settled = false;

    function relay(a, b) {
      a.on('message', (data, isBinary) => {
        if (b.readyState === WebSocket.OPEN) b.send(data, { binary: isBinary });
      });
    }

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    chromeWs.on('error', fail);

    chromeWs.on('open', () => {
      const { tunnelUrl } = getConfig();
      const hubUrl = buildHubUrl(tunnelUrl, runId, 'agent');
      const hubWs = new WebSocket(hubUrl, wsOptions(hubUrl));

      hubWs.on('error', fail);

      hubWs.on('open', () => {
        relay(chromeWs, hubWs);
        relay(hubWs, chromeWs);
        if (!settled) {
          settled = true;
          resolve({
            chromeWs,
            hubWs,
            close: () => {
              chromeWs.close();
              hubWs.close();
            },
          });
        }
      });
    });
  });
}

module.exports = { bridgeCdp };
