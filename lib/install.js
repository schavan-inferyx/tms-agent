#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { probeAgent, probeAgentHealth } = require('./probe');

const PORT = Number(process.env.TMS_AGENT_PORT) || 9345;
const CONFIG_DIR = path.join(os.homedir(), '.tms-agent');
const { version: INSTALLED_VERSION } = require('../package.json');

function stopAgentOnPort(port) {
  if (process.platform !== 'win32') {
    spawnSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' });
  }
  spawnSync('systemctl', ['--user', 'stop', 'tms-agent.service'], { stdio: 'ignore' });
}

async function waitForAgentVersion(expectedVersion, tries = 24) {
  for (let i = 0; i < tries; i += 1) {
    const health = await probeAgentHealth(PORT);
    if (health?.version === expectedVersion) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function startBackgroundAgent() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const logPath = path.join(CONFIG_DIR, 'agent.log');
  const out = fs.openSync(logPath, 'a');
  const cli = path.join(__dirname, 'cli.js');
  const child = spawn(process.execPath, [cli], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
}

function registerLinuxAutostart() {
  if (process.platform !== 'linux' || !process.env.XDG_CONFIG_HOME && !fs.existsSync('/run/systemd/system')) {
    return;
  }
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const unitPath = path.join(unitDir, 'tms-agent.service');
  const tmsAgent = spawnSync('which', ['tms-agent'], { encoding: 'utf8' }).stdout?.trim()
    || spawnSync('command', ['-v', 'tms-agent'], { shell: true, encoding: 'utf8' }).stdout?.trim();
  if (!tmsAgent) return;

  fs.mkdirSync(unitDir, { recursive: true });
  const unit = `[Unit]
Description=TMS Playwright Agent
After=network-online.target

[Service]
ExecStart=${tmsAgent}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(unitPath, unit, 'utf8');
  spawn('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  spawn('systemctl', ['--user', 'enable', '--now', 'tms-agent.service'], { stdio: 'ignore' });
}

function registerMacAutostart() {
  if (process.platform !== 'darwin') return;
  const tmsAgent = spawnSync('which', ['tms-agent'], { encoding: 'utf8' }).stdout?.trim();
  if (!tmsAgent) return;

  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, 'com.inferyx.tms-agent.plist');
  fs.mkdirSync(plistDir, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.inferyx.tms-agent</string>
  <key>ProgramArguments</key>
  <array><string>${tmsAgent}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>`;
  fs.writeFileSync(plistPath, plist, 'utf8');
  spawn('launchctl', ['load', plistPath], { stdio: 'ignore' });
}

async function main() {
  const running = await probeAgentHealth(PORT);
  if (running?.version === INSTALLED_VERSION) {
    return;
  }

  if (running) {
    stopAgentOnPort(PORT);
    await new Promise((r) => setTimeout(r, 600));
  }

  startBackgroundAgent();
  await waitForAgentVersion(INSTALLED_VERSION);
  registerLinuxAutostart();
  registerMacAutostart();
}

main().catch(() => {
  /* postinstall must not fail npm install */
});
