#!/usr/bin/env python3
"""Offline guard for retired runtime dependencies and literal CLI entry points.

This is a targeted source guard, not a TypeScript parser or a shell interpreter.
Computed paths/commands still require review. Never executes inspected commands.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = ('frontend/src', 'backend/src', 'apps/mobile-workbench/src')
SCRIPT = re.compile(r'(?:^|[;&|\s])(?:bash|node|python3?)\s+[\'"]?((?:\./|\.\./)*scripts/[\w./-]+)')
IMPORT = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]''')
RETIRED_HTTP = re.compile(r'''['"`][^'"`\n]*(?:/rtc/session/(?:ping|stop)|/rtc/graphs)(?:[?'"`])''')


def runtime_errors(path: str, source: str) -> list[str]:
    errors = []
    for match in IMPORT.finditer(source):
        target = match.group(1)
        if re.search(r'(?:^|/)(?:compat|deprecated)(?:/|$)', target):
            errors.append(f'{path}: retired dependency {target}')
        if re.search(r'(?:^|/)(?:agora-rtc-sdk-ng|agora-rtm-sdk|ten-framework)(?:/|$)', target):
            errors.append(f'{path}: parallel RTC runtime {target}')
    if RETIRED_HTTP.search(source):
        errors.append(f'{path}: retired RTC HTTP endpoint')
    if re.search(r'''(?:href\s*=\s*|(?:push|replace)\s*\(\s*)['"]/ranyan(?:[/?#'"])''', source):
        errors.append(f'{path}: navigation to retired /ranyan alias')
    return errors


def check(root: Path) -> list[str]:
    errors = []
    for directory in SOURCE_ROOTS:
        base = root / directory
        if not base.is_dir():
            errors.append(f'missing source root: {directory}')
            continue
        for path in base.rglob('*'):
            if path.suffix not in {'.ts', '.tsx', '.js', '.jsx'} or '.test.' in path.name:
                continue
            errors += runtime_errors(str(path.relative_to(root)), path.read_text())
    app = root / 'apps/mobile-workbench/App.tsx'
    if app.is_file():
        errors += runtime_errors(str(app.relative_to(root)), app.read_text())

    def check_command(label: str, command: str, cwd: Path) -> None:
        for match in SCRIPT.finditer(command):
            if not (cwd / match.group(1)).is_file():
                errors.append(f'{label}: missing CLI entry {match.group(1)}')

    for directory in ('', 'frontend', 'backend', 'apps/mobile-workbench'):
        path = root / directory / 'package.json'
        if not path.is_file():
            errors.append(f'missing package manifest: {path.relative_to(root)}')
            continue
        try:
            for name, command in json.loads(path.read_text()).get('scripts', {}).items():
                check_command(f'{path.relative_to(root)}:{name}', command, path.parent)
        except (ValueError, AttributeError, TypeError) as error:
            errors.append(f'{path.relative_to(root)}: invalid scripts: {type(error).__name__}')

    # YAML parsing avoids guessing working-directory from neighboring text.
    import yaml
    for path in sorted((root / '.github/workflows').glob('*.y*ml')):
        try:
            workflow = yaml.safe_load(path.read_text())
            default = workflow.get('defaults', {}).get('run', {}).get('working-directory', '.')
            for job in workflow.get('jobs', {}).values():
                job_cwd = job.get('defaults', {}).get('run', {}).get('working-directory', default)
                for step in job.get('steps', []):
                    cwd = step.get('working-directory', job_cwd)
                    if '${{' in cwd:
                        continue  # Computed commands/paths need review, not inferred execution.
                    check_command(str(path.relative_to(root)), step.get('run', ''), root / cwd)
        except (ValueError, AttributeError, TypeError, yaml.YAMLError) as error:
            errors.append(f'{path.relative_to(root)}: invalid workflow: {type(error).__name__}')
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='repository root (also used by fixture tests)')
    args = parser.parse_args()
    errors = check(args.root.resolve())
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('AI governance guard passed (static runtime imports/endpoints and literal CLI paths).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
