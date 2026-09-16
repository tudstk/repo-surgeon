"""Launch a fixed command from a verified directory descriptor."""

from __future__ import annotations

import os
import stat
import sys


def main() -> int:
    if len(sys.argv) < 5:
        return 2
    root = sys.argv[1]
    expected_identity = (int(sys.argv[2]), int(sys.argv[3]))
    argv = tuple(sys.argv[4:])
    try:
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            root_stat = os.fstat(root_fd)
            if (
                not stat.S_ISDIR(root_stat.st_mode)
                or (
                    root_stat.st_dev,
                    root_stat.st_ino,
                )
                != expected_identity
            ):
                return 126
            os.fchdir(root_fd)
        finally:
            os.close(root_fd)
        # Fixed argv is intentionally executed without a shell.
        os.execvp(argv[0], argv)  # skipcq
    except OSError, ValueError:
        return 126


if __name__ == "__main__":
    raise SystemExit(main())
