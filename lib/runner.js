const { spawn } = require('child_process');
const { apiUrl } = require('./config');

async function postLog(runId, line) {
  const text = String(line).trim();
  if (!text) return;
  try {
    await fetch(`${apiUrl}/automation/agent/run-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, line: text.slice(0, 4000) }),
    });
  } catch {
    /* best effort */
  }
}

async function postFinished(runId, machineId, exitCode) {
  await fetch(`${apiUrl}/automation/agent/run-finished`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, machineId, exitCode }),
  }).catch(() => {});
}

function runPlaywrightLocal({ runId, machineId, repoPath, testFile, grep, testLine }) {
  return new Promise((resolve, reject) => {
    const lineNum = Number.parseInt(String(testLine || ''), 10);
    const testTarget = lineNum > 0 ? `${testFile}:${lineNum}` : testFile;

    const args = [
      'playwright',
      'test',
      testTarget,
      '--reporter=line',
      '--workers=1',
      '--headed',
    ];
    if (grep && !(lineNum > 0)) {
      args.push('-g', grep);
    }

    postLog(runId, `Playwright local → ${testTarget}`);

    const child = spawn('npx', args, {
      cwd: repoPath,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: process.platform === 'win32',
    });

    child.stdout.on('data', (buf) => {
      buf.toString().split('\n').filter(Boolean).forEach((line) => postLog(runId, line));
    });
    child.stderr.on('data', (buf) => {
      buf.toString().split('\n').filter(Boolean).forEach((line) => postLog(runId, `[stderr] ${line}`));
    });

    child.on('error', reject);

    child.on('close', async (code) => {
      await postFinished(runId, machineId, code ?? 1);
      resolve({ ok: true, runId, exitCode: code ?? 1 });
    });
  });
}

module.exports = { runPlaywrightLocal };
