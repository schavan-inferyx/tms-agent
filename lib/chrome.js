const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

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
    linux: ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'],
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
      const found = spawnSync('command', ['-v', candidate], { shell: true, encoding: 'utf8' });
      if (found.status === 0 && found.stdout?.trim()) {
        return found.stdout.trim().split('\n')[0];
      }
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

  return null;
}

function chromeInstallHint() {
  if (process.platform === 'linux') {
    return 'Install Google Chrome: sudo apt install google-chrome-stable (or chromium-browser)';
  }
  if (process.platform === 'darwin') {
    return 'Install Google Chrome from https://www.google.com/chrome/';
  }
  return 'Install Google Chrome from https://www.google.com/chrome/';
}

function resolveChromeExecutable(channel) {
  const exe = findBrowser(channel);
  if (!exe) {
    throw new Error(`Google Chrome not found. ${chromeInstallHint()}`);
  }
  return exe;
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

function clearStaleProfileLock(userDataDir) {
  const lockPath = path.join(userDataDir, 'SingletonLock');
  if (!fs.existsSync(lockPath)) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* another Chrome may be using this profile */
  }
}

function launchChrome(debugPort, userDataDir, browserLaunch = {}) {
  const exe = resolveChromeExecutable(browserLaunch?.channel);
  fs.mkdirSync(userDataDir, { recursive: true });
  clearStaleProfileLock(userDataDir);

  const extraArgs = sanitizeChromeArgs(browserLaunch?.chromeArgs);
  const args = [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    ...extraArgs,
    'about:blank',
  ];

  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    child.spawnError = err;
  });
  child.unref();
  return child;
}

async function waitForDebuggerUrl(port, chromeChild = null, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (chromeChild?.spawnError) {
      const msg = chromeChild.spawnError.code === 'ENOENT'
        ? `Chrome executable not found. ${chromeInstallHint()}`
        : `Chrome failed to start: ${chromeChild.spawnError.message}`;
      const err = new Error(msg);
      err.code = 'chrome_launch_failed';
      throw err;
    }
    // Do NOT check chromeChild.exitCode here — on Linux the chrome wrapper process
    // exits immediately (often code 0/1) after forking the real browser.

    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const json = await res.json();
        if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const err = new Error(
    `Chrome debug port ${port} did not become ready in 15s. `
    + `${chromeInstallHint()} Then test locally: `
    + `google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/tms-chrome-test about:blank`,
  );
  err.code = 'chrome_debug_port_timeout';
  throw err;
}

module.exports = {
  getMachineId,
  findBrowser,
  launchChrome,
  waitForDebuggerUrl,
  DATA_DIR,
};
