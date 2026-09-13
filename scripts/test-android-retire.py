#!/usr/bin/env python3
"""Run the real retirement logic with isolated paths and a stateful systemctl fake."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class Retirement(unittest.TestCase):
    def test_stop_mask_and_idempotent_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ('var/backups', 'etc/systemd/system', 'usr/local/libexec', 'bin'):
                (root / name).mkdir(parents=True)
            for unit in ('service', 'timer'):
                (root / f'etc/systemd/system/voxflame-android-main-sync.{unit}').write_text('legacy unit')
            installed = root / 'usr/local/libexec/voxflame-android-main-sync'
            installed.write_text('legacy executable')
            control = root / 'bin/systemctl'
            control.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['TEST_ROOT'])
statefile = root / 'state.json'
state = json.loads(statefile.read_text()) if statefile.exists() else {'active': True}
args = sys.argv[1:]
with (root / 'calls').open('a') as log: log.write(' '.join(args) + '\\n')
if args[0] == 'show':
    path = root / 'etc/systemd/system' / args[1]
    print('masked' if path.is_symlink() else 'loaded')
elif args[0] == 'disable':
    state['active'] = False
    statefile.write_text(json.dumps(state))
elif args[0] == 'is-active': sys.exit(0 if state['active'] else 3)
elif args[0] == 'mask':
    assert not state['active']
    (root / 'etc/systemd/system' / args[1]).symlink_to('/dev/null')
elif args[0] == 'is-enabled':
    assert (root / 'etc/systemd/system' / args[1]).is_symlink()
    print('masked')
    sys.exit(1)
elif args[0] != 'daemon-reload': raise RuntimeError(args)
''')
            control.chmod(0o755)
            text = (ROOT / 'scripts/ops/retire-android-main-sync.sh').read_text()
            text = text.replace('if [[ "$EUID" != 0 ]]', 'if false')
            text = text.replace('ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"', f'ROOT_DIR="{ROOT}"')
            for path in ('/var/backups/', '/etc/systemd/system/', '/usr/local/libexec/'):
                text = text.replace(path, str(root) + path)
            script = root / 'retire.sh'
            script.write_text(text)
            env = {**os.environ, 'TEST_ROOT': str(root), 'PATH': str(root / 'bin') + ':' + os.environ['PATH']}
            for attempt in range(2):
                result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('retired', installed.read_text().lower())
            saved = list((root / 'var/backups').glob('*/voxflame-android-main-sync'))
            self.assertEqual(len(saved), 2)
            self.assertTrue(any(p.read_text() == 'legacy executable' for p in saved))
            for unit in ('timer', 'service'):
                self.assertEqual(os.readlink(root / f'etc/systemd/system/voxflame-android-main-sync.{unit}'), '/dev/null')
                self.assertTrue(any(p.read_text() == 'legacy unit' for p in (root / 'var/backups').glob(f'*/voxflame-android-main-sync.{unit}')))

if __name__ == '__main__': unittest.main()
