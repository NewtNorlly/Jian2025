'use strict';
/**
 * 批量抓取网页标题（零依赖）
 * ---------------------------------------------------------------
 * 抓两类地址：
 *   1. data/wechat-links.json        ——《微信收藏文章链接表》全部链接
 *   2. _site/index.html 里的空文本链接 —— 页面上没有可见文字的「光头链接」
 *
 * 结果写进 data/titles.json（断点续爬，已抓过的不再请求）：
 *   { "url": { "title": "...", "site": "mp.weixin.qq.com", "status": 200, "at": "2026-11-07" } }
 *
 * 用法：
 *   node tools/crawl-titles.cjs                 # 抓全部未完成的
 *   node tools/crawl-titles.cjs --limit 20      # 只抓 20 条，先试水
 *   node tools/crawl-titles.cjs --delay 3000    # 每条之间停 3 秒
 *   node tools/crawl-titles.cjs --prune         # 清掉验证页/失败记录后重抓
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_PATH = path.join(ROOT, 'data', 'titles.json');
const LINKS_PATH = path.join(ROOT, 'data', 'wechat-links.json');
const HTML_PATH = path.join(ROOT, '_site', 'index.html');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) ? true : i >= 0 ? argv[i + 1] : null;
};
const DELAY = Number(flag('delay') || 2400);
const LIMIT = Number(flag('limit') || 0) || Infinity;
const TIMEOUT = Number(flag('timeout') || 20000);
const PRUNE = argv.includes('--prune');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';


/* ---------- 请求头池 + Cookie 罐 ---------- */
const UA_POOL = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"', 'Windows'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', '"Microsoft Edge";v="130", "Chromium";v="130", "Not_A Brand";v="24"', 'Windows'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"', 'macOS'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', '', 'macOS'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0', '', 'Windows'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', '', 'iOS'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"', 'Android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x18003228) NetType/WIFI Language/zh_CN', '', 'iOS'],
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const JAR = new Map(); // host -> Map(name -> value)

function jarFor(host) {
  if (!JAR.has(host)) JAR.set(host, new Map());
  return JAR.get(host);
}

function absorbCookies(res) {
  let host = '';
  try {
    host = new URL(res.url).hostname;
  } catch {
    return;
  }
  const jar = jarFor(host);
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const raw of list || []) {
    const [pair] = String(raw).split(';');
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name && value) jar.set(name, value);
  }
}

function cookieHeader(host) {
  const jar = JAR.get(host);
  if (!jar || !jar.size) return '';
  return [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
}

function buildHeaders(url) {
  const [ua, chUa] = pick(UA_POOL);
  const u = new URL(url);
  const h = {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'accept-encoding': 'gzip, deflate, br',
    'upgrade-insecure-requests': '1',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'cache-control': 'max-age=0',
    dnt: '1',
  };
  if (chUa) {
    h['sec-ch-ua'] = chUa;
    h['sec-ch-ua-mobile'] = /iPhone|Android/i.test(ua) ? '?1' : '?0';
    h['sec-ch-ua-platform'] = '"' + (/Windows/i.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /iPhone/.test(ua) ? 'iOS' : 'Android') + '"';
  }
  const ck = cookieHeader(u.hostname);
  if (ck) h.cookie = ck;
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * base * 0.6);

/* ---------- 1. 收集目标地址 ---------- */
function targets() {
  const set = new Set();
  try {
    const j = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
    for (const u of j.links || []) set.add(u);
  } catch {}
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'naked-links.json'), 'utf8'));
    for (const u of j.links || []) set.add(u);
  } catch {}
  try {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1];
      const inner = m[2];
      const text = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (text) continue;
      const href = (attrs.match(/href="([^"]*)"/) || [])[1] || '';
      if (/^https?:/i.test(href)) set.add(href.replace(/&amp;/g, '&'));
    }
  } catch {}
  return [...set];
}

/* ---------- 2. 标题提取 ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

function extractTitle(html) {
  const clean = (s) =>
    decodeEntities(String(s).replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();

  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  if (og && clean(og[1])) return clean(og[1]);

  const h1 = html.match(/<h1[^>]*id=["']activity-name["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (h1 && clean(h1[1])) return clean(h1[1]);

  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t && clean(t[1])) {
    // 去掉「标题-公众号名」这类后缀
    return clean(t[1]).replace(/\s*[-|–—_]\s*(微信公众平台|微信公众号)\s*$/, '');
  }

  const tw = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']*)["']/i);
  if (tw && clean(tw[1])) return clean(tw[1]);

  return '';
}

function isVerifyPage(html, title) {
  if (title) return false;
  if (html.length < 120000 && /环境异常|完成验证|去验证|verify_?code|该内容已被发布者删除|此内容因违规无法查看/.test(html)) return true;
  return html.length < 20000;
}

/* ---------- 3. 抓一条 ---------- */
async function fetchTitle(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: buildHeaders(url),
    });
    absorbCookies(res);
    const buf = Buffer.from(await res.arrayBuffer());
    const html = buf.toString('utf8');
    const title = extractTitle(html);
    const verify = isVerifyPage(html, title);
    return {
      status: res.status,
      title,
      finalUrl: res.url,
      verify,
      bytes: buf.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 4. 主流程 ---------- */
async function main() {
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
    console.log(`清掉无标题记录 ${n} 条`);
  }

  const todo = all.filter((u) => !(cache[u] && cache[u].title));
  const queue = todo.slice(0, LIMIT === Infinity ? todo.length : LIMIT);

  console.log(`目标 ${all.length} 条，已抓 ${all.length - todo.length} 条，本轮处理 ${queue.length} 条，间隔 ${DELAY}ms`);

  let ok = 0;
  let verifyHits = 0;
  let fail = 0;
  let backoff = 0;

  for (let i = 0; i < queue.length; i++) {
    const url = queue[i];
    let attempt = 0;
    let done = false;

    while (attempt < 3 && !done) {
      attempt++;
      try {
        const r = await fetchTitle(url);
        if (r.verify) {
          verifyHits++;
          backoff = Math.min(90000, backoff ? backoff * 2 : 10000);
          if (attempt < 3) {
            console.log(`  [验证页] 退避 ${Math.round(backoff / 1000)}s 后重试`);
            await sleep(backoff);
            continue;
          }
          cache[url] = { title: '', site: hostOf(url), status: r.status, at: today(), note: 'verify' };
          fail++;
          done = true;
        } else if (r.title) {
          cache[url] = {
            title: r.title,
            site: hostOf(url),
            status: r.status,
            at: today(),
          };
          backoff = 0;
          ok++;
          done = true;
        } else {
          cache[url] = { title: '', site: hostOf(url), status: r.status, at: today(), note: 'no-title' };
          fail++;
          done = true;
        }
      } catch (e) {
        if (attempt >= 3) {
          cache[url] = { title: '', site: hostOf(url), status: 0, at: today(), note: String(e.message).slice(0, 60) };
          fail++;
          done = true;
        } else {
          await sleep(2000 * attempt);
        }
      }
    }

    if ((i + 1) % 20 === 0 || i === queue.length - 1) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 0), 'utf8');
      const t = ok + fail > 0 ? Math.round((ok / (ok + fail)) * 100) : 0;
      console.log(
        `进度 ${i + 1}/${queue.length} · 成功 ${ok} · 失败 ${fail} · 验证页 ${verifyHits} · 成功率 ${t}% · 预计还需 ${Math.round(((queue.length - i - 1) * (DELAY * 1.3 + 900)) / 60000)} 分钟`
      );
    }

    if (i < queue.length - 1) await sleep(jitter(DELAY));
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 0), 'utf8');
  console.log(`完成：成功 ${ok}，失败 ${fail}，验证页 ${verifyHits}。缓存 ${Object.keys(cache).length} 条 → data/titles.json`);
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};
const today = () => new Date().toISOString().slice(0, 10);

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
