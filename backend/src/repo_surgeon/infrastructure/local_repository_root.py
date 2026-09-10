"""Minimal, read-only validation of a selected local Git worktree."""

import subprocess
from pathlib import Path

from repo_surgeon.application.repositories import RepositoryRegistrationError


class GitLocalRepositoryRootResolver:
    """Resolve local paths through Git before granting a repository capability."""

    def resolve(self, candidate: str) -> str:
        """Return Git's canonical worktree root for one absolute local path."""
        candidate_path = Path(candidate).expanduser()
        if not candidate_path.is_absolute():
            raise RepositoryRegistrationError(
                code="repository_path_invalid",
                detail="Repository path must be absolute.",
            )

        try:
            resolved_candidate = candidate_path.resolve(strict=True)
        except (OSError, RuntimeError):
            raise RepositoryRegistrationError(
                code="repository_path_invalid",
                detail="Repository path does not exist or cannot be resolved.",
            ) from None

        if not resolved_candidate.is_dir():
            raise RepositoryRegistrationError(
                code="repository_path_invalid",
                detail="Repository path must identify a directory.",
            )

        try:
            completed = subprocess.run(
                ["git", "-C", str(resolved_candidate), "rev-parse", "--show-toplevel"],
                check=False,
                capture_output=True,
                text=True,
                timeout=3,
            )
        except FileNotFoundError:
            raise RepositoryRegistrationError(
                code="repository_validation_unavailable",
                detail="Git is required to validate a local repository.",
            ) from None
        except subprocess.TimeoutExpired:
            raise RepositoryRegistrationError(
                code="repository_validation_unavailable",
                detail="Repository validation timed out.",
            ) from None

        if completed.returncode != 0:
            raise RepositoryRegistrationError(
                code="repository_not_git",
                detail="Repository path must be inside a Git working tree.",
            )

        try:
            return str(Path(completed.stdout.strip()).resolve(strict=True))
        except (OSError, RuntimeError):
            raise RepositoryRegistrationError(
                code="repository_path_invalid",
                detail="Repository root cannot be resolved.",
            ) from None
