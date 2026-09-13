#!/usr/bin/env python3
"""Read-only artifact verification; never execute code supplied by an artifact."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile


def verify(root: Path, source_sha: str, run_id: str) -> None:
    apk = root / 'VoxFlame-Android.apk'
    metadata = root / 'VoxFlame-Android.json'
    patch = root / 'version.patch'
    for path in (apk, metadata, patch):
        if not path.is_file() or path.is_symlink():
            raise ValueError('Missing or unsafe artifact file')
    m = json.loads(metadata.read_text())
    if m['sourceSha'] != source_sha or m['gitCommitHash'] != source_sha:
        raise ValueError('Source SHA mismatch')
    if str(m['candidateRunId']) != run_id:
        raise ValueError('Workflow run mismatch')
    if hashlib.sha256(apk.read_bytes()).hexdigest() != m['sha256'] or apk.stat().st_size != m['sizeBytes']:
        raise ValueError('APK integrity mismatch')
    if hashlib.sha256(patch.read_bytes()).hexdigest() != m['versionPatchSha256']:
        raise ValueError('Version patch mismatch')
    with zipfile.ZipFile(apk) as archive:
        if archive.testzip() is not None or 'AndroidManifest.xml' not in archive.namelist():
            raise ValueError('Invalid APK archive')


if __name__ == '__main__':
    verify(Path(sys.argv[1]), sys.argv[2], sys.argv[3])
    print('Android artifact provenance and bytes verified.')
