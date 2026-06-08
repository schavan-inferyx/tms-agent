# tms-agent

Local agent for **Playwright test automation**. Test code runs on the TMS server; **Chrome runs on your machine**.

Requires **Node.js 18+** and **Google Chrome**.

## Install (only step for testers)

```bash
npm install -g tms-agent
```

That is all. The installer:

- Starts the agent in the background on `127.0.0.1:9345`
- Registers login autostart (macOS LaunchAgent / Linux systemd user service)
- Saves TMS server settings when you open **Automation** in the browser (no env vars)

## How it connects

1. Open **Test → Automation** in TMS in your browser  
2. The page opens a **WebSocket** to `ws://127.0.0.1:9345/ws`  
3. The browser sends your TMS server URL; the agent saves it to `~/.tms-agent/config.json`  
4. When you leave Automation, the WebSocket closes and Chrome closes if idle  

## Manual start (optional)

```bash
tms-agent
```

## Environment (optional overrides)

| Variable | Default |
|----------|---------|
| `TMS_AGENT_PORT` | `9345` |
| `TMS_API_URL` | Set by browser, or `http://localhost:5000/api` |
| `TMS_TUNNEL_URL` | Set by browser |
| `TMS_ORIGIN_ALLOWLIST` | Set by browser |

## Publish

See [tms-agent publish guide](../docs/tms-agent-publish-guide.md) in the monorepo.
