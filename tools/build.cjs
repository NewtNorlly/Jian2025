'use strict';
/**
 * Jian2025 全库文本与数据总集 —— 静态站点构建器
 * ---------------------------------------------------------------
 * 输入：../Jian2025-全库文本与数据总集.md（唯一内容来源）
 * 输出：../_site/index.html + ../_site/assets/*
 * 依赖：./vendor/markdown-it.min.js（已内置，CI 不需要 npm install）
 *
 * 版式立场：不设封面、不设导语，正文第一章即开篇。
 *
 * 用法：
 *   node tools/build.cjs           构建
 *   node tools/build.cjs --stats   构建并打印结构统计
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MarkdownIt = require('./vendor/markdown-it.min.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'Jian2025-全库文本与数据总集.md');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');

const SITE_CONFIG = {
  indexable: false, // true 时移除 noindex
  title: 'Jian2025 全库文本与数据总集',
};

const t0 = Date.now();
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ *
 * 0. 工具
 * ------------------------------------------------------------------ */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 与 GitHub 一致的标题锚点算法，保证原文里的 #第0章-使用说明 之类链接可用 */
function makeSlugger() {
  const seen = new Map();
  return function slug(raw) {
    let base = String(raw)
      .trim()
      .toLowerCase()
      .replace(/[\0-\x1F\x7F]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[!-,.\/:;<=>?@\[-\^`{|}~]/g, '')
      .replace(/^[-_]+|[-_]+$/g, '');
    if (!base) base = 'section';
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

const charCount = (s) => s.replace(/\s/g, '').length;

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function hashOf(p) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
  } catch {
    return '0';
  }
}

/* ------------------------------------------------------------------ *
 * 1. 脱敏
 * ------------------------------------------------------------------ */
const REDACTION = { applied: [] };

function redact(text) {
  let out = text;

  /* 1a. 账户备用恢复码：连续 ≥4 行、每行都是 10 位小写字母数字 */
  const lines = out.split('\n');
  const codeRe = /^[a-z0-9]{10}$/;
  const masked = [];
  let runStart = -1;
  let runLen = 0;
  const flush = () => {
    if (runLen >= 4) for (let j = runStart; j < runStart + runLen; j++) masked.push(j);
    runLen = 0;
  };
  for (let i = 0; i < lines.length; i++) {
    if (codeRe.test(lines[i].trim())) {
      if (runLen === 0) runStart = i;
      runLen++;
    } else flush();
  }
  flush();
  if (masked.length) {
    masked.forEach((i) => (lines[i] = lines[i].replace(/\S/g, '█')));
    REDACTION.applied.push({ rule: '账户备用恢复码', count: masked.length });
  }
  out = lines.join('\n');

  /* 1b. 学号 uid */
  let uidHits = 0;
  out = out.replace(/(const\s+uid\s*=\s*)(\d+)/g, (m, a, b) => {
    uidHits++;
    return a + b[0] + '█'.repeat(Math.max(0, b.length - 1));
  });
  if (uidHits) REDACTION.applied.push({ rule: '学号 uid', count: uidHits });

  /* 1c. 本人邮箱地址 */
  let mailHits = 0;
  out = out.replace(/newtnorlly@(outlook|qq|gmail)\.com/gi, (m, d) => {
    mailHits++;
    return `n█████@${d.toLowerCase()}.com`;
  });
  if (mailHits) REDACTION.applied.push({ rule: '本人邮箱', count: mailHits });

  return out;
}

/* ------------------------------------------------------------------ *
 * 2. 预处理
 * ------------------------------------------------------------------ */
function preprocess(src) {
  let s = src;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '%%BR%%');
  return s;
}

/* ------------------------------------------------------------------ *
 * 3. 解析并改写 token
 * ------------------------------------------------------------------ */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  const href = t.attrGet('href') || '';
  if (/^https?:/i.test(href)) {
    t.attrSet('target', '_blank');
    t.attrSet('rel', 'noopener noreferrer');
    t.attrJoin('class', 'ext');
  }
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.code_inline = (tokens, idx) =>
  `<code class="tok">${esc(tokens[idx].content)}</code>`;

md.renderer.rules.fence = (tokens, idx) =>
  `<pre class="code"><code>${esc(tokens[idx].content)}</code></pre>`;

const inlineText = (tok) => {
  if (!tok || !tok.children) return '';
  return tok.children
    .filter((c) => c.type === 'text' || c.type === 'code_inline')
    .map((c) => c.content)
    .join('');
};

const CH_RE = /^第\s*(\d+)\s*章[\s　]*(.*)$/;
const AP_RE = /^附录\s*([A-Za-z])[\s　]*(.*)$/;

function buildSite(source) {
  const tokens = md.parse(source, {});
  const slug = makeSlugger();
  const out = [];
  const chapters = [];
  const html = (s) => ({ type: 'html_block', content: s, block: true });

  const stats = { tables: 0, figures: 0, images: 0, chars: 0, paras: 0, sections: 0 };
  let figNo = 0;
  let cur = null;

  const openChapter = (ch) => {
    if (cur) out.push(html('</div></section>'));
    cur = ch;
    chapters.push(ch);
    out.push(html(`<section class="chapter" id="${ch.key}" data-num="${esc(ch.num)}">`));
    out.push(
      html(
        `<header class="ch-head">` +
          `<h2 class="ch-title" id="${ch.id}">${esc(ch.title)}` +
          `<a class="anchor" href="#${ch.id}" aria-hidden="true" tabindex="-1">§</a></h2>` +
          `</header>` +
          `<div class="ch-body">`
      )
    );
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    /* ---- H2：只有「第N章 / 附录X」才开新章 ---- */
    if (t.type === 'heading_open' && t.tag === 'h2') {
      const text = inlineText(tokens[i + 1]).trim();
      let ch = null;
      let m;
      if ((m = text.match(CH_RE))) {
        ch = {
          key: `ch-${String(m[1]).padStart(2, '0')}`,
          num: String(m[1]).padStart(2, '0'),
          title: m[2] || text,
          id: slug(text),
        };
      } else if ((m = text.match(AP_RE))) {
        ch = {
          key: `ch-${m[1].toLowerCase()}`,
          num: m[1].toUpperCase(),
          title: m[2] || text,
          id: slug(text),
        };
      }
      if (ch) {
        openChapter(ch);
        stats.sections++;
        i += 2;
        continue;
      }
      // 章内 H2（原文里被 --- 误判成标题的行）
      const id = slug(text);
      out.push(
        html(
          `<h2 class="h2in" id="${id}">${esc(text)}` +
            `<a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">§</a></h2>`
        )
      );
      i += 2;
      continue;
    }

    /* ---- H3–H6 ---- */
    if (t.type === 'heading_open' && /^h[3-6]$/.test(t.tag)) {
      const text = inlineText(tokens[i + 1]).trim();
      const id = slug(text);
      out.push(
        html(
          `<${t.tag} id="${id}">${esc(text)}` +
            `<a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">§</a></${t.tag}>`
        )
      );
      i += 2;
      continue;
    }

    /* ---- 图版：只含图片的段落，连续合并 ---- */
    if (t.type === 'paragraph_open') {
      const imgs = [];
      const collectFrom = (start) => {
        const got = [];
        const j = start + 1;
        if (!tokens[j] || tokens[j].type !== 'inline') return null;
        const kids = tokens[j].children || [];
        for (const c of kids) {
          if (c.type === 'text' && !c.content.trim()) continue;
          if (c.type === 'image') {
            got.push(c);
            continue;
          }
          return null;
        }
        if (!tokens[j + 1] || tokens[j + 1].type !== 'paragraph_close') return null;
        return got;
      };
      let cursor = i;
      let total = 0;
      for (;;) {
        const got = collectFrom(cursor);
        if (!got || got.length === 0) break;
        imgs.push(...got);
        total++;
        cursor += 3;
      }
      if (total > 0) {
        figNo++;
        stats.figures++;
        stats.images += imgs.length;
        const paths = imgs.map((im) => im.attrGet('src') || '').filter(Boolean);
        out.push(
          html(
            `<figure class="plate" title="${esc(paths.join('\n'))}">` +
              `<figcaption>图版 ${String(figNo).padStart(3, '0')}` +
              `<span class="plate__n">${imgs.length} 幅</span>` +
              `</figcaption></figure>`
          )
        );
        i = cursor - 1;
        continue;
      }
    }

    /* ---- 表格 ---- */
    if (t.type === 'table_open') {
      stats.tables++;
      // 统计列数：表头单元格个数
      let cols = 0;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'th_open') cols++;
        else if (tokens[j].type === 'tbody_open' || tokens[j].type === 'table_close') break;
      }
      out.push(
        html(
          `<div class="tw${cols >= 7 ? ' tw--wide' : ''}" role="region" aria-label="数据表" tabindex="0"` +
            ` data-cols="${cols}" style="--c:${cols}">`
        )
      );
      out.push(t);
      continue;
    }
    if (t.type === 'table_close') {
      out.push(t);
      out.push(html('</div>'));
      continue;
    }

    /* ---- 分隔线 ---- */
    if (t.type === 'hr') {
      out.push(html('<hr class="rule">'));
      continue;
    }

    if (t.type === 'inline') stats.chars += charCount(inlineText(t));
    if (t.type === 'paragraph_open') stats.paras++;

    out.push(t);
  }
  if (cur) out.push(html('</div></section>'));

  let bodyHtml = md.renderer.render(out, md.options, {});
  bodyHtml = bodyHtml
    .replace(/ style="text-align:right"/g, ' class="num"')
    .replace(/ style="text-align:center"/g, ' class="ctr"');
  bodyHtml = bodyHtml.split('%%BR%%').join('<br>');

  /* --- 版式产物 --- */
  const vCss = hashOf(path.join(SITE, 'swiss.css'));
  const vJs = hashOf(path.join(SITE, 'app.js'));

  const thumbs = chapters
    .map(
      (c) =>
        `<a class="thumb" href="#${c.key}" data-target="${c.key}">` +
        `<span class="thumb__tick" aria-hidden="true"></span>` +
        `<span class="thumb__t">${esc(c.title)}</span></a>`
    )
    .join('\n');

  const page = `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SITE_CONFIG.title)}</title>
<meta name="description" content="Jian2025 全库文本与数据总集 —— 274 个文本文件的逐份抄录与重排：微信收藏、长桑年度笔记、Outlook 便笺、QQ 收藏。">
${SITE_CONFIG.indexable ? '' : '<meta name="robots" content="noindex, nofollow">'}
<meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23000'/%3E%3C/svg%3E">
<link rel="stylesheet" href="assets/swiss.css?v=${vCss}">
</head>
<body>
<a class="skip" href="#doc">跳到正文</a>

<h1 class="sr-only">${esc(SITE_CONFIG.title)}</h1>

<header class="topbar" id="topbar">
  <div class="topbar__in">
    <p class="topbar__brand"><span class="topbar__latin">Jian2025</span><span class="topbar__div">/</span><span class="topbar__cn">全库文本与数据总集</span></p>
    <p class="topbar__now" id="nowChapter" aria-live="polite"></p>
  </div>
  <div class="progress" aria-hidden="true"><span id="progressBar"></span></div>
</header>

<nav class="thumbs" id="thumbs" aria-label="章节目录">
${thumbs}
</nav>

<main id="doc">
${bodyHtml}
</main>

<footer class="colophon">
  <p>源文件 <code class="tok">Jian2025-全库文本与数据总集.md</code>　·　正文 ${fmt(
    stats.chars
  )} 字符　·　表 ${fmt(stats.tables)} 张　·　图版 ${fmt(stats.figures)} 处　·　建于 ${new Date()
    .toISOString()
    .slice(0, 10)}</p>
  <p>网页版对账户恢复码、学号与本人邮箱地址做了遮蔽处理；其余正文与源文件逐字一致。每次推送由 GitHub Actions 重新构建发布。</p>
</footer>

<script src="assets/app.js?v=${vJs}" defer></script>
</body>
</html>`;

  return { page, chapters, stats };
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */
function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`找不到源文件：${SRC}`);
    process.exit(1);
  }
  let src = fs.readFileSync(SRC, 'utf8');
  const before = src.length;

  // 开门见山：自第一章起排，封面、状态更新、目录一律不进页面
  const startAt = src.search(/^##\s*第\s*0\s*章/m);
  if (startAt < 0) {
    console.error('未找到「## 第0章」，无法定位正文起点');
    process.exit(1);
  }
  src = src.slice(startAt);

  src = preprocess(src);
  src = redact(src);
  log(`读取源文件 ${fmt(before)} 字符，正文自第一章起 ${fmt(src.length)} 字符`);

  const { page, chapters, stats } = buildSite(src);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), page, 'utf8');
  for (const f of ['swiss.css', 'app.js']) {
    const p = path.join(SITE, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(OUT, 'assets', f));
  }
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');

  log('脱敏：' + (REDACTION.applied.map((r) => `${r.rule} ×${r.count}`).join('，') || '无'));
  log(
    `章节 ${chapters.length} · 表 ${fmt(stats.tables)} · 图版 ${fmt(stats.figures)} · 段落 ${fmt(stats.paras)} · 正文 ${fmt(stats.chars)} 字`
  );
  log(
    `产物 ${(fs.statSync(path.join(OUT, 'index.html')).size / 1048576).toFixed(2)} MB → ${path.relative(ROOT, OUT)}  (${Date.now() - t0} ms)`
  );

  if (process.argv.includes('--stats')) {
    log('\n章节目录：');
    for (const c of chapters) log(`  ${c.num}  ${c.title}`);
  }
}

main();
