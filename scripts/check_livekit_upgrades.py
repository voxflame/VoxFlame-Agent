#!/usr/bin/env python3
"""Compare pinned LiveKit runtime versions with current stable releases."""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "VoxFlame-LiveKit-Upgrade-Audit/1.0"


def fetch_json(url: str) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def latest_agent_release() -> dict[str, object]:
    payload = fetch_json("https://api.github.com/repos/livekit/agents/releases?per_page=100")
    if not isinstance(payload, list):
        raise RuntimeError("LiveKit Agents releases response was not a list")
    candidates = [
        item
        for item in payload
        if isinstance(item, dict)
        and re.fullmatch(
            r"livekit-agents@[0-9]+\.[0-9]+\.[0-9]+",
            str(item.get("tag_name", "")),
        )
        and not item.get("prerelease")
        and not item.get("draft")
    ]
    if not candidates:
        raise RuntimeError("No stable livekit-agents release was found")
    return max(
        candidates,
        key=lambda item: version_tuple(str(item["tag_name"]).rsplit("@", 1)[-1]),
    )


def read_agent_pin() -> str:
    dockerfile = (ROOT / "livekit_agent" / "Dockerfile").read_text(encoding="utf-8")
    match = re.search(r'livekit-agents==([0-9]+\.[0-9]+\.[0-9]+)', dockerfile)
    if match is None:
        raise RuntimeError("livekit_agent/Dockerfile must pin livekit-agents exactly")
    return match.group(1)


def read_server_pin() -> str:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    match = re.search(r'livekit-server:v([0-9]+\.[0-9]+\.[0-9]+)', compose)
    if match is None:
        raise RuntimeError("docker-compose.yml must pin livekit-server exactly")
    return match.group(1)


def version_tuple(value: str) -> tuple[int, int, int]:
    return tuple(int(part) for part in value.split("."))  # type: ignore[return-value]


def main() -> int:
    current_agent = read_agent_pin()
    current_server = read_server_pin()
    latest_agent_payload = latest_agent_release()
    latest_server_payload = fetch_json(
        "https://api.github.com/repos/livekit/livekit/releases/latest"
    )
    if not isinstance(latest_server_payload, dict):
        raise RuntimeError("LiveKit Server release response was not an object")
    latest_agent_tag = str(latest_agent_payload.get("tag_name", ""))
    latest_server_tag = str(latest_server_payload.get("tag_name", ""))
    latest_agent = latest_agent_tag.rsplit("@", 1)[-1]
    latest_server = latest_server_tag.removeprefix("v")

    report = {
        "livekit_agents": {
            "current": current_agent,
            "latest": latest_agent,
            "update_available": version_tuple(latest_agent) > version_tuple(current_agent),
            "release_url": latest_agent_payload.get("html_url"),
        },
        "livekit_server": {
            "current": current_server,
            "latest": latest_server,
            "update_available": version_tuple(latest_server) > version_tuple(current_server),
            "release_url": latest_server_payload.get("html_url"),
        },
        "policy": "report_only_manual_promotion",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"LiveKit upgrade check failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
