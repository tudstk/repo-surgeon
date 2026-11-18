"""Local dependency mapping and bounded source selection for one pinned PR head."""

import ast
import json
import posixpath
import re
from dataclasses import dataclass
from pathlib import PurePosixPath

from repo_surgeon.application.redaction import redact_text
from repo_surgeon.application.repository_files import ConfinedRepositoryFiles, RepositoryFileError
from repo_surgeon.application.review_models import PullReviewSource

MAX_CONTEXT_CHARS = 140_000
_MAX_SCAN_BYTES = 4 * 1024 * 1024
_IGNORED = frozenset(
    {
        "node_modules",
        "vendor",
        "dist",
        "build",
        ".next",
        ".venv",
        "venv",
        "__pycache__",
        ".cache",
        "coverage",
        ".git",
        "target",
    }
)
_SOURCE = frozenset(
    {
        ".py",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs",
        ".java",
        ".go",
        ".rs",
        ".rb",
        ".php",
        ".cs",
        ".c",
        ".h",
        ".cpp",
        ".sql",
        ".vue",
        ".svelte",
    }
)
_IMPORT = re.compile(
    r"(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['\"]([^'\"\n]{1,180})['\"]"
)
_DECLARATION = re.compile(
    r"^\s*(?:export\s+(?:default\s+)?)?(?:(?:async|public|private|static)\s+)*"
    r"(?:function|class|interface|type|def|fn|func)\s+([A-Za-z_$][\w$]*)",
    re.M,
)


@dataclass(frozen=True, slots=True)
class ReviewContext:
    text: str
    file_count: int
    source_count: int
    excerpt_count: int
    limited: bool


def _symbols_and_imports(path: str, text: str) -> tuple[list[str], list[str]]:
    if path.endswith(".py"):
        try:
            tree = ast.parse(text)
            symbols = [
                node.name
                for node in tree.body
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            ][:10]
            imports: list[str] = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.extend(name.name for name in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.append("." * node.level + node.module)
            return symbols, imports[:16]
        except SyntaxError, RecursionError:
            pass
    return _DECLARATION.findall(text)[:10], _IMPORT.findall(text)[:16]


def _resolve_import(path: str, name: str, available: set[str]) -> str | None:
    candidates = []
    if name.startswith(".") and not path.endswith(".py"):
        base = posixpath.normpath(posixpath.join(posixpath.dirname(path), name))
        candidates = [
            base,
            *(base + ext for ext in (".ts", ".tsx", ".js", ".jsx", ".mjs")),
            *(base + "/index" + ext for ext in (".ts", ".tsx", ".js", ".jsx")),
        ]
    elif path.endswith(".py"):
        module = name.lstrip(".").replace(".", "/")
        base = module
        if name.startswith("."):
            parent = posixpath.dirname(path)
            for _ in range(len(name) - len(name.lstrip(".")) - 1):
                parent = posixpath.dirname(parent)
            base = posixpath.join(parent, module)
        candidates = [base + ".py", base + "/__init__.py"]
    return next((candidate for candidate in candidates if candidate in available), None)


def build_review_context(source: PullReviewSource) -> ReviewContext:
    """Read source as data through the same confinement policy used by the MCP tools."""
    files = ConfinedRepositoryFiles(
        source.root.canonical_root, (source.root.root_device, source.root.root_inode)
    )
    queue = ["."]
    paths: list[str] = []
    scanned_directories = 0
    missing_patches = sum(file.patch_status != "available" for file in source.files)
    limited = bool(source.omitted_files or missing_patches)
    while queue and len(paths) < 1_000 and scanned_directories < 300:
        directory = queue.pop(0)
        scanned_directories += 1
        page = files.browse_directory(directory, 0)
        while True:
            limited |= page.scan_limit_reached
            for entry in page.entries:
                if entry.kind == "directory" and entry.name.lower() not in _IGNORED:
                    queue.append(entry.path)
                elif entry.kind == "file":
                    paths.append(entry.path)
            if page.next_offset is None or len(paths) >= 1_000:
                limited |= page.next_offset is not None
                break
            page = files.browse_directory(directory, page.next_offset)
    limited |= bool(queue) or len(paths) > 1_000
    paths = paths[:1_000]
    changed = {file.path for file in source.files}
    available = set(paths)
    texts: dict[str, str] = {}
    nodes: list[dict[str, object]] = []
    edges: dict[str, list[str]] = {}
    consumed = 0
    for path in sorted(paths, key=lambda item: (item not in changed, item)):
        extension = PurePosixPath(path).suffix.lower()
        wanted = extension in _SOURCE or PurePosixPath(path).name in {
            "README.md",
            "package.json",
            "pyproject.toml",
            "Cargo.toml",
            "go.mod",
        }
        if not wanted:
            continue
        try:
            result = files.read_file(path, allow_unicode_bom=True, max_lines=65_536)
        except RepositoryFileError:
            limited = True
            continue
        text = "\n".join(line.text for line in result.lines)
        consumed += len(text.encode())
        if consumed > _MAX_SCAN_BYTES:
            limited = True
            break
        texts[path] = text
        symbols, imports = _symbols_and_imports(path, text)
        neighbors = [
            target for name in imports if (target := _resolve_import(path, name, available))
        ]
        edges[path] = neighbors
        nodes.append({"file": path, "symbols": symbols, "imports": neighbors})
    # Deterministic retrieval: changed source, one-hop callers/dependencies, tests and manifest.
    related = set(changed)
    for path, neighbors in edges.items():
        if path in changed:
            related.update(neighbors)
        if changed.intersection(neighbors):
            related.add(path)
    test_files = {
        path
        for path in texts
        if ("test" in path.lower() or "spec" in path.lower())
        and any(PurePosixPath(changed_path).stem.split(".")[0] in path for changed_path in changed)
    }
    selected = sorted(related | test_files, key=lambda path: (path not in changed, path))
    selected += [
        path
        for path in texts
        if PurePosixPath(path).name in {"package.json", "pyproject.toml", "README.md"}
    ]
    packet: dict[str, object] = {
        "pull_request": {
            "number": source.number,
            "title": redact_text(source.title),
            "description": redact_text(source.description),
            "base_sha": source.base_sha,
            "head_sha": source.head_sha,
        },
        "changed_files": [
            {
                "path": file.path,
                "previous_path": file.previous_path,
                "status": file.status,
                "patch": redact_text(file.patch) if file.patch else None,
                "patch_status": file.patch_status,
            }
            for file in source.files
        ],
        "repository_map": [],
        "excerpts": [],
    }
    # The PR cannot be silently dropped to make the budget fit.
    if len(json.dumps(packet, ensure_ascii=True)) > 90_000:
        raise ValueError("The pull request diff exceeds this review's context limit.")
    packet["repository_files"] = paths[:100]
    limited |= len(paths) > 100
    if len(json.dumps(packet, ensure_ascii=True)) > MAX_CONTEXT_CHARS - 30_000:
        packet["repository_files"] = []
        limited = True
    map_nodes: list[dict[str, object]] = []
    for node in nodes:
        if len(json.dumps([*map_nodes, node], ensure_ascii=True)) > 24_000:
            limited = True
            break
        map_nodes.append(node)
    packet["repository_map"] = map_nodes
    excerpts: list[dict[str, object]] = []
    for path in dict.fromkeys(selected):
        if path not in texts:
            continue
        lines = texts[path].splitlines()
        # Include surrounding changed hunks even when they occur deep in a source file.
        starts = [0]
        patch = next((file.patch for file in source.files if file.path == path), None)
        if patch:
            starts = [max(0, int(n) - 21) for n in re.findall(r"@@ -\d+(?:,\d+)? \+(\d+)", patch)][
                :4
            ] or [0]
        for start in starts:
            end = min(len(lines), start + 160)
            excerpt = {
                "path": path,
                "start_line": start + 1,
                "end_line": end,
                "content": redact_text(
                    "\n".join(f"{n + 1}: {lines[n]}" for n in range(start, end))
                ),
            }
            candidate = {**packet, "excerpts": [*excerpts, excerpt]}
            if len(json.dumps(candidate, ensure_ascii=True)) > MAX_CONTEXT_CHARS - 4_000:
                limited = True
                continue
            excerpts.append(excerpt)
    packet["excerpts"] = excerpts
    packet["coverage"] = {
        "visible_files": len(paths),
        "mapped_files": len(nodes),
        "included_map_nodes": len(map_nodes),
        "missing_patches": missing_patches,
        "excerpts_are_selected": True,
        "included_excerpts": len(excerpts),
        "limited": limited,
        "omitted_changed_files": source.omitted_files,
        "map_method": "Python AST and lexical JS/TS imports and declarations. Static hints only.",
    }
    serialized = json.dumps(packet, ensure_ascii=True)
    if len(serialized) > MAX_CONTEXT_CHARS:
        raise ValueError("The review context exceeds its size limit.")
    return ReviewContext(serialized, len(paths), len(nodes), len(excerpts), limited)
