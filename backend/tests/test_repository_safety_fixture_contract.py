"""Executable shape checks for the Milestone 1 adversarial repository fixture.

These tests intentionally exercise no product API.
They pin the fixture contract that later repository and confined-file tests consume.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "repos" / "m1-repository-safety"
UNSAFE_REQUESTS = (
    "../outside.txt",
    "src/../../outside.txt",
    "/etc/passwd",
    ".git/HEAD",
    ".git/config",
    "link-outside",
)


def test_safe_fixture_files_have_expected_content_shape() -> None:
    """Keep normal and nested reads available to future confinement tests."""
    assert (FIXTURE_ROOT / "README.md").is_file()
    assert (FIXTURE_ROOT / "src" / "main.py").is_file()
    assert (
        (FIXTURE_ROOT / "src" / "deep" / "nested.txt")
        .read_text(encoding="utf-8")
        .startswith("This nested")
    )


def test_secret_like_fixture_names_are_inert_but_present() -> None:
    """Keep secret policy cases filename-based without storing real credentials."""
    assert (FIXTURE_ROOT / ".env").read_text(encoding="utf-8").endswith("not-a-real-token\n")
    assert "fixture-not-a-real-api-key" in (FIXTURE_ROOT / "config" / "credentials.json").read_text(
        encoding="utf-8"
    )
    assert "not-a-private-key" in (FIXTURE_ROOT / "id_rsa").read_text(encoding="utf-8")


def test_binary_and_oversized_files_preserve_their_adversarial_shape() -> None:
    """Pin binary detection and a 64 KiB boundary without a product dependency."""
    binary = (FIXTURE_ROOT / "binary.dat").read_bytes()
    oversized = FIXTURE_ROOT / "oversized.txt"

    assert len(binary) == 4096
    assert b"\x00" in binary
    assert oversized.stat().st_size == 132096
    assert oversized.stat().st_size > 64 * 1024
    assert oversized.read_text(encoding="utf-8").count("\n") == 1024


def test_unsafe_request_corpus_covers_confinement_boundaries() -> None:
    """Keep traversal, absolute, Git-internal, and escaping-symlink cases explicit."""
    assert "../outside.txt" in UNSAFE_REQUESTS
    assert "/etc/passwd" in UNSAFE_REQUESTS
    assert ".git/HEAD" in UNSAFE_REQUESTS
    assert "link-outside" in UNSAFE_REQUESTS


def test_symlink_cases_resolve_inside_and_outside_the_fixture_root() -> None:
    """Pin that an in-root regular target is permitted and an escape is denied."""
    outside = FIXTURE_ROOT / "link-outside"
    inside = FIXTURE_ROOT / "link-inside"

    assert outside.is_symlink()
    assert inside.is_symlink()
    assert not outside.resolve().is_relative_to(FIXTURE_ROOT.resolve())
    assert inside.resolve().is_relative_to(FIXTURE_ROOT.resolve())
    assert inside.resolve().is_file()
    assert inside.resolve() == (FIXTURE_ROOT / "src" / "main.py").resolve()


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="FIFOs are unavailable on this platform")
def test_special_file_fixture_can_be_created_without_committing_one(tmp_path: Path) -> None:
    """Document the portable non-regular-file case for the future resolver."""
    fifo = tmp_path / "named-pipe"
    os.mkfifo(fifo)

    assert stat.S_ISFIFO(fifo.stat().st_mode)
