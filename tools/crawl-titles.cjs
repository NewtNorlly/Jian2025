'use strict';
/**
 * 批量抓取网页标题（零依赖，curl 走本地代理）
 * ---------------------------------------------------------------
 * 为什么这么做：微信文章页对直连 IP 会在十来次请求后强制「环境异常」验证，
 * 但对本地代理出口放行；而整篇文章动辄 3.5MB，只为取 <head> 里的标题，
 * 所以用 curl 流式下载，读到 </head> 或 300KB 就掐断连接。
 *
 * 目标：
 *   1. data/wechat-links.json   ——《微信收藏文章链接表》全部链接
 *   2. data/naked-links.json    —— 页面上没有可见文字的「光头链接」
 *
 * 结果写入 data/titles.json（断点续爬）：
 *   { "<url>": { "title": "...", "site": "mp.weixin.qq.com", "status": 200, "at": "2026-11-07" } }
 *
 * 用法：
 *   node tools/crawl-titles.cjs                     # 抓全部未完成的
 *   node tools/crawl-titles.cjs --minutes 20        # 最多跑 20 分钟
 *   node tools/crawl-titles.cjs --limit 50 --proxy "" --concurrency 1
 *   node tools/crawl-titles.cjs --prune             # 清掉失败记录后重抓
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CACHE_PATH = path.join(ROOT, 'data', 'titles.json');
const LINKS_PATH = path.join(ROOT, 'data', 'wechat-links.json');
const NAKED_PATH = path.join(ROOT, 'data', 'naked-links.json');

const argVal = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const PROXY = argVal('proxy', 'http://127.0.0.1:7890');
const CONCURRENCY = Number(argVal('concurrency', 3)) || 1;
const MINUTES = Number(argVal('minutes', 0)) || 0;
const LIMIT = Number(argVal('limit', 0)) || Infinity;
const MAX_BYTES = Number(argVal('maxbytes', 0)) || 320000;
const PRUNE = process.argv.includes('--prune');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = () => new Date().toISOString().slice(0, 10);
const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

/* ---------- 目标地址 ---------- */
function targets() {
  const set = new Set();
  for (const f of [LINKS_PATH, NAKED_PATH]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const u of j.links || []) set.add(u);
    } catch {}
  }
  return [...set];
}

/* ---------- 流式抓 <head> ---------- */
function fetchHead(url) {
  return new Promise((resolve) => {
    const args = [
      '-s',
      '-L',
      '-A',
      UA,
      '-H',
      'Accept-Language: zh-CN,zh;q=0.9',
      '--max-time',
      '25',
      '--connect-timeout',
      '10',
    ];
    if (PROXY) args.push('-x', PROXY);
    args.push(url);

    let proc;
    try {
      proc = spawn('curl.exe', args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, bytes: 0, html: '' });
      return;
    }

    let buf = Buffer.alloc(0);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve({ ok: true, bytes: buf.length, html: buf.toString('utf8') });
    };

    proc.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= MAX_BYTES) return finish();
      if (buf.includes('</head>') || buf.includes('activity-name')) finish();
    });
    proc.stderr.on('data', () => {});
    proc.on('close', finish);
    proc.on('error', finish);
  });
}

/* ---------- 标题提取 ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

const clean = (s) => decode(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function extractTitle(html) {
  if (!html) return '';
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  if (og && clean(og[1])) return clean(og[1]);
  const h1 = html.match(/<h1[^>]*id=["']activity-name["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (h1 && clean(h1[1])) return clean(h1[1]);
  const tw = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']*)["']/i);
  if (tw && clean(tw[1])) return clean(tw[1]);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t && clean(t[1])) return clean(t[1]).replace(/\s*[-|–—_]\s*(微信公众平台|微信公众号)\s*$/, '');
  return '';
}

const looksVerified = (html) =>
  !extractTitle(html) &&
  (/环境异常|完成验证|去验证/.test(html) || html.length < 60000);

/* ---------- 主流程 ---------- */
async function main() {
  // 代理可用性检查
  if (PROXY) {
    const ok = await new Promise((res) => {
      const s = net.connect(Number(PROXY.split(':').pop() || 7890), '127.0.0.1');
      const t = setTimeout(() => {
        s.destroy();
        res(false);
      }, 1500);
      s.once('connect', () => {
        clearTimeout(t);
        s.destroy();
        res(true);
      });
      s.once('error', () => {
        clearTimeout(t);
        res(false);
      });
    });
    if (!ok) {
      console.log('代理不可用，改为直连（会被限流）');
    } else {
      console.log(`走代理 ${PROXY}，并发 ${CONCURRENCY}`);
    }
  }

  const all = targets();
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {}

  if (PRUNE) {
    let n = 0;
    for (const [k, v] of Object.entries(cache)) {
      if (!v.title) {
        delete cache[k];
        n++;
      }
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 0), 'utf8');
    console.log(`清掉失败记录 ${n} 条`);
  }

  const todo = all.filter((u) => !(cache[u] && cache[u].title)).slice(0, LIMIT);
  console.log(`目标 ${all.length} 条，已有标题 ${all.length - todo.length} 条，本轮 ${todo.length} 条`);

  const deadline = MINUTES ? Date.now() + MINUTES * 60000 : Infinity;
  let idx = 0;
  let ok = 0;
  let fail = 0;
  let verified = 0;
  const started = Date.now();

  const save = () => fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 0), 'utf8');

  async function worker() {
    while (idx < todo.length && Date.now() < deadline) {
      const url = todo[idx++];
      let got = '';
      let status = 0;
      for (let attempt = 0; attempt < 3 && !got; attempt++) {
        const r = await fetchHead(url);
        status = r.ok ? 200 : 0;
        if (looksVerified(r.html)) {
          verified++;
          await sleep(1200 + Math.random() * 1800);
          continue;
        }
        got = extractTitle(r.html);
        if (!got) await sleep(600);
      }
      if (got) {
        cache[url] = { title: got, site: hostOf(url), status, at: iso() };
        ok++;
      } else {
        cache[url] = { title: '', site: hostOf(url), status, at: iso(), note: 'verify-or-empty' };
        fail++;
      }
      if ((ok + fail) % 25 === 0) {
        save();
        const el = Math.round((Date.now() - started) / 1000);
        const rate = (ok + fail) / Math.max(1, el);
        console.log(
          `进度 ${ok + fail}/${todo.length} · 成功 ${ok} · 失败 ${fail} · 验证页 ${verified} · ${rate.toFixed(2)} 条/秒`
        );
      }
      await sleep(220 + Math.random() * 260);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  console.log(
    `完成：成功 ${ok}，失败 ${fail}，验证页 ${verified}，用时 ${Math.round((Date.now() - started) / 60000)} 分钟。` +
      ` 缓存共 ${Object.keys(cache).length} 条 → data/titles.json`
  );
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
