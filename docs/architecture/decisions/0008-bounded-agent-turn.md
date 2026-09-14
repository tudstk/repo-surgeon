# 0008: Bounded read-only agent turns

The first model-facing application service uses a narrow async `ModelProvider`
protocol and the in-process `McpFileTools` contract. Provider adapters return
typed normalized responses; tests use `FakeModelProvider`, so no API key or
network is needed.

`run_turn` enforces model-call, tool-call, equivalent-repeat, wall-clock, and
returned-byte limits in application code. It returns a typed partial result when
a limit is reached. Only `list_files` and `read_file` are authorized. Unknown
operations, including writes, become deterministic denied tool results and can
never mutate the registered repository.

All synchronous repository inspection, including repository-root resolution and
construction of the confined file service, runs in one process-wide,
single-worker executor. A global slot is held until the underlying operation
actually finishes, even when its caller is cancelled. Other callers wait for
that slot without submitting queued work, so timed-out operations can strand at
most one worker and repeated timeouts cannot accumulate threads or queued
filesystem calls. Python cannot forcibly terminate an arbitrary blocking syscall
in a thread, so the turn deadline is a hard caller-visible deadline; the
underlying operation may finish later. A future killable worker process is
required before claiming hard termination of filesystem work.

Every provider-facing tool result uses one canonical JSON encoding. The tool
adapter refuses work when the remaining budget is smaller than the minimum
representable error envelope, and otherwise returns a success or error whose
serialized size fits the exact supplied budget. The agent loop repeats the same
pre-dispatch check and replaces any nonconforming adapter result with the bounded
error envelope.

Equivalent-call accounting uses validated tool arguments after the application
repository ID, schema defaults, and clamps are applied. Provider call IDs are
first reserved across the complete response batch, then missing, invalid, or
duplicate IDs receive bounded generated replacements without colliding with a
later opaque provider ID.

This boundary deliberately does not include SSE, a real provider, persistence
of turn traces, proposal generation, or repository writes. Those capabilities
must be added behind separate reviewed contracts.
