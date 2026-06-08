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

Local agent for Playwright automation.

Usage:
  tms-agent              Start listener (usually auto-started after npm install -g)
  tms-agent --version    Print version
  tms-agent --help       Show this help

Install (testers):
  npm install -g tms-agent

Docs:
  https://www.npmjs.com/package/tms-agent
`);
  process.exit(0);
}

startServer();
