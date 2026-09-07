# Repo Surgeon

  Repo Surgeon is a local-first, human-controlled coding assistant for understanding and safely changing real Git repositories.

  It helps developers inspect code with bounded read-only tools, investigate problems using evidence and file-line citations, draft changes in isolated
  environments, run selected tests without touching the source checkout, and review a complete diff before anything is applied.

  The core principle is simple: the assistant can investigate and propose, but people stay in control of every repository write. Approval, application, and
  pull-request creation are separate, explicit actions enforced by the application rather than delegated to model instructions.

  Repo Surgeon is being built as a Python-first modular monolith with FastAPI, PostgreSQL, typed async services, MCP tools, isolated sandbox execution, and
  a polished React workspace. It is designed both as a practical developer tool and as a transparent learning project for modern backend, frontend, AI-
  agent, and security engineering.
