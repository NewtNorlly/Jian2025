# Jian2025 · 全库文本与数据总集（网页版）

把 `Jian2025-全库文本与数据总集.md` 排成一条可以自上而下连续阅读的长页。
正文与 Markdown 源文件逐字对应；每次推送到 `main`，GitHub Actions 自动重建并发布。

- 线上地址：<https://newtnorlly.github.io/Jian2025/>
- 内容来源：`Jian2025-全库文本与数据总集.md`（唯一事实来源）

## 版式

瑞士国际主义网格：12 栏模块化网格，正文固定落在第 4–10 栏，左栏留白；
细线分栏、纯白底色、无渐变无阴影无圆角。

- 中文宋体，西文 Times New Roman（全场单一字族，代码同）
- 任何文字不小于 20px；字号阶梯只有 28 / 24 / 22 / 20 四级
- 层级靠留白、字重与细线区分，不靠字号跳变
- 无封面、无导语，第一章即开篇

## 目录结构

```
Jian2025-全库文本与数据总集.md   正文源文件
site/swiss.css                    样式
site/app.js                       进度线 / 当前章 / 右缘刻度
tools/build.cjs                   构建器：Markdown → _site/index.html
tools/serve.cjs                   本地预览服务器
tools/vendor/markdown-it.min.js   内置解析器（CI 无需 npm install）
.github/workflows/deploy.yml      Actions：构建 + 发布 Pages
_site/                            构建产物（不入库）
```

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

## 脱敏

网页版对下列内容做遮蔽（构建时执行，源文件不动）：

| 位置 | 处理 |
|---|---|
| 5.4.3 Outlook 备用恢复码（8 组） | 替换为 `██████████` |
| 6.6 评教脚本中的学号 | 保留首位，其余替换为 `█` |
| 本人邮箱地址（含恢复密钥文件名） | 替换为 `n█████@域名` |

规则集中在 `tools/build.cjs` 的 `redact()` 里，可随时调整。
页面默认带 `noindex`（不被搜索引擎收录），如需放开，把 `SITE_CONFIG.indexable` 改为 `true`。

## 许可

代码部分随仓库 LICENSE（Apache-2.0）。正文收录的第三方文章版权归原作者所有。
