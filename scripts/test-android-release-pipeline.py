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
    def test_candidate_and_promotion_are_independent(self):
        publish = WORKFLOW.split('  publish-candidate:')[1]
        self.assertNotIn('needs: build-candidate', publish)
        self.assertIn("inputs.action == 'publish'", publish)
        self.assertIn("github.ref == 'refs/heads/main'", publish)
        self.assertIn('environment: production', publish)
        self.assertNotIn('eas-cli', publish)
        self.assertIn('run-id: ${{ inputs.candidate_run_id }}', publish)

    def test_promotion_checks_trust_and_integrity(self):
        for guard in ["run.head_branch !== 'main'", "run.conclusion !== 'success'",
                      'run.workflow_id !== workflow.id', 'run.head_repository?.full_name',
                      'Device acceptance evidence reference required',
                      "m['sourceSha'] == m['gitCommitHash']", "m['candidateRunId']",
                      "m['versionPatchSha256']", "m['sha256']", "m['sizeBytes']"]:
            self.assertIn(guard, WORKFLOW)
        self.assertIn('cmp "$RUNNER_TEMP/published.apk"', WORKFLOW)
        self.assertNotIn('echo "Deploying exact candidate from run ${{', WORKFLOW)

    def test_pinned_source_and_build_only(self):
        candidate = WORKFLOW.split('  build-candidate:')[1].split('  publish-candidate:')[0]
        self.assertIn('ref: ${{ needs.select-source.outputs.sha }}', candidate)
        self.assertIn('ref: ${{ github.sha }}', candidate)
        self.assertIn('environment: android-build', candidate)
        self.assertNotIn('secrets.DEPLOY_', candidate)
        self.assertIn('build-artifact "$RUNNER_TEMP/android-release"', candidate)
        self.assertIn("metadata['gitCommitHash'] != os.environ['SOURCE_SHA']", candidate)
        self.assertIn('--json --non-interactive', RELEASE)

    def test_unchanged_only_skips_successful_available_artifacts(self):
        select = WORKFLOW.split('  select-source:')[1].split('  build-candidate:')[0]
        self.assertIn("status: 'success', head_sha: sha", select)
        self.assertIn('!a.expired', select)
        self.assertIn('a.name === `android-preview-${run.id}`', select)
        self.assertIn("context.eventName !== 'workflow_dispatch'", select)
        self.assertIn("cron: '30 10 * * 1-5'", WORKFLOW)

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
    unittest.main()
