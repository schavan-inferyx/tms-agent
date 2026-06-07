#!/usr/bin/env node
const { startServer } = require('./server');
const { version } = require('../package.json');

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(version);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`tms-agent v${version}

Local agent for Playwright automation (meadhikari).

Usage:
  tms-agent              Start listener on 127.0.0.1:9345 (default)
  tms-agent --version    Print version
  tms-agent --help       Show this help

Install:
  npm install -g tms-agent

Docs:
  https://www.npmjs.com/package/tms-agent
`);
  process.exit(0);
}

startServer();
