"""No inference calls: confined context retrieval and provider protocol contracts."""

import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from repo_surgeon.api.pull_request_reviews import _VisibleAnswer
from repo_surgeon.application.redaction import redact_text
from repo_surgeon.application.repositories import ResolvedLocalRepositoryRoot
from repo_surgeon.application.review_context import (
    MAX_CONTEXT_CHARS,
    ReviewContext,
    build_review_context,
)
from repo_surgeon.application.review_models import PullReviewSource
from repo_surgeon.infrastructure.github_pull_requests import GitHubPullRequestFile
from repo_surgeon.infrastructure.openrouter_review import OpenRouterReview, ReviewProviderError
from repo_surgeon.settings import Settings


def source(root: Path) -> PullReviewSource:
    identity = root.stat()
    return PullReviewSource(
        24,
        "Validate prices",
        "Reject invalid values",
        "a" * 40,
        "b" * 40,
        (
            GitHubPullRequestFile(
                "src/price.ts",
                None,
                "modified",
                1,
                1,
                "@@ -1 +1 @@\n-export function price() {}\n+export function price() { return 1; }",
                "available",
            ),
        ),
        0,
        ResolvedLocalRepositoryRoot(str(root), identity.st_dev, identity.st_ino),
    )


def test_graph_retrieves_callers_dependencies_and_tests_without_reading_secrets(
    tmp_path: Path,
) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src/price.ts").write_text(
        'import { valid } from "./valid";\nexport function price() { return valid(1); }'
    )
    (tmp_path / "src/valid.ts").write_text(
        "export function valid(n: number) { return Number.isFinite(n); }"
    )
    (tmp_path / "src/catalog.ts").write_text(
        'import { price } from "./price";\nexport function catalog() { return price(); }'
    )
    (tmp_path / "src/price.test.ts").write_text(
        'import { price } from "./price";\nexpect(price()).toBe(1);'
    )
    (tmp_path / ".env").write_text("NEVER_READ_THIS")
    (tmp_path / "outside-link.ts").symlink_to(tmp_path / ".env")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules/ignored.ts").write_text("NEVER_MAP_THIS")
    context = build_review_context(source(tmp_path))
    packet = json.loads(context.text)
    assert packet["pull_request"]["head_sha"] == "b" * 40
    assert packet["pull_request"]["description"] == "Reject invalid values"
    assert packet["changed_files"][0]["patch"].startswith("@@")
    assert {item["path"] for item in packet["excerpts"]} == {
        "src/price.ts",
        "src/valid.ts",
        "src/catalog.ts",
        "src/price.test.ts",
    }
    node = next(item for item in packet["repository_map"] if item["file"] == "src/price.ts")
    assert node["imports"] == ["src/valid.ts"]
    assert node["symbols"] == ["price"]
    assert "NEVER" not in context.text
    assert "outside-link" not in context.text
    assert len(context.text) <= MAX_CONTEXT_CHARS


def test_missing_patches_are_reported_as_limited_context(tmp_path: Path) -> None:
    original = source(tmp_path)
    unavailable = replace(original.files[0], patch=None, patch_status="unavailable")
    context = build_review_context(replace(original, files=(unavailable,)))
    assert context.limited
    assert json.loads(context.text)["coverage"]["missing_patches"] == 1
    assert json.loads(context.text)["coverage"]["excerpts_are_selected"] is True


def test_stream_redaction_buffers_split_credentials_and_pem() -> None:
    visible = _VisibleAnswer()
    assert visible.accept("password=hunt") == ""
    assert visible.accept("er2\n") == "password=[REDACTED]\n"
    assert visible.accept("-----BEGIN PRIVATE KEY-----\nsecret\n") == ""
    assert visible.accept("-----END PRIVATE KEY-----\n") == "[REDACTED PEM]\n"
    assert "sk-or-v1-abc" not in redact_text("api key sk-or-v1-abc")
    assert "hunter2" not in redact_text('"password": "hunter2"')


def sse(payload: object) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "model,prompt_cap,completion_cap",
    [
        ("deepseek/deepseek-v3.2", 0.30, 0.50),
        ("deepseek/deepseek-v4-flash", 0.12, 0.25),
    ],
)
async def test_provider_sends_one_bounded_request_and_ignores_reasoning(
    model: str,
    prompt_cap: float,
    completion_cap: float,
) -> None:
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        packet = json.loads(request.content)
        assert packet["model"] == model
        assert packet["max_tokens"] == 4000
        assert packet["provider"] == {
            "data_collection": "deny",
            "zdr": True,
            "require_parameters": True,
            "max_price": {"prompt": prompt_cap, "completion": completion_cap},
        }
        assert packet["messages"][1]["content"] == "context data"
        return httpx.Response(
            200,
            text=(
                sse(
                    {"choices": [{"delta": {"reasoning": "not public", "content": "## Verdict\n"}}]}
                )
                + sse(
                    {
                        "choices": [
                            {"delta": {"content": "Looks good."}, "finish_reason": "length"}
                        ],
                        "usage": {"prompt_tokens": 100, "completion_tokens": 20, "cost": 0.001},
                    }
                )
                + "data: [DONE]\n\n"
            ),
        )

    settings = Settings(
        environment="test", openrouter_model=model, openrouter_api_key=SecretStr("test-placeholder")
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        provider = OpenRouterReview(settings, client)
        result = "".join(
            [part async for part in provider.stream(ReviewContext("context data", 1, 1, 1, False))]
        )
    assert result == "## Verdict\nLooks good."
    assert provider.limited
    assert provider.usage["cost"] == 0.001
    assert len(calls) == 1
    assert calls[0].url == "https://openrouter.ai/api/v1/chat/completions"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status,body,message",
    [
        (402, "", "insufficient credits"),
        (429, "", "rate limited"),
        (200, sse({"choices": [{"delta": {"content": "partial"}}]}), "disconnected"),
        (200, sse({"error": {"message": "PRIVATE upstream details"}}), "stopped"),
        (200, "data: invalid JSON\n\n", "invalid streaming"),
    ],
)
async def test_provider_failure_is_specific_without_exposing_upstream_body(
    status: int, body: str, message: str
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, text=body))
    ) as client:
        provider = OpenRouterReview(
            Settings(environment="test", openrouter_api_key=SecretStr("placeholder")), client
        )
        with pytest.raises(ReviewProviderError, match=message) as error:
            _ = [part async for part in provider.stream(ReviewContext("data", 1, 1, 1, False))]
        assert "PRIVATE" not in str(error.value)
