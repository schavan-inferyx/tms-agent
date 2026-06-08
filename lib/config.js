const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.tms-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** @type {{ apiUrl: string, tunnelUrl: string, originAllowlist: string[], tlsInsecure: boolean } | null} */
let runtime = null;

function parseTlsInsecure(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const s = String(value || '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return undefined;
}

function parseAllowlist(value) {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readFileConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      apiUrl: String(raw.apiUrl || '').replace(/\/$/, ''),
      tunnelUrl: String(raw.tunnelUrl || '').trim(),
      originAllowlist: parseAllowlist(raw.originAllowlist || raw.origin),
      tlsInsecure: parseTlsInsecure(raw.tlsInsecure),
    };
  } catch {
    return null;
  }
}

function envTlsInsecure() {
  return parseTlsInsecure(process.env.TMS_TLS_INSECURE);
}

function defaults() {
  return {
    apiUrl: (process.env.TMS_API_URL || 'http://localhost:5000/api').replace(/\/$/, ''),
    tunnelUrl: process.env.TMS_TUNNEL_URL || 'ws://127.0.0.1:8787',
    originAllowlist: parseAllowlist(process.env.TMS_ORIGIN_ALLOWLIST || 'http://localhost:3000'),
    tlsInsecure: envTlsInsecure() ?? false,
  };
}

function isTlsInsecure() {
  const env = envTlsInsecure();
  if (env !== undefined) return env;
  return Boolean(getConfig().tlsInsecure);
}

function getConfig() {
  if (runtime) return runtime;
  const file = readFileConfig();
  const base = defaults();
  runtime = {
    apiUrl: file?.apiUrl || base.apiUrl,
    tunnelUrl: file?.tunnelUrl || base.tunnelUrl,
    originAllowlist: file?.originAllowlist?.length ? file.originAllowlist : base.originAllowlist,
    tlsInsecure: file?.tlsInsecure ?? base.tlsInsecure,
  };
  return runtime;
}

function saveConfig(partial) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const current = getConfig();
  const nextTls = partial.tlsInsecure !== undefined
    ? Boolean(partial.tlsInsecure)
    : current.tlsInsecure;
  const next = {
    apiUrl: partial.apiUrl ? String(partial.apiUrl).replace(/\/$/, '') : current.apiUrl,
    tunnelUrl: partial.tunnelUrl ? String(partial.tunnelUrl).trim() : current.tunnelUrl,
    originAllowlist: partial.originAllowlist?.length
      ? parseAllowlist(partial.originAllowlist)
      : partial.origin
        ? [String(partial.origin).trim()].filter(Boolean)
        : current.originAllowlist,
    tlsInsecure: nextTls,
  };
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  runtime = next;
  return next;
}

function reloadConfig() {
  runtime = null;
  return getConfig();
}

module.exports = {
  port: Number(process.env.TMS_AGENT_PORT) || 9345,
  idleSleepMs: Number(process.env.TMS_IDLE_SLEEP_MS) || 120000,
  configDir: CONFIG_DIR,
  configFile: CONFIG_FILE,
  getConfig,
  saveConfig,
  reloadConfig,
  isTlsInsecure,
};
