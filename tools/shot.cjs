'use strict';
/**
 * 无头 Chrome 截图工具（零依赖，直接用 CDP + Node 内置 WebSocket）
 * 用法：
 *   node tools/shot.cjs --url <url> --out <png> [--w 1600] [--h 1000]
 *                        [--scroll 0] [--full] [--wait 1200] [--dpr 1]
 *   node tools/shot.cjs --url <url> --eval "<js>" --out <png>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d;
};

const url = arg('url');
const out = arg('out', 'shot.png');
const W = Number(arg('w', 1600));
const H = Number(arg('h', 1000));
const SCROLL = Number(arg('scroll', 0));
const FULL = arg('full', false) === true;
const WAIT = Number(arg('wait', 1500));
const DPR = Number(arg('dpr', 1));
const EVALFILE = arg('evalFile', null);
const EVAL = arg('eval', null) || (EVALFILE ? require('fs').readFileSync(String(EVALFILE), 'utf8') : null);
const SEL = arg('sel', null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(p) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`);
  return res.json();
}

async function ensureChrome() {
  try {
    await getJSON('/json/version');
    return null;
  } catch {}
  const profile = path.join(os.tmpdir(), 'dsh-shot-profile');
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { detached: false, stdio: 'ignore' }
  );
  proc.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      await getJSON('/json/version');
      return proc;
    } catch {}
  }
  throw new Error('Chrome 未能启动');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error'));
  });
}

let msgId = 0;
function send(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ': ' + JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify(payload));
  });
}

(async () => {
  await ensureChrome();
  const ver = await getJSON('/json/version');
  const ws = await connect(ver.webSocketDebuggerUrl);

  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });

  const s = (m, p) => send(ws, m, p, sessionId);

  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: DPR,
    mobile: false,
  });
  await s('Page.navigate', { url });
  await sleep(WAIT);

  if (EVAL) {
    const r = await s('Runtime.evaluate', { expression: EVAL, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) console.log('EVALERR:', JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0,300));
    else if (r && r.result && r.result.value !== undefined) console.log('EVAL:', typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value));
    await sleep(400);
  }
  if (SCROLL) {
    await s('Runtime.evaluate', { expression: `window.scrollTo(0, ${SCROLL});` });
    await sleep(500);
  }
  if (SEL) {
    await s('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(SEL)}).scrollIntoView({block:'start'});`,
    });
    await sleep(600);
  }

  let clip;
  if (FULL) {
    const { result } = await s('Runtime.evaluate', {
      expression: 'JSON.stringify({w:document.documentElement.clientWidth,h:document.documentElement.scrollHeight})',
      returnByValue: true,
    });
    const dim = JSON.parse(result.value);
    clip = { x: 0, y: 0, width: dim.w, height: dim.h, scale: 1 };
  }

  const shot = await s('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !!FULL,
    ...(clip ? { clip } : {}),
  });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(path.resolve(out), buf);
  console.log('saved', out, (buf.length / 1024).toFixed(0) + 'KB');

  await send(ws, 'Target.closeTarget', { targetId });
  ws.close();
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
