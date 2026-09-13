#!/usr/bin/env python3
"""Release guard regressions; no EAS build, upload or production side effects."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / '.github/workflows/android-preview-release.yml').read_text()
RELEASE = (ROOT / 'scripts/release-android-preview.sh').read_text()


class AndroidReleaseGuards(unittest.TestCase):
    def test_build_then_automatic_same_artifact_publication(self):
        publish = WORKFLOW.split('  publish-candidate:')[1]
        self.assertIn('needs: [select-source, build-candidate]', publish)
        self.assertIn("needs.build-candidate.result == 'success'", publish)
        self.assertIn("needs.build-candidate.result == 'skipped'", publish)
        self.assertIn('!cancelled()', publish)
        self.assertIn("github.ref == 'refs/heads/main'", publish)
        self.assertIn('environment: production', publish)
        self.assertNotIn('inputs.action', publish)
        self.assertNotIn('eas-cli', publish)
        self.assertIn('run-id: ${{ needs.select-source.outputs.artifact_run_id }}', publish)
        self.assertIn('cmp "$RUNNER_TEMP/published.apk"', publish)
        self.assertIn('verify-android-artifact.py', publish)
        self.assertIn('validatePublication', publish)

    def test_pinned_source_and_build_only(self):
        candidate = WORKFLOW.split('  build-candidate:')[1].split('  publish-candidate:')[0]
        self.assertIn('ref: ${{ needs.select-source.outputs.sha }}', candidate)
        self.assertIn('ref: ${{ github.sha }}', candidate)
        self.assertIn('environment: android-build', candidate)
        self.assertNotIn('secrets.DEPLOY_', candidate)
        self.assertIn('build-artifact "$RUNNER_TEMP/android-release"', candidate)
        self.assertIn("metadata['gitCommitHash'] != os.environ['SOURCE_SHA']", candidate)
        self.assertIn('--json --non-interactive', RELEASE)
        self.assertIn("cron: '30 10 * * 1-5'", WORKFLOW)

    def test_legacy_entries_fail_before_side_effects(self):
        commands = [
            ['scripts/release-android-preview.sh', 'build'],
            ['scripts/release-android-preview.sh', 'publish-latest'],
            ['scripts/start-android-preview-release-background.sh'],
            ['scripts/ops/sync-android-main-release.sh'],
            ['scripts/ops/configure-android-release-github.sh'],
        ]
        for args in commands:
            result = subprocess.run(['bash', str(ROOT / args[0]), *args[1:]], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn('retired', result.stderr.lower())
        installer = (ROOT / 'scripts/ops/install-cpu1-reliability-hardening.sh').read_text()
        self.assertIn('retire-android-main-sync.sh', installer)
        self.assertNotIn('enable --now voxflame-android-main-sync', installer)
        self.assertFalse((ROOT / 'infra/systemd/voxflame-android-main-sync.timer').exists())

    def test_token_normalizes_ci_and_file_without_printing(self):
        wrapper = ROOT / 'apps/mobile-workbench/scripts/with-expo-token.sh'
        for from_file in [False, True]:
            with self.subTest(from_file=from_file), tempfile.TemporaryDirectory() as temp:
                env = os.environ.copy()
                env['XDG_CONFIG_HOME'] = temp
                env['EXPO_TOKEN'] = '' if from_file else 'x' * 25 + '\r\n'
                if from_file:
                    token = Path(temp) / 'voxflame/expo-token'
                    token.parent.mkdir()
                    token.write_text('x' * 25 + '\r\n')
                result = subprocess.run(['bash', str(wrapper), 'python3', '-c',
                    "import os; assert os.environ['EXPO_TOKEN'] == 'x' * 25"],
                    env=env, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, '')

    def test_invalid_token_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            env = {**os.environ, 'EXPO_TOKEN': 'short\n', 'XDG_CONFIG_HOME': temp}
            result = subprocess.run(['bash', str(ROOT / 'apps/mobile-workbench/scripts/with-expo-token.sh'),
                                     'echo', 'SHOULD_NOT_RUN'], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('SHOULD_NOT_RUN', result.stdout)

    def test_candidate_metadata_does_not_claim_publication(self):
        self.assertNotIn('publishedAt: new Date()', RELEASE)
        self.assertIn('artifactCreatedAt: new Date()', RELEASE)
        self.assertIn('version.patch', RELEASE)


if __name__ == '__main__':
    subprocess.run(['node', '--test', str(ROOT / 'scripts/test-android-release-workflow.cjs')], check=True)
    subprocess.run(['python3', str(ROOT / 'scripts/test-android-artifact-publication.py')], check=True)
    subprocess.run(['python3', str(ROOT / 'scripts/test-android-retire.py')], check=True)
    unittest.main()
