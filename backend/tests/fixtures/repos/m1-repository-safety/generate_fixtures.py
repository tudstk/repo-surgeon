"""Regenerate deterministic adversarial fixture payloads without network access."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).parent
BINARY_BYTES = bytes(range(256)) * 16
OVERSIZED_BYTES = (b"0123456789abcdef" * 8 + b"\n") * 1024


def main() -> None:
    (ROOT / "binary.dat").write_bytes(BINARY_BYTES)
    (ROOT / "oversized.txt").write_bytes(OVERSIZED_BYTES)


if __name__ == "__main__":
    main()
