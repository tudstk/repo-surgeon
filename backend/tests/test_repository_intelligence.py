"""Behavior contracts for bounded repository intelligence."""

from datetime import UTC, datetime
from pathlib import Path

from repo_surgeon.application.repository_intelligence import detect_repository_summary

DETECTED_AT = datetime(2026, 9, 15, tzinfo=UTC)


def test_detects_dominant_language_size_lines_and_pytest_without_execution(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "sample"\ndependencies = []\n'
        '[dependency-groups]\ndev = ["pytest==9.1.1"]\n'
    )
    (tmp_path / "app.py").write_text("def main():\n    return 1\n")
    (tmp_path / "notes.txt").write_text("one\ntwo\n")

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.language == "Python"
    assert result.language_confidence == "high"
    assert result.file_count == 3
    assert result.total_bytes == sum(path.stat().st_size for path in tmp_path.iterdir())
    assert result.approximate_lines == 9
    assert result.test_framework == "pytest"
    assert result.test_command == "uv run pytest"
    assert result.test_detection == "detected"
    assert result.detected_at == DETECTED_AT
    assert not result.truncated


def test_generated_binary_and_secret_content_cannot_bias_summary(tmp_path: Path) -> None:
    (tmp_path / "main.go").write_text("package main\n")
    (tmp_path / "go.mod").write_text("module example.test/demo\n")
    (tmp_path / "credentials.py").write_text("# blocked\n" * 500)
    (tmp_path / "binary.py").write_bytes(b"\x00" * 2_000)
    generated = tmp_path / "generated"
    generated.mkdir()
    (generated / "bundle.ts").write_text("export {};\n" * 500)

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.language == "Go"
    assert result.file_count == 3
    assert result.test_framework == "go test"
    assert result.test_command == "go test ./..."
    assert result.truncated


def test_ambiguous_languages_and_test_frameworks_are_reported_not_guessed(tmp_path: Path) -> None:
    (tmp_path / "main.py").write_text("x = 1\n")
    (tmp_path / "main.ts").write_text("const x = 1;\n")
    (tmp_path / "pyproject.toml").write_text('[dependency-groups]\ndev = ["pytest"]\n')
    (tmp_path / "package.json").write_text(
        '{"devDependencies":{"vitest":"1.0.0"},"scripts":{"test":"do anything"}}'
    )
    (tmp_path / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.language is None
    assert result.language_confidence == "low"
    assert result.test_framework is None
    assert result.test_command is None
    assert result.test_detection == "ambiguous"


def test_unrecognized_custom_test_script_is_never_promoted_to_a_command(tmp_path: Path) -> None:
    marker = tmp_path / "should-not-exist"
    (tmp_path / "package.json").write_text(
        '{"scripts":{"test":"touch ' + str(marker) + '"},"devDependencies":{}}'
    )

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.test_detection == "unsupported"
    assert result.test_command is None
    assert not marker.exists()


def test_pytest_words_outside_recognized_dependency_and_config_keys_are_ignored(
    tmp_path: Path,
) -> None:
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "sample"\ndescription = "pytest appears in prose"\n'
        "# pytest in a comment is not evidence\n"
        '[tool.custom]\nscript = "pytest --unsafe-custom-option"\n'
    )

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.test_framework is None
    assert result.test_command is None
    assert result.test_detection == "not_found"


def test_pytest_config_without_supported_dependency_is_not_detected(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        '[tool.pytest.ini_options]\naddopts = "-q"\npython_files = ["test_*.py"]\n'
    )

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.test_framework is None
    assert result.test_command is None
    assert result.test_detection == "not_found"


def test_javascript_framework_words_in_description_and_scripts_are_not_dependencies(
    tmp_path: Path,
) -> None:
    (tmp_path / "package.json").write_text(
        '{"description":"vitest and jest",'
        '"scripts":{"test":"echo vitest jest"},"devDependencies":{}}'
    )

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.test_framework is None
    assert result.test_command is None
    assert result.test_detection == "unsupported"


def test_scan_marks_partial_when_file_or_line_caps_are_reached(tmp_path: Path) -> None:
    for index in range(205):
        (tmp_path / f"module_{index:03}.py").write_text("line\n")

    result = detect_repository_summary(tmp_path, detected_at=DETECTED_AT)

    assert result.file_count == 200
    assert result.approximate_lines == 200
    assert result.truncated
