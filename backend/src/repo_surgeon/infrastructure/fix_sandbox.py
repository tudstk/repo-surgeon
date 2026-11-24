"""Run one selected test file in an operator-provided dependency image."""

import json
import re
import subprocess
from pathlib import Path
from uuid import uuid4

from repo_surgeon.application.fix_suggestion import FixError, source_path


def test_fix(root: Path, image: str, test: str) -> None:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
        raise FixError("Select a locally installed test image by immutable sha256 image ID.")
    path = root / source_path(test)
    if not path.is_file():
        raise FixError("The selected test file is missing from the revision.")
    if re.fullmatch(r"(test_.+|.+_test)\.py", path.name):
        command = ["python", "-m", "pytest", "-p", "no:cacheprovider", "-q", "./" + test]
    elif re.search(r"\.test\.(mjs|cjs|js|ts|tsx|jsx)$", path.name):
        manifest = next(
            (
                parent / "package.json"
                for parent in path.parents
                if parent.is_relative_to(root) and (parent / "package.json").is_file()
            ),
            None,
        )
        dependencies: dict[str, object] = {}
        if manifest:
            if manifest.stat().st_size > 65536:
                raise FixError("The test package manifest exceeds 64 KiB.")
            package = json.loads(manifest.read_bytes())
            dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
        if "vitest" in dependencies:
            command = ["/node_modules/.bin/vitest", "run", "--maxWorkers=1", "./" + test]
        else:
            command = ["node", "--test", "./" + test]
    else:
        raise FixError("Select a pytest, Vitest, or Node built-in test file.")
    name = "repo-surgeon-test-" + uuid4().hex
    try:
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--pull=never",
                "--name",
                name,
                "--network=none",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--user=65534:65534",
                "--cpus=1",
                "--memory=512m",
                "--memory-swap=512m",
                "--pids-limit=64",
                "--read-only",
                "--tmpfs=/tmp:rw,nosuid,nodev,size=64m",
                "--log-driver=none",
                "--env=HOME=/tmp",
                "--volume",
                f"{root}:/src:ro",
                "--workdir=/src",
                "--entrypoint",
                command[0],
                image,
                *command[1:],
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=90,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise FixError("The isolated test exceeded 90 seconds.") from None
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=15, check=False)
    if result.returncode:
        raise FixError(f"The isolated test or container startup failed (exit {result.returncode}).")
