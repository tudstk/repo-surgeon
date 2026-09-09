"""A deliberately small, safe-to-read fixture module."""


def greeting(name: str) -> str:
    """Return predictable text for bounded-read assertions."""
    return f"Hello, {name}!"
