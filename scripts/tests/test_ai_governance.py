"""Mutation fixtures prove governance detects regressions, not just a green repo."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('governance', Path(__file__).parents[1] / 'check_ai_governance.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GovernanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in MODULE.SOURCE_ROOTS:
            (self.root / directory).mkdir(parents=True)
        for directory in ('', 'backend', 'frontend', 'apps/mobile-workbench'):
            self.write(f'{directory}/package.json'.lstrip('/'), '{"scripts": {}}')
        self.write('.github/workflows/guard.yml', 'jobs: {}\n')

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def test_clean_fixture(self):
        self.assertEqual(MODULE.check(self.root), [])

    def test_retired_imports(self):
        for source in ["import x from './compat/old'", "const x = require('../deprecated/x')", "import('agora-rtc-sdk-ng')"]:
            with self.subTest(source=source):
                self.write('frontend/src/example.ts', source)
                self.assertTrue(MODULE.check(self.root))

    def test_retired_http_and_navigation(self):
        for source in ["fetch('/api/rtc/session/ping')", "fetch(`${base}/rtc/session/stop`)", 'const x = <a href="/ranyan" />']:
            with self.subTest(source=source):
                self.write('frontend/src/example.tsx', source)
                self.assertTrue(MODULE.check(self.root))

    def test_test_fixture_is_not_runtime(self):
        self.write('frontend/src/example.test.ts', "fetch('/api/rtc/session/ping')")
        self.assertEqual(MODULE.check(self.root), [])

    def test_missing_npm_cli_target(self):
        self.write('frontend/package.json', json.dumps({'scripts': {'check': 'node scripts/missing.mjs'}}))
        self.assertIn('missing CLI entry', '\n'.join(MODULE.check(self.root)))
        self.write('frontend/scripts/missing.mjs', '')
        self.assertEqual(MODULE.check(self.root), [])

    def test_workflow_cwd_and_missing_script(self):
        self.write('.github/workflows/guard.yml', '''jobs:
  guard:
    steps:
      - working-directory: frontend
        run: node scripts/guard.mjs
''')
        self.assertTrue(MODULE.check(self.root))
        self.write('frontend/scripts/guard.mjs', '')
        self.assertEqual(MODULE.check(self.root), [])

    def test_parent_relative_npm_script(self):
        self.write('frontend/package.json', json.dumps({'scripts': {'check': 'bash ../scripts/missing.sh'}}))
        self.assertTrue(MODULE.check(self.root))
        self.write('scripts/missing.sh', '')
        self.assertEqual(MODULE.check(self.root), [])

    def test_missing_repository_fails_closed(self):
        self.assertTrue(MODULE.check(self.root / 'absent'))

    def test_original_missing_governance_entry_is_detected(self):
        self.write('.github/workflows/guard.yml', '''jobs:
  guard:
    steps:
      - run: bash scripts/check_ai_governance.sh
''')
        self.assertIn('missing CLI entry scripts/check_ai_governance.sh', '\n'.join(MODULE.check(self.root)))


if __name__ == '__main__':
    unittest.main()
