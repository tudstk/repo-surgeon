# Product scope

Repo Surgeon is a local-first coding agent that investigates repositories, proposes evidence-backed changes, tests them in an isolated sandbox, and requires explicit human approval before applying a change.

The MVP begins with bounded read-only repository inspection and preserves backend-enforced human control for every write.

Milestone 4 provides a bounded read-only bug-investigation workflow over the Milestone 3 search and repository-summary contracts. The frontend can submit a question for a registered repository and display ranked hypotheses with retrieved evidence, confidence labels, and verification suggestions; unsupported questions remain insufficient-evidence results, and the canonical seeded fixture requires deterministic behavioral proof. Sandboxing, proposals, approvals, patch application, audits, and pull requests remain roadmap work.
