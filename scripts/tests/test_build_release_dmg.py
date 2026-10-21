import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class BuildReleaseDmgTest(unittest.TestCase):
    def test_packaging_from_another_directory(self):
        with tempfile.TemporaryDirectory(prefix="courrier dmg ") as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            script = root / "scripts/build_release_dmg.sh"
            shutil.copy2(Path(__file__).resolve().parents[1] / script.name, script)
            (root / "frontend/node_modules").mkdir(parents=True)
            (root / "desktop-native").mkdir()
            (root / "desktop-native/tauri.conf.json").write_text('{"productName":"Courrier"}')
            target = root / "custom target"
            (target / "release/bundle/macos/Courrier.app").mkdir(parents=True)
            commands = root / "bin"
            commands.mkdir()
            mocks = {
                "uname": "echo Darwin",
                "npm": '[ "$PWD" = "$TEST_ROOT/frontend" ] && [ "$*" = "run desktop:build -- --bundles app --verbose" ]',
                "cargo": "printf '%s\\n' \"$TEST_METADATA\"",
                "hdiutil": '''while [ "$1" != -srcfolder ]; do shift; done
stage=$2
[ -d "$stage/Courrier.app" ] && [ -L "$stage/Applications" ] || exit 1
printf '%s' "$stage" > "$TEST_ROOT/staging-path"
for output do :; done
touch "$output"''',
            }
            for name, body in mocks.items():
                command = commands / name
                command.write_text("#!/bin/sh\nset -eu\n" + body + "\n")
                command.chmod(0o755)
            env = dict(os.environ, PATH=f"{commands}:{os.environ['PATH']}",
                       TEST_ROOT=str(root), TEST_METADATA=json.dumps({"target_directory": str(target)}))
            result = subprocess.run([str(script), "--output", "output dir/release.dmg", "--dmg-name", "Test"],
                                    cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / "output dir/release.dmg").is_file())
            self.assertFalse(Path((root / "staging-path").read_text()).exists())
            for option in ("--output", "--dmg-name"):
                result = subprocess.run([str(script), option], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn("Missing value", result.stderr)


if __name__ == "__main__":
    unittest.main()
