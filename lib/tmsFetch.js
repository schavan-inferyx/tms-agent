'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { getConfig, isTlsInsecure } = require('./config');

function isCertError(cause) {
  const code = cause?.cause?.code || cause?.code || '';
  const msg = `${cause?.message || ''} ${cause?.cause?.message || ''}`;
  return code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || code === 'CERT_HAS_EXPIRED'
    || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    || code === 'SELF_SIGNED_CERT_IN_CHAIN'
    || /certificate/i.test(msg);
}

/** HTTPS fetch that accepts self-signed certs when tlsInsecure is enabled. */
function insecureFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    };

    const req = lib.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(text || '{}'),
          text: async () => text,
        });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Fetch TMS API with actionable errors when the server is unreachable.
 * @param {string} path - e.g. `/automation/agent/validate-token`
 * @param {RequestInit} options
 */
async function tmsFetch(path, options = {}) {
  const { apiUrl } = getConfig();
  if (!apiUrl) {
    const err = new Error('TMS API URL is not configured. Open Test → Automation in your browser to connect.');
    err.code = 'api_not_configured';
    throw err;
  }

  const url = `${apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const useInsecure = isTlsInsecure() && url.startsWith('https://');
  const fetchFn = useInsecure ? insecureFetch : fetch;

  try {
    return await fetchFn(url, options);
  } catch (cause) {
    const code = cause?.cause?.code || cause?.code || '';
    let message;
    if (isCertError(cause)) {
      message = isTlsInsecure()
        ? `TLS error calling ${apiUrl} even with tlsInsecure enabled: ${cause.message}`
        : `TLS certificate not trusted for ${apiUrl} (self-signed EC2 cert). `
          + 'Reopen Automation to reconfigure, or set TMS_TLS_INSECURE=true and restart tms-agent.';
    } else if (code === 'ECONNREFUSED') {
      message = `Cannot reach TMS API at ${apiUrl} (connection refused). Is the backend running and reachable from this machine?`;
    } else if (code === 'ENOTFOUND') {
      message = `Cannot reach TMS API at ${apiUrl} (host not found). Check the server URL in ~/.tms-agent/config.json.`;
    } else if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      message = `Timed out connecting to TMS API at ${apiUrl}. Check network/firewall — port 9345 is local-only; the API port must be open outbound from this PC.`;
    } else {
      message = `Cannot reach TMS API at ${apiUrl}: ${cause.message || 'network error'}`;
    }
    const err = new Error(message);
    err.code = 'api_unreachable';
    throw err;
  }
}

module.exports = { tmsFetch };
