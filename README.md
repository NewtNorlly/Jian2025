# Jian2025 · 全库文本与数据总集（网页版）

把 `Jian2025-全库文本与数据总集.md` 排成一条可以自上而下连续阅读的长页。
正文与 Markdown 源文件逐字对应（含原文的换行）；每次推送到 `main`，GitHub Actions 自动重建并发布。

- 线上地址：<https://newtnorlly.github.io/Jian2025/>
- 内容来源：`Jian2025-全库文本与数据总集.md`（主体）+ `data/微信收藏文章链接表.xlsx`（第 10 章）

## 版式

瑞士国际主义网格：12 栏模块化网格，正文固定落在第 4–10 栏，左栏留白；
细线分栏、纯白底色、无渐变无阴影无圆角。

- 中文宋体，西文 Times New Roman（全场单一字族，代码同）
- 任何文字不小于 20px；字号阶梯只有 28 / 24 / 22 / 20 四级
- 层级靠留白、字重与细线区分，不靠字号跳变
- 无封面、无导语，第一章即开篇
- 原文的单行换行照原样保留（构建时 `breaks: true`），账号、目录树一类的分条内容不会被挤成一行

## 目录结构

```
Jian2025-全库文本与数据总集.md     正文源文件
data/微信收藏文章链接表.xlsx        第 10 章的数据源
data/wechat-links.json            由上面那份表格导出的构建输入
data/naked-links.json             构建时产出的「无文字链接」清单
data/titles.json                  抓取到的网页标题（断点续爬的缓存）
site/swiss.css                    样式
site/app.js                       进度线 / 当前章 / 右缘刻度
site/favicon.svg                  站点图标
tools/build.cjs                   构建器：Markdown → _site/index.html
tools/import-links.py             把链接表 xlsx 导出成 JSON
tools/crawl-titles.cjs            批量抓网页标题（curl + 本地代理，流式截断）
tools/serve.cjs                   本地预览服务器
tools/shot.cjs                    无头 Chrome 截图（开发自用）
tools/vendor/markdown-it.min.js   内置解析器（CI 无需 npm install）
.github/workflows/deploy.yml      Actions：构建 + 发布 Pages
_site/                            构建产物（不入库）
```

## 章节

正文由 Markdown 里的 `## 第N章` / `## 附录 X` 决定。第 10 章「微信收藏文章链接表」不属于
Markdown 正文，由构建器在「附录 A」之前插入，数据来自 `data/wechat-links.json`。

更新链接表：

```bash
python tools/import-links.py "C:\\Users\\NewtN\\Desktop\\微信收藏文章链接表.xlsx"
```

## 抓取网页标题

链接登记表的「标题」列、以及正文里原本只有图片的链接文字，都由
`data/titles.json` 提供，它由采集器生成：

```bash
node tools/crawl-titles.cjs --limit 20 --concurrency 3   # 先试 20 条
node tools/crawl-titles.cjs --prune --minutes 18         # 跑 18 分钟
```

- **走本地代理**：微信对直连 IP 在十来次请求后会强制「环境异常」验证，走
  `http://127.0.0.1:7890` 这样的代理出口可以规避；没有代理时加 `--proxy ""` 直连。
- **流式截断**：文章页动辄 3.5MB，采到 `</head>` 或 320KB 就掐断连接，省流量。
- **断点续爬**：已有标题的不再请求；失败记录用 `--prune` 清掉后可再来一轮。
- 限流仍然存在：并发 4 时约 0.6 条/秒、成功率 85%；并发 8 反而会被封，别开太大。

## 本地使用

```bash
node tools/build.cjs      # 生成 _site/
node tools/serve.cjs      # 预览 http://127.0.0.1:8210/
```

`node tools/build.cjs --stats` 会打印各章结构统计。

## 自动部署

推送到 `main` 即触发 `.github/workflows/deploy.yml`：

1. `actions/checkout` 检出仓库
2. `node tools/build.cjs` 生成 `_site/`
3. `actions/upload-pages-artifact` 打包
4. `actions/deploy-pages` 发布到 GitHub Pages

仓库 Settings → Pages → Build and deployment 的 Source 必须是 **GitHub Actions**。
Pages 侧更新常要 5–10 分钟，所以发布步骤的超时已放宽到 30 分钟。

## 脱敏

**当前关闭。** 源文档里的账户、恢复码等凭证按指示保持原样（均已失效）。

构建器里保留了脱敏实现，需要时把 `tools/build.cjs` 顶部 `SITE_CONFIG.redact` 改为 `true` 即可，规则：

| 规则 | 处理 |
|---|---|
| 连续多行的 10 位恢复码 | 替换为 `██████████` |
| 评教脚本里的学号 | 保留首位，其余替换为 `█` |
| 本人邮箱地址 | 替换为 `n█████@域名` |

页面默认带 `noindex`（不被搜索引擎收录），如需放开把 `SITE_CONFIG.indexable` 改为 `true`。

## 许可

代码部分随仓库 LICENSE（Apache-2.0）。正文收录的第三方文章版权归原作者所有。
