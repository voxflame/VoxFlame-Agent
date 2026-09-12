#!/usr/bin/env python3
"""Render RO-017 policy reports via the Playwright CLI."""
from __future__ import annotations

import json
import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "output/playwright/policy-pdf"
CLI = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills/playwright/scripts/playwright_cli.sh"
SOURCE = ROOT / "上海杭州算力补贴政策汇报(1).html"
REPORT = ROOT / "research/product-engineering/RO-017-compute-policy-briefing-2026-09-07.html"
BUSINESS_REPORT = ROOT / "research/product-engineering/RO-017-business-layout-report-2026-09-07.html"
ORIGINAL_CSS = """
body{font-family:"Noto Sans CJK SC",sans-serif}
@media print{
 @page{size:A4;margin:12mm}body{background:#fff}.wrap{max-width:none;padding:0}
 header.hero{box-shadow:none}section.card{box-shadow:none;box-decoration-break:clone}
 h2,h3,h4{break-after:avoid}table,tr,.callout,.action,.kv{break-inside:avoid}
 a{overflow-wrap:anywhere}p,li{orphans:3;widows:3}
 *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
"""


def cli(*args: str) -> str:
    """Use a dedicated browser session without touching other active sessions."""
    result = subprocess.run(
        ["bash", str(CLI), "-s=ro017-export", *args],
        cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        check=False,
    )
    if result.returncode or "### Error" in result.stdout:
        raise RuntimeError(result.stdout[-3000:])
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edition", choices=("legacy", "business"), default="legacy")
    args = parser.parse_args()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    cli("open", "about:blank")
    jobs = [
        (SOURCE, ROOT / "上海杭州算力补贴政策汇报(1).pdf", ORIGINAL_CSS),
        (REPORT, ROOT / "上海杭州算力补贴政策汇报-余杭优先与子公司布局核验版.pdf", ""),
    ]
    if args.edition == "business":
        jobs = [(BUSINESS_REPORT, ROOT / "上海杭州算力政策及业务布局建议.pdf", "")]
    try:
        for source, output, css in jobs:
            code = """async (page) => {
                await page.setContent(%s, {waitUntil:"load"});
                const css = %s;
                if (css) await page.addStyleTag({content:css});
                await page.evaluate(() => document.fonts.ready);
                await page.emulateMedia({media:"print"});
                const layout = await page.evaluate(() => Array.from(document.querySelectorAll('.sheet')).map((sheet, i) => {
                    const content = sheet.querySelector('.content').getBoundingClientRect();
                    const footer = sheet.querySelector('.footer').getBoundingClientRect();
                    const bounds = sheet.getBoundingClientRect();
                    const horizontalOverflow = Array.from(sheet.querySelectorAll('*')).some(element => {
                        const rect = element.getBoundingClientRect();
                        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
                    });
                    return {page:i+1, gap:footer.top-content.bottom, horizontalOverflow};
                }));
                if (layout.some(item => item.gap < 8 || item.horizontalOverflow)) throw new Error('Report layout overflow: '+JSON.stringify(layout));
                await page.pdf({path:%s, format:"A4", printBackground:true, preferCSSPageSize:true});
                return {output:%s, layout};
            }""" % tuple(json.dumps(x, ensure_ascii=False) for x in (source.read_text(), css, str(output), str(output)))
            log = cli("run-code", code)
            (ARTIFACTS / f"{source.stem}-export.log").write_text(log)
            result_text = log.split("### Result\n", 1)[1].split("\n### ", 1)[0].strip()
            result = json.loads(result_text)
            (ARTIFACTS / f"{source.stem}-layout.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n"
            )
            print(f"Exported: {output.name} ({output.stat().st_size:,} bytes)")
    finally:
        cli("close")


if __name__ == "__main__":
    main()
