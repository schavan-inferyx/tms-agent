const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DATA_DIR = path.join(os.homedir(), '.tms-agent');
const MACHINE_ID_FILE = path.join(DATA_DIR, 'machine-id');

const BROWSER_CANDIDATES = {
  chrome: {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    linux: ['google-chrome', 'google-chrome-stable'],
  },
  'chrome-beta': {
    darwin: ['/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'],
    win32: [
      'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome Beta\\Application\\chrome.exe',
    ],
    linux: ['google-chrome-beta'],
  },
  'chrome-canary': {
    darwin: ['/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'],
    win32: [
      'C:\\Program Files\\Google\\Chrome SxS\\Application\\chrome.exe',
    ],
    linux: ['google-chrome-unstable'],
  },
  msedge: {
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    win32: [
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
  },
  'msedge-beta': {
    darwin: ['/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta'],
    win32: ['C:\\Program Files (x86)\\Microsoft\\Edge Beta\\Application\\msedge.exe'],
    linux: ['microsoft-edge-beta'],
  },
  'msedge-dev': {
    darwin: ['/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev'],
    win32: ['C:\\Program Files (x86)\\Microsoft\\Edge Dev\\Application\\msedge.exe'],
    linux: ['microsoft-edge-dev'],
  },
  chromium: {
    darwin: [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    win32: [],
    linux: ['chromium', 'chromium-browser'],
  },
};

function getMachineId() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(MACHINE_ID_FILE)) {
    return fs.readFileSync(MACHINE_ID_FILE, 'utf8').trim();
  }
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(MACHINE_ID_FILE, id);
  return id;
}

function platformKey() {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win32';
  return 'linux';
}

function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  return null;
}

function findBrowser(channel) {
  const platform = platformKey();
  const normalized = String(channel || 'chrome').toLowerCase();
  const mapped = BROWSER_CANDIDATES[normalized]?.[platform]
    || BROWSER_CANDIDATES.chrome[platform];

  const resolved = resolveExistingPath(mapped);
  if (resolved) return resolved;

  if (normalized !== 'chrome') {
    return findBrowser('chrome');
  }

  return platform === 'linux' ? 'google-chrome' : mapped[0];
}

function sanitizeChromeArgs(args) {
  const blocked = [
    /--remote-debugging-port/i,
    /--user-data-dir/i,
    /--remote-debugging-address/i,
  ];
  return (Array.isArray(args) ? args : []).filter((arg) => {
    const value = String(arg);
    return value && !blocked.some((re) => re.test(value));
  });
}

function launchChrome(debugPort, userDataDir, browserLaunch = {}) {
  const channel = browserLaunch?.channel || null;
  const exe = findBrowser(channel);
  const extraArgs = sanitizeChromeArgs(browserLaunch?.chromeArgs);
  const args = [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...extraArgs,
    'about:blank',
  ];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

async function waitForDebuggerUrl(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const json = await res.json();
        return json.webSocketDebuggerUrl;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome debug port did not become ready');
}

module.exports = {
  getMachineId,
  findBrowser,
  launchChrome,
  waitForDebuggerUrl,
  DATA_DIR,
};
