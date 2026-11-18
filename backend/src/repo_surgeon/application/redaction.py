"""Redact credential-like content before persistence and provider transmission."""

import re

SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|authorization|credential|password|passwd|secret|token)", re.I
)
_SENSITIVE_VALUE = re.compile(
    r"(?i)(\b(?:api[_-]?key|authorization|credential|password|passwd|secret|token)"
    r"\b[\"']?\s*[:=]\s*[\"']?)([^\s,;}\"']+)"
)
_BEARER_VALUE = re.compile(r"(?i)(\bbearer\s+)([^\s,;}'\"]+)")
_PEM_VALUE = re.compile(r"-----BEGIN ([^-]+)-----.+?-----END \1-----", re.DOTALL)


def redact_text(value: str) -> str:
    value = _PEM_VALUE.sub("[REDACTED PEM]", value)
    value = _SENSITIVE_VALUE.sub(r"\1[REDACTED]", value)
    value = _BEARER_VALUE.sub(r"\1[REDACTED]", value)
    return re.sub(
        r"\b(?:sk-or-v1-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})",
        "[REDACTED]",
        value,
    )
