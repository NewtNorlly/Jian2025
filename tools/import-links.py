#!/usr/bin/env python3
"""
把《微信收藏文章链接表.xlsx》导出成构建器用的 JSON。

用法：
    python tools/import-links.py "C:\\Users\\NewtN\\Desktop\\微信收藏文章链接表.xlsx"

产物：data/wechat-links.json
只做一件事：逐行读出第一列的非空链接，保序、去重。
"""

import json
import os
import sys
from datetime import date

try:
    import openpyxl
except ImportError:
    sys.exit("需要 openpyxl：pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(ROOT, "data", "微信收藏文章链接表.xlsx")
OUT = os.path.join(ROOT, "data", "wechat-links.json")


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        sys.exit(f"找不到表格：{src}")

    wb = openpyxl.load_workbook(src, data_only=True)
    links: list[str] = []
    seen: set[str] = set()

    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            if not row:
                continue
            cell = row[0]
            if cell is None:
                continue
            url = str(cell).strip()
            if not url.lower().startswith("http") or url in seen:
                continue
            seen.add(url)
            links.append(url)

    payload = {
        "source": os.path.basename(src),
        "exported": date.today().isoformat(),
        "count": len(links),
        "links": links,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=0)

    print(f"导出 {len(links)} 条 → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
