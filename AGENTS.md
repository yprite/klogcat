# Agent Instructions

## Mandatory documentation entrypoint

After reading this file, every AI agent must read `docs/INDEX.md` before opening any other documentation file.

Do not bulk-read all files under `docs/`. Use `docs/INDEX.md` to choose the minimum document set required for the task, then open only those documents.

When adding, moving, or deleting documentation under `docs/`, update `docs/INDEX.md` in the same change and run:

```bash
npm run test:docs-index
```

## Mandatory worktree workflow

All AI agents must do coding work in a dedicated git worktree. Do not edit the primary checkout directly for feature, fix, refactor, test, or documentation changes unless the user explicitly overrides this rule.

Required workflow:

1. Start by checking repository state with `git status --short --branch`.
2. Create or use a separate worktree for the task, for example:
   `git worktree add ../klogcat-<task-slug> -b <branch-name> origin/main`
3. Perform all file edits, tests, commits, and pushes from that worktree.
4. Keep the primary checkout clean and reserved for coordination, review, and final branch switching.
5. Before reporting completion, verify the worktree branch, commit, push status, and working tree cleanliness.

If a session begins with an already-active merge, rebase, cherry-pick, or conflict in the primary checkout, finish or abort that operation deliberately before starting any new coding worktree.
