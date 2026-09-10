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

This boundary deliberately does not include SSE, a real provider, persistence
of turn traces, proposal generation, or repository writes. Those capabilities
must be added behind separate reviewed contracts.
