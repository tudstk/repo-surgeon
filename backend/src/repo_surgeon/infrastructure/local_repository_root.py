"""Minimal, read-only validation of a selected local Git worktree."""

import os
import subprocess
from pathlib import Path

from repo_surgeon.application.repositories import (
    RepositoryRegistrationError,
    ResolvedLocalRepositoryRoot,
)


class GitLocalRepositoryRootResolver:
    """Resolve local paths through Git before granting a repository capability."""

    def resolve(self, candidate: str) -> ResolvedLocalRepositoryRoot:
        """Return Git's canonical worktree root for one absolute local path."""
        candidate_path = Path(candidate).expanduser()
        if not candidate_path.is_absolute():
            raise RepositoryRegistrationError(
                code="repository_path_invalid",
                detail="Repository path must be absolute.",
            )

        try:
            resolved_candidate = candidate_path.resolve(strict=True)
        except OSError, RuntimeError:
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
            canonical_root = Path(completed.stdout.strip()).resolve(strict=True)
            root_fd = os.open(canonical_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                root_stat = os.fstat(root_fd)
            finally:
                os.close(root_fd)
        except OSError, RuntimeError:
            raise RepositoryRegistrationError(
                code="repository_path_invalid",
                detail="Repository root cannot be resolved.",
            ) from None
        return ResolvedLocalRepositoryRoot(
            canonical_root=str(canonical_root),
            root_device=root_stat.st_dev,
            root_inode=root_stat.st_ino,
        )
