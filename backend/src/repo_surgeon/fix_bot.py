"""On-demand GitHub App publisher for tested and owner-approved review suggestions."""

import asyncio
import hashlib
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import httpx

from repo_surgeon.application.fix_suggestion import Fix, FixError, replace_suggestion, source_path
from repo_surgeon.infrastructure.fix_sandbox import test_fix
from repo_surgeon.infrastructure.github_app import (
    GITHUB_API_HEADERS,
    GitHubAppInstallation,
)
from repo_surgeon.infrastructure.github_import import (
    FULL_NAME_PATTERN,
    GitHubImporter,
    extract_snapshot,
)


class FixBot:
    def __init__(self, client: httpx.AsyncClient, app: GitHubAppInstallation) -> None:
        self.client = client
        self.app = app

    async def request(
        self, path: str, token: str, *, data: dict[str, Any] | None = None, missing_ok: bool = False
    ) -> dict[str, Any]:
        async with self.client.stream(
            "GET" if data is None else "POST",
            "https://api.github.com" + path,
            json=data,
            headers={**GITHUB_API_HEADERS, "Authorization": "Bearer " + token},
            follow_redirects=False,
        ) as response:
            if missing_ok and response.status_code == 404:
                return {}
            if response.status_code not in {200, 201}:
                raise FixError(f"GitHub rejected {path} (HTTP {response.status_code}).")
            payload = bytearray()
            async for chunk in response.aiter_bytes(65536):
                payload.extend(chunk)
                if len(payload) > 4 * 1024 * 1024:
                    raise FixError("GitHub response exceeds the 4 MiB limit.")
            value = json.loads(payload)
            if not isinstance(value, dict):
                raise FixError("Unexpected GitHub response.")
            return value

    async def target(self, pull: int, token: str) -> tuple[str, int, str]:
        repo = await self.request(f"/repositories/{self.app.repository_id}", token)
        name = repo["full_name"]
        if (
            repo["id"] != self.app.repository_id
            or repo["owner"]["type"] != "User"
            or not re.fullmatch(FULL_NAME_PATTERN, name)
        ):
            raise FixError("Only the configured, personally owned repository is supported.")
        pr = await self.request(f"/repos/{name}/pulls/{pull}", token)
        if (
            pr["state"] != "open"
            or pr["head"]["repo"]["id"] != repo["id"]
            or pr["base"]["repo"]["id"] != repo["id"]
        ):
            raise FixError(
                "Choose an open pull request with both branches in the installation repository."
            )
        base = pr["head"]["sha"]
        if not re.fullmatch(r"[0-9a-f]{40}", base):
            raise FixError("GitHub returned an invalid revision.")
        return name, int(repo["owner"]["id"]), base

    async def owner_commands(self, name: str, fix: Fix, ids: tuple[int, int], token: str) -> None:
        if not 0 < ids[0] < ids[1]:
            raise FixError("Approval and Apply require two separate comments, in that order.")
        nodes = []
        for number, command in zip(
            ids,
            (
                f"approve {fix.digest} {fix.suggestion}",
                f"apply {fix.digest} {fix.branch} {fix.suggestion} {ids[0]}",
            ),
            strict=True,
        ):
            comment = await self.request(f"/repos/{name}/issues/comments/{number}", token)
            if (
                comment["id"] != number
                or comment["issue_url"] != f"https://api.github.com/repos/{name}/issues/{fix.pull}"
                or comment["user"]["id"] != fix.owner
                or comment["user"]["type"] != "User"
                or comment["created_at"] != comment["updated_at"]
                or comment["body"].strip() != "/repo-surgeon " + command
            ):
                raise FixError(
                    "The owner must post both exact commands as new comments on this PR."
                )

            nodes.append(comment["node_id"])
        # REST timestamps have second precision. GraphQL also records edits within that second.
        history = await self.request(
            "/graphql",
            token,
            data={
                "query": "query($i:[ID!]!){nodes(ids:$i){... on IssueComment{id lastEditedAt}}}",
                "variables": {"i": nodes},
            },
        )
        if history.get("errors") or history.get("data", {}).get("nodes") != [
            {"id": node, "lastEditedAt": None} for node in nodes
        ]:
            raise FixError("Edited approval and Apply comments cannot authorize a commit.")

    async def _test_revision(
        self, pull: int, suggestion: int, image: str, test: str, ids: tuple[int, int] | None
    ) -> tuple[str, Fix, str, str]:
        if min(pull, suggestion) < 1:
            raise FixError("Use positive pull request and suggestion numbers.")
        pr_token = await self.app.access_token(self.client, permission="pull_requests")
        name, owner, base = await self.target(pull, pr_token)
        prefix = f"/repos/{name}"
        comment = await self.request(f"{prefix}/pulls/comments/{suggestion}", pr_token)
        if (
            comment["id"] != suggestion
            or comment["pull_request_url"] != f"https://api.github.com{prefix}/pulls/{pull}"
            or comment["commit_id"] != base
            or comment["side"] != "RIGHT"
            or not comment.get("line")
            or comment.get("start_side") not in {None, "RIGHT"}
            or comment.get("in_reply_to_id")
        ):
            raise FixError("Choose a current right-side suggestion on the selected PR revision.")
        path = source_path(comment["path"])
        read = await self.app.access_token(self.client)
        commit = await self.request(f"{prefix}/git/commits/{base}", read)
        tree_sha = commit["tree"]["sha"]
        tree = await self.request(f"{prefix}/git/trees/{tree_sha}?recursive=1", read)
        entry: dict[str, Any] = next((item for item in tree["tree"] if item["path"] == path), {})
        if (
            tree["truncated"]
            or entry.get("type") != "blob"
            or entry.get("mode") not in {"100644", "100755"}
        ):
            raise FixError("Cannot verify this regular file against the complete Git tree.")
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "source"
            root.mkdir()
            importer = GitHubImporter(root, client=self.client)
            extract_snapshot(await importer.download_archive(name, base, read), root)
            content = (root / path).read_bytes()
            if (
                hashlib.sha1(b"blob " + str(len(content)).encode() + b"\x00" + content).hexdigest()
                != entry["sha"]
            ):
                raise FixError("Archive contents differ from the pinned Git blob.")
            before, after = replace_suggestion(
                content,
                comment.get("start_line") or comment["line"],
                comment["line"],
                comment["body"],
            )
            fix = Fix(
                self.app.repository_id,
                owner,
                pull,
                suggestion,
                base,
                path,
                before,
                after,
                image,
                test,
            )
            if ids:
                await self.owner_commands(name, fix, ids, pr_token)
            (root / path).write_bytes(after.encode())
            await asyncio.to_thread(test_fix, root, image, test)
        if await self.target(pull, pr_token) != (name, owner, base):
            raise FixError("The PR changed during testing. Preview the new revision.")
        return name, fix, tree_sha, entry["mode"]

    async def preview(self, pull: int, suggestion: int, image: str, test: str) -> Fix:
        _, fix, _, _ = await self._test_revision(pull, suggestion, image, test, None)
        return fix

    async def apply(
        self, pull: int, suggestion: int, image: str, test: str, ids: tuple[int, int]
    ) -> str:
        name, fix, tree, mode = await self._test_revision(pull, suggestion, image, test, ids)
        pr_token = await self.app.access_token(self.client, permission="pull_requests")
        read = await self.app.access_token(self.client)
        return await self._publish_tested(name, fix, ids, pr_token, read, tree, mode)

    async def _publish_tested(
        self,
        name: str,
        fix: Fix,
        ids: tuple[int, int],
        pr_token: str,
        read: str,
        tree_sha: str,
        mode: str,
    ) -> str:
        prefix = f"/repos/{name}/git"
        message = f"fix: apply suggestion for PR #{fix.pull}\n\nRepo-Surgeon-Revision: {fix.digest}"
        await self.owner_commands(name, fix, ids, pr_token)
        write = await self.app.fix_publication_token(self.client)
        tree = await self.request(
            prefix + "/trees",
            write,
            data={
                "base_tree": tree_sha,
                "tree": [{"path": fix.path, "mode": mode, "type": "blob", "content": fix.after}],
            },
        )

        async def existing() -> str | None:
            ref = await self.request(f"{prefix}/ref/heads/{fix.branch}", read, missing_ok=True)
            if not ref:
                return None
            sha = ref["object"]["sha"]
            current = await self.request(f"{prefix}/commits/{sha}", read)
            if (
                current["message"] != message
                or current["tree"]["sha"] != tree["sha"]
                or [p["sha"] for p in current["parents"]] != [fix.base]
            ):
                raise FixError("The fix branch already exists with different contents.")
            return f"https://github.com/{name}/commit/{sha}"

        if previous := await existing():
            return previous
        result = await self.request(
            prefix + "/commits",
            write,
            data={"tree": tree["sha"], "parents": [fix.base], "message": message},
        )
        await self.owner_commands(name, fix, ids, pr_token)
        if await self.target(fix.pull, pr_token) != (name, fix.owner, fix.base):
            raise FixError("The PR changed before publication. Preview the new revision.")
        try:
            await self.request(
                prefix + "/refs",
                write,
                data={"ref": "refs/heads/" + fix.branch, "sha": result["sha"]},
            )
        except FixError, httpx.TransportError:
            if previous := await existing():
                return previous
            raise
        return f"https://github.com/{name}/commit/{result['sha']}"
