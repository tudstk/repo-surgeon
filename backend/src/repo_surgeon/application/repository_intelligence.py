"""Deterministic, read-only repository metadata detection."""

from __future__ import annotations

import json
import re
import tomllib
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePath
from typing import Literal

from repo_surgeon.application.repository_files import (
    MAX_FILE_COUNT,
    ConfinedRepositoryFiles,
    FileEntry,
    RepositoryFileError,
)

LANGUAGE_CATALOG_VERSION = 1
TEST_COMMAND_CATALOG_VERSION = 1

LANGUAGE_EXTENSIONS: dict[str, frozenset[str]] = {
    "Python": frozenset({".py", ".pyi"}),
    "TypeScript / JavaScript": frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}),
    "C#": frozenset({".cs"}),
    "Go": frozenset({".go"}),
    "Rust": frozenset({".rs"}),
    "Java": frozenset({".java"}),
}
MANIFEST_LANGUAGE = {
    "pyproject.toml": "Python",
    "package.json": "TypeScript / JavaScript",
    "go.mod": "Go",
    "cargo.toml": "Rust",
    "pom.xml": "Java",
    "build.gradle": "Java",
    "build.gradle.kts": "Java",
}
IGNORED_DIRECTORIES = frozenset(
    {
        ".venv",
        "venv",
        "node_modules",
        "vendor",
        "dist",
        "build",
        "coverage",
        "generated",
        "target",
        "__pycache__",
    }
)


@dataclass(frozen=True, slots=True)
class RepositorySummary:
    language: str | None
    language_confidence: Literal["high", "medium", "low", "unknown"]
    file_count: int
    total_bytes: int
    approximate_lines: int | None
    test_framework: str | None
    test_command: str | None
    test_detection: Literal["detected", "ambiguous", "not_found", "unsupported"]
    detected_at: datetime
    truncated: bool


def detect_repository_summary(
    canonical_root: str | Path, *, detected_at: datetime | None = None
) -> RepositorySummary:
    """Inspect only bounded safe files and map evidence to fixed catalog entries."""
    files = ConfinedRepositoryFiles(str(canonical_root))
    listing = files.list_files(
        max_results=MAX_FILE_COUNT,
        ignored_directories=frozenset(directory.lower() for directory in IGNORED_DIRECTORIES),
    )
    entries = tuple(entry for entry in listing.entries if not _is_ignored(entry.path))
    language_scores: defaultdict[str, int] = defaultdict(int)
    text_by_path: dict[str, str] = {}
    approximate_lines = 0
    truncated = listing.truncated

    for entry in entries:
        try:
            read = files.read_file(entry.path)
        except RepositoryFileError as error:
            if error.code in {"binary_file", "file_too_large"}:
                truncated = True
            continue
        text_by_path[entry.path] = "\n".join(line.text for line in read.lines)
        approximate_lines += len(read.lines)
        truncated = truncated or read.truncated
        language = _language_for_file(entry)
        if language is not None:
            language_scores[language] += entry.size_bytes + 1_024

    readable_entries = tuple(entry for entry in entries if entry.path in text_by_path)
    names = {PurePath(entry.path).name.lower() for entry in readable_entries}
    for manifest, language in MANIFEST_LANGUAGE.items():
        if manifest in names:
            language_scores[language] += 4_096
    if any(name.endswith(".csproj") for name in names):
        language_scores["C#"] += 4_096

    language, confidence = _select_language(language_scores)
    framework, command, detection = _detect_tests(readable_entries, text_by_path)
    return RepositorySummary(
        language=language,
        language_confidence=confidence,
        file_count=len(entries),
        total_bytes=sum(entry.size_bytes for entry in entries),
        approximate_lines=approximate_lines,
        test_framework=framework,
        test_command=command,
        test_detection=detection,
        detected_at=detected_at or datetime.now(UTC),
        truncated=truncated,
    )


def _is_ignored(path: str) -> bool:
    return any(part.lower() in IGNORED_DIRECTORIES for part in PurePath(path).parts[:-1])


def _language_for_file(entry: FileEntry) -> str | None:
    suffix = PurePath(entry.path).suffix.lower()
    return next(
        (language for language, extensions in LANGUAGE_EXTENSIONS.items() if suffix in extensions),
        None,
    )


def _select_language(
    scores: dict[str, int],
) -> tuple[str | None, Literal["high", "medium", "low", "unknown"]]:
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    if not ranked:
        return None, "unknown"
    if len(ranked) == 1 or ranked[0][1] >= ranked[1][1] * 2:
        return ranked[0][0], "high"
    if ranked[0][1] * 4 >= ranked[1][1] * 5:
        return ranked[0][0], "medium"
    return None, "low"


def _detect_tests(
    entries: tuple[FileEntry, ...], text_by_path: dict[str, str]
) -> tuple[
    str | None,
    str | None,
    Literal["detected", "ambiguous", "not_found", "unsupported"],
]:
    paths = {entry.path.lower(): entry.path for entry in entries}
    detections: list[tuple[str, str]] = []
    unsupported = False

    pyproject = paths.get("pyproject.toml")
    if pyproject is not None:
        try:
            data = tomllib.loads(text_by_path.get(pyproject, ""))
        except tomllib.TOMLDecodeError:
            unsupported = True
        else:
            if _pyproject_declares_pytest(data):
                detections.append(("pytest", "uv run pytest"))

    package = paths.get("package.json")
    if package is not None:
        try:
            package_data = json.loads(text_by_path.get(package, ""))
        except json.JSONDecodeError:
            unsupported = True
        else:
            if not isinstance(package_data, dict):
                unsupported = True
            else:
                dependencies = {
                    **_string_dict(package_data.get("dependencies")),
                    **_string_dict(package_data.get("devDependencies")),
                }
                managers = [
                    manager
                    for lock, manager in (
                        ("pnpm-lock.yaml", "pnpm"),
                        ("yarn.lock", "yarn"),
                        ("package-lock.json", "npm"),
                    )
                    if lock in paths
                ]
                if len(managers) > 1:
                    unsupported = True
                elif "vitest" in dependencies:
                    manager = managers[0] if managers else "npm"
                    detections.append(("vitest", f"{manager} exec vitest run"))
                elif "jest" in dependencies:
                    manager = managers[0] if managers else "npm"
                    detections.append(("jest", f"{manager} exec jest"))
                elif (
                    isinstance(package_data.get("scripts"), dict)
                    and "test" in package_data["scripts"]
                ):
                    unsupported = True

    if "go.mod" in paths:
        detections.append(("go test", "go test ./..."))
    if "cargo.toml" in paths:
        detections.append(("cargo test", "cargo test"))
    if any(path.endswith(".csproj") for path in paths):
        detections.append(("dotnet test", "dotnet test"))

    unique = list(dict.fromkeys(detections))
    if len(unique) > 1:
        return None, None, "ambiguous"
    if unique:
        return unique[0][0], unique[0][1], "detected"
    if unsupported:
        return None, None, "unsupported"
    return None, None, "not_found"


def _string_dict(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)
    }


def _mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _pyproject_declares_pytest(data: dict[str, object]) -> bool:
    project = _mapping(data.get("project"))
    dependency_values: list[object] = [project.get("dependencies")]
    dependency_values.extend(_mapping(project.get("optional-dependencies")).values())
    dependency_values.extend(_mapping(data.get("dependency-groups")).values())
    return any(_dependency_list_contains(value, "pytest") for value in dependency_values)


def _dependency_list_contains(value: object, expected: str) -> bool:
    if not isinstance(value, list):
        return False
    for item in value:
        if not isinstance(item, str):
            continue
        match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", item)
        if match and match.group(1).lower().replace("_", "-").replace(".", "-") == expected:
            return True
    return False
