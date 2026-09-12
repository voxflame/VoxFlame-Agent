#!/usr/bin/env python3
"""CI regressions without Android, network calls, credentials or production writes."""
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MobileCI(unittest.TestCase):
    def test_configured_icons_are_tracked_square_pngs(self):
        app = ROOT / 'apps/mobile-workbench'
        expo = json.loads((app / 'app.json').read_text())['expo']
        for name in [expo['icon'], expo['android']['adaptiveIcon']['foregroundImage']]:
            icon = (app / name).resolve()
            png = icon.read_bytes()
            self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
            width, height = struct.unpack('>II', png[16:24])
            self.assertEqual(width, height)
            self.assertGreaterEqual(width, 512)
            result = subprocess.run(['git', 'ls-files', '--error-unmatch', str(icon.relative_to(ROOT))],
                                    cwd=ROOT, capture_output=True)
            self.assertEqual(result.returncode, 0)

    def test_ci_is_headless_bounded_and_keeps_tests(self):
        workflow = (ROOT / '.github/workflows/mobile-android-maestro.yml').read_text()
        for required in ['reactivecircus/android-emulator-runner@4c44018e59b437e86cdfc41da381398f93ed8808',
                         '-no-window', 'emulator-boot-timeout: 300', 'api-level: 33',
                         'arch: x86_64', 'mode=off', 'mode=on', 'if: always()',
                         'bash scripts/mobile-android-smoke.sh', 'contents: read']:
            self.assertIn(required, workflow)
        self.assertNotIn('continue-on-error', workflow)
        self.assertNotIn('start-device', workflow)
        self.assertNotIn('yes | sdkmanager', workflow)

    def run_smoke(self, failure='', credentials=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'apps/mobile-workbench').mkdir(parents=True)
            shutil.copy(ROOT / 'scripts/mobile-android-smoke.sh', root / 'scripts')
            binary = root / 'bin'
            binary.mkdir()
            for command in ['adb', 'maestro']:
                stub = binary / command
                stub.write_text('#!/usr/bin/env bash\nset -eu\n'
                    'echo "$(basename "$0") $*" >> "$TEST_LOG"\n'
                    'case "$(basename "$0") $*" in\n'
                    '  "adb install"*) [[ "$FAIL_AT" != install ]] || exit 17;;\n'
                    '  "adb logcat"*) [[ "$FAIL_AT" != logs ]] || exit 9;;\n'
                    '  maestro*) [[ "$FAIL_AT" != test ]] || exit 23;;\n'
                    'esac\n')
                stub.chmod(0o755)
            env = {**os.environ, 'PATH': f'{binary}:{os.environ["PATH"]}',
                   'MAESTRO_BIN': str(binary / 'maestro'), 'TEST_LOG': str(root / 'calls'),
                   'FAIL_AT': failure, 'GITHUB_STEP_SUMMARY': str(root / 'summary'),
                   'MAESTRO_TEST_EMAIL': 'test@example.invalid' if credentials else '',
                   'MAESTRO_TEST_PASSWORD': 'fixture-only' if credentials else ''}
            result = subprocess.run(['bash', str(root / 'scripts/mobile-android-smoke.sh')],
                                    env=env, capture_output=True, text=True)
            return result, (root / 'calls').read_text()

    def test_boot_runs_and_missing_auth_is_reported(self):
        result, calls = self.run_smoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('release-boot-smoke.yml', calls)
        self.assertIn('Authenticated smoke NOT RUN', result.stdout)
        self.assertNotIn('authenticated-release-smoke.yml', calls)

    def test_configured_auth_runs(self):
        result, calls = self.run_smoke(credentials=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn('authenticated-release-smoke.yml', calls)

    def test_install_failure_is_not_swallowed(self):
        result, calls = self.run_smoke('install')
        self.assertEqual(result.returncode, 17)
        self.assertNotIn('maestro test', calls)
        self.assertIn('adb logcat', calls)

    def test_smoke_failure_is_not_swallowed(self):
        result, calls = self.run_smoke('test', True)
        self.assertEqual(result.returncode, 23)
        self.assertNotIn('authenticated-release-smoke.yml', calls)
        self.assertIn('adb logcat', calls)

    def test_log_collection_does_not_mask_pass(self):
        result, _ = self.run_smoke('logs')
        self.assertEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
