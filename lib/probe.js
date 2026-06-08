'use strict';

const http = require('http');

function probeAgentHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          const data = JSON.parse(body);
          resolve(data?.ok ? data : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function probeAgent(port) {
  const health = await probeAgentHealth(port);
  return Boolean(health);
}

module.exports = { probeAgent, probeAgentHealth };
