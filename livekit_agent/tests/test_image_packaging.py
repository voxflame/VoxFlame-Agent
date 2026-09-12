"""Keep both dependency-build paths on the same complete application payload."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import unittest


class ImagePackagingTests(unittest.TestCase):
    def test_compose_uses_shared_provider_key_and_endpoints(self) -> None:
        root = Path(__file__).resolve().parents[2]
        compose = (root / "docker-compose.yml").read_text()
        backend = compose.split("\n  backend:\n", 1)[1].split("\n  livekit-agent:\n", 1)[0]
        agent = compose.split("\n  livekit-agent:\n", 1)[1].split("\n  redis:\n", 1)[0]
        for service in (backend, agent):
            self.assertIn("DASHSCOPE_API_KEY=${DASHSCOPE_API_KEY:-}", service)
            self.assertIn("DASHSCOPE_BASE_URL=${DASHSCOPE_BASE_URL:-", service)
        for key in ("QWEN_ASR_REALTIME_URL", "QWEN_TTS_REALTIME_URL"):
            self.assertIn(f"{key}=${{{key}:-", agent)

    def test_every_image_copies_all_runtime_modules_and_imports_app(self) -> None:
        root = Path(__file__).resolve().parents[1]
        for name in ("Dockerfile", "Dockerfile.localvenv"):
            with self.subTest(dockerfile=name):
                source = (root / name).read_text()
                self.assertIn("COPY *.py /app/", source)
                self.assertIn('python -c "import app"', source)
                self.assertIn("PYTHON_DOTENV_DISABLED=1", source)
                self.assertNotIn("COPY . /app", source)

    def test_deploy_blocks_before_replacement_when_database_is_old(self) -> None:
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            mock = Path(directory) / "docker-prefix"
            log = Path(directory) / "commands.jsonl"
            mock.write_text(
                f"#!{sys.executable}\n"
                "import json, os, sys\n"
                "with open(os.environ['COMMAND_LOG'], 'a') as f:\n"
                "    f.write(json.dumps(sys.argv[1:])+'\\n')\n"
                "sys.exit(17)\n"
            )
            mock.chmod(0o700)
            for mode in ("backend", "frontend", "env-backend", "collection", "core", "check"):
                with self.subTest(mode=mode):
                    log.write_text("")
                    result = subprocess.run(
                        ["bash", str(root / "scripts/docker-rebuild-core-fast.sh"), mode],
                        env={**os.environ, "VOXFLAME_DOCKER_PREFIX": str(mock), "COMMAND_LOG": str(log)},
                        capture_output=True, text=True, timeout=10,
                    )
                    self.assertEqual(result.returncode, 17)
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertEqual(len(calls), 1)
                    self.assertIn("run", calls[0])
                    self.assertIn("--no-deps", calls[0])
                    self.assertNotIn("up", calls[0])

    def test_database_preflight_rejects_missing_and_legacy_contracts(self) -> None:
        root = Path(__file__).resolve().parents[2]
        source = (root / "scripts/docker-rebuild-core-fast.sh").read_text()
        script = source.split("<<'NODE'\n", 1)[1].split("\nNODE", 1)[0]
        for scenario, expected in (("current", 0), ("missing", 1), ("legacy", 1), ("invalid", 1)):
            with self.subTest(scenario=scenario):
                fixture = """
process.env.SUPABASE_URL = 'http://fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key-not-a-credential';
global.fetch = async (url, options) => {
  if (options.method && options.method !== 'GET') throw new Error('unexpected_write');
  const scenario = process.env.PREFLIGHT_SCENARIO;
  return { ok: scenario !== 'missing', json: async () => url.pathname.includes('/rpc/')
    ? { durationAccounting: scenario === 'legacy' ? undefined : 'durable_v1',
        totalDurationSeconds: scenario === 'invalid' ? -1 : 0, todayDurationSeconds: 0 }
    : [] };
};
"""
                result = subprocess.run(
                    ["node", "-"], input=fixture + script, capture_output=True, text=True,
                    env={**os.environ, "PREFLIGHT_SCENARIO": scenario}, timeout=10,
                )
                self.assertEqual(result.returncode, expected, result.stderr)


if __name__ == "__main__":
    unittest.main()
