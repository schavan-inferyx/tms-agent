# tms-agent

Local agent for **Playwright test automation** (by [meadhikari](https://www.npmjs.com/~meadhikari)). Test code runs on the platform server; **Chrome runs on your machine** so you can watch tests execute.

Requires **Node.js 18+** and **Google Chrome** (or Chromium).

## Install

```bash
npm install -g tms-agent
```

Verify:

```bash
tms-agent --version
curl http://127.0.0.1:9345/health
```

During development:

```bash
git clone https://github.com/schavan-inferyx/tms-agent.git
cd tms-agent
npm install
npm link
```

## Usage

Run once after install (or add to startup):

```bash
tms-agent
```

Options:

```bash
tms-agent --version   # print package version
tms-agent --help      # show help
```

- Listens on `http://127.0.0.1:9345`
- Wakes when your test platform POSTs `/run` after you click **Run**
- Opens Chrome on your machine; test code runs on the server
- Sleeps ~2 minutes after idle

## Environment

| Variable | Default |
|----------|---------|
| `TMS_AGENT_PORT` | `9345` |
| `TMS_API_URL` | `http://localhost:5000/api` |
| `TMS_TUNNEL_URL` | `ws://127.0.0.1:8787` |
| `TMS_ORIGIN_ALLOWLIST` | `http://localhost:3000` |
| `TMS_IDLE_SLEEP_MS` | `120000` |

## Uninstall

```bash
npm uninstall -g tms-agent
```
