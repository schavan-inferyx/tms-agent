module.exports = {
  port: Number(process.env.TMS_AGENT_PORT) || 9345,
  idleSleepMs: Number(process.env.TMS_IDLE_SLEEP_MS) || 120000,
  apiUrl: (process.env.TMS_API_URL || 'http://localhost:5000/api').replace(/\/$/, ''),
  tunnelUrl: process.env.TMS_TUNNEL_URL || 'ws://127.0.0.1:8787',
  originAllowlist: (process.env.TMS_ORIGIN_ALLOWLIST || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
