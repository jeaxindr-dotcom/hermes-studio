# Maintaining the Hermes Studio local fork

This checkout is the durable source of the local Hermes Studio customizations. The
installed Electron bundle is only a build artifact and must not be patched by hand.

## Remotes and branch

- `origin`: the personal fork (`jeaxindr-dotcom/hermes-studio`)
- `upstream`: the creator repository (`EKKOLearnAI/hermes-studio`)
- feature branch: `feat/agents-tasks-code-workspace`

Keep the feature work on this branch. Do not put local UI changes directly on a
moving upstream branch.

## What an upstream update must not touch

The following are user data, not source files. Never delete them during an update:

- `%LOCALAPPDATA%\hermes` (profiles, state databases, skills, credentials, workspaces)
- `%USERPROFILE%\.hermes-web-ui` (Studio UI/session data)
- `%APPDATA%\hermes-studio` (Electron window data)

An official update can replace the installed application bundle. It cannot replace
this Git history or the user data outside the bundle.

## Update workflow

Use a published official tag (`vX.Y.Z`), not unpublished `upstream/main`.

1. `git fetch upstream origin`
2. Create a backup branch/tag of the current custom HEAD
3. Materialize the merge in an isolated branch/worktree
4. Regenerate OpenAPI/lockfiles/dist
5. Run focused tests, typechecks, and `npm run build`
6. Package a Windows installer from `packages/desktop`
7. Install that installer and verify the native window, hashes, and `/health`
8. Only then promote `feat/agents-tasks-code-workspace` and `custom-latest`

Do not replace only `resources/webui/dist` when Electron main/preload/packaging
changed. Do not rebase the custom history onto moving `main`.

When an upstream update is available, prepare it with the three-way report first:

```bash
npm run upstream:report
```

A clean Git merge is not enough. Native smoke after install: Discussion
Tasks/Sous-agents, project drag, Code chat, updater feed stays on the fork,
and a heavy run must not kill the window.

## Push discipline

After review and native verification, push the isolated sync branch first. Promote
the maintained custom branch only after the installed native app is verified.
