#!/usr/bin/env python3
"""Isolated byte/provenance/publication regressions. No cloud or production access."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('artifact', ROOT / 'scripts/verify-android-artifact.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = 'a' * 40

class Publication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.release = self.root / 'served'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        curl = self.bin / 'curl'
        curl.write_text('''#!/usr/bin/env python3
import os, pathlib, shutil, sys
args = sys.argv
out = pathlib.Path(args[args.index('--output') + 1])
headers = pathlib.Path(args[args.index('--dump-header') + 1])
if os.environ.get('FAIL_PUBLIC') == 'network': sys.exit(22)
headers.write_text('Content-Type: application/vnd.android.package-archive\\nCache-Control: no-store\\n')
if os.environ.get('FAIL_PUBLIC') == 'bytes': out.write_bytes(b'stale CDN')
else: shutil.copyfile(pathlib.Path(os.environ['SERVED']) / 'VoxFlame-Android.apk', out)
''')
        curl.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.bin) + ':' + os.environ['PATH'], 'SERVED': str(self.release)}

    def artifact(self, code=1, suffix=''):
        path = self.root / f'artifact-{code}{suffix}'
        path.mkdir()
        apk = path / 'VoxFlame-Android.apk'
        with zipfile.ZipFile(apk, 'w') as archive:
            archive.writestr('AndroidManifest.xml', f'{code}{suffix}')
        (path / 'version.patch').write_text('version patch')
        m = dict(sourceSha=SHA, gitCommitHash=SHA, candidateRunId='42', buildId=f'build-{code}{suffix}',
                 appVersion=f'0.1.{code}', appBuildVersion=str(code),
                 sha256=hashlib.sha256(apk.read_bytes()).hexdigest(), sizeBytes=apk.stat().st_size,
                 versionPatchSha256=hashlib.sha256((path / 'version.patch').read_bytes()).hexdigest())
        (path / 'VoxFlame-Android.json').write_text(json.dumps(m))
        return path

    def publish(self, artifact, ok=True, failure=''):
        result = subprocess.run(['bash', str(ROOT / 'scripts/publish-android-artifact.sh'),
            str(artifact / 'VoxFlame-Android.apk'), str(artifact / 'VoxFlame-Android.json'),
            str(self.release), 'https://invalid.local/download'], text=True, capture_output=True,
            env={**self.env, 'FAIL_PUBLIC': failure})
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.release.glob('VoxFlame*')}

    def test_publish_upgrade_idempotent_previous(self):
        a, b = self.artifact(1), self.artifact(2)
        self.publish(a)
        self.publish(b)
        self.assertEqual((self.release / 'VoxFlame-Android.previous.apk').read_bytes(), (a / 'VoxFlame-Android.apk').read_bytes())
        before = self.snapshot()
        self.publish(b)
        self.assertEqual(before, self.snapshot())

    def test_downgrade_and_same_version_different_bytes_rejected(self):
        current = self.artifact(2)
        self.publish(current)
        before = self.snapshot()
        for a in (self.artifact(1), self.artifact(2, 'tamper')):
            self.publish(a, ok=False)
            self.assertEqual(before, self.snapshot())

    def test_public_failure_restores_current_and_previous(self):
        a, b, c = self.artifact(1), self.artifact(2), self.artifact(3)
        self.publish(a); self.publish(b)
        before = self.snapshot()
        for failure in ('network', 'bytes'):
            self.publish(c, ok=False, failure=failure)
            self.assertEqual(before, self.snapshot())

    def test_first_public_failure_leaves_no_current(self):
        self.publish(self.artifact(), ok=False, failure='bytes')
        self.assertEqual(self.snapshot(), {})

    def test_invalid_input_leaves_current_intact(self):
        a, b = self.artifact(1), self.artifact(2)
        self.publish(a)
        before = self.snapshot()
        (b / 'VoxFlame-Android.apk').write_bytes(b'invalid')
        self.publish(b, ok=False)
        self.assertEqual(before, self.snapshot())

    def test_lock_blocks_concurrent_publisher(self):
        self.release.mkdir()
        with (self.release / '.publish.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.publish(self.artifact(), ok=False)
            self.assertEqual(self.snapshot(), {})

    def test_receiver_tar_trust_boundary(self):
        a = self.artifact()
        for kind in ('valid', 'extra', 'symlink', 'duplicate'):
            with self.subTest(kind=kind):
                archive = self.root / f'{kind}.tar'
                with tarfile.open(archive, 'w') as tar:
                    for name in ('VoxFlame-Android.apk', 'VoxFlame-Android.json'):
                        if kind == 'symlink' and name.endswith('.apk'):
                            info = tarfile.TarInfo(name)
                            info.type = tarfile.SYMTYPE
                            info.linkname = str(a / name)
                            tar.addfile(info)
                        else: tar.add(a / name, arcname=name)
                    if kind == 'extra': tar.add(a / 'version.patch', arcname='version.patch')
                    if kind == 'duplicate': tar.add(a / 'VoxFlame-Android.apk', arcname='VoxFlame-Android.apk')
                before = self.snapshot() if self.release.exists() else {}
                with archive.open('rb') as stream:
                    result = subprocess.run(['bash', str(ROOT / 'scripts/ops/receive-android-ci-artifact.sh')],
                        stdin=stream, capture_output=True, text=True, env={**self.env,
                        'VOXFLAME_ANDROID_RELEASE_DIR': str(self.release),
                        'VOXFLAME_ANDROID_PUBLISH_SCRIPT': str(ROOT / 'scripts/publish-android-artifact.sh'),
                        'VOXFLAME_ANDROID_DOWNLOAD_URL': 'https://invalid.local/download'})
                self.assertEqual(result.returncode == 0, kind == 'valid', result.stderr)
                if kind != 'valid': self.assertEqual(before, self.snapshot())

    def test_provenance_valid(self):
        module.verify(self.artifact(), SHA, '42')

    def test_provenance_metadata_tampering(self):
        for field, value in [('sourceSha', 'b' * 40), ('gitCommitHash', 'b' * 40),
                             ('candidateRunId', '43'), ('sha256', '0' * 64), ('sizeBytes', 0),
                             ('versionPatchSha256', '0' * 64)]:
            with self.subTest(field=field):
                a = self.artifact(1, field)
                m = json.loads((a / 'VoxFlame-Android.json').read_text())
                m[field] = value
                (a / 'VoxFlame-Android.json').write_text(json.dumps(m))
                with self.assertRaises(ValueError): module.verify(a, SHA, '42')

    def test_missing_symlink_and_patch_tamper(self):
        for name in ('VoxFlame-Android.apk', 'VoxFlame-Android.json', 'version.patch'):
            a = self.artifact(1, name)
            file = a / name
            target = self.root / name
            file.rename(target)
            with self.assertRaises(ValueError): module.verify(a, SHA, '42')
            file.symlink_to(target)
            with self.assertRaises(ValueError): module.verify(a, SHA, '42')
        a = self.artifact(2)
        (a / 'version.patch').write_text('tampered')
        with self.assertRaises(ValueError): module.verify(a, SHA, '42')

    def test_zip_without_manifest_rejected(self):
        a = self.artifact()
        with zipfile.ZipFile(a / 'VoxFlame-Android.apk', 'w') as archive: archive.writestr('bad', 'bad')
        m = json.loads((a / 'VoxFlame-Android.json').read_text())
        m.update(sha256=hashlib.sha256((a / 'VoxFlame-Android.apk').read_bytes()).hexdigest(), sizeBytes=(a / 'VoxFlame-Android.apk').stat().st_size)
        (a / 'VoxFlame-Android.json').write_text(json.dumps(m))
        with self.assertRaises(ValueError): module.verify(a, SHA, '42')
        self.publish(a, ok=False)

if __name__ == '__main__': unittest.main()
