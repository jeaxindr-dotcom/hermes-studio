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

- `%LOCALAPPDATA%\\hermes` (profiles, state databases, skills, credentials, workspaces)
- `%USERPROFILE%\\.hermes-web-ui` (Studio UI/session data)
- `%APPDATA%\\hermes-studio` (Electron window data)

Only the installed `resources/webui/dist` bundle is replaced during deployment. Keep
a dated archive of that directory before every replacement so rollback does not
require reinstalling Studio.

## Update workflow

Run from the repository with the supported Node 24 binary available on `PATH`:

```bash
git status --short
git fetch upstream origin
git switch main
git merge --ff-only upstream/main
git push origin main
git switch feat/agents-tasks-code-workspace
git rebase main
```

Resolve conflicts in the feature branch, then run the focused UI/security tests,
client and server typechecks, OpenAPI generation, and the production build:

```bash
./node_modules/.bin/vitest run \
  tests/client/style-system.test.ts \
  tests/client/session-activity-panel.test.ts \
  tests/client/session-activity-wiring.test.ts \
  tests/client/virtual-message-list-scroll.test.ts \
  tests/client/code-workspace-source.test.ts \
  tests/client/page-sidebar-code-nav.test.ts \
  tests/client/code-assistant-dock.test.ts \
  tests/server/coding-agent-workspace-authorization.test.ts \
  tests/server/session-activity-db.test.ts \
  tests/server/terminal-cwd.test.ts
./node_modules/.bin/vue-tsc -b
./node_modules/.bin/tsc --noEmit -p packages/server/tsconfig.json
npm run build
```

Do not deploy if any new focused test, typecheck, or build error appears. Re-run
the native smoke checks after each rebase: Discussion Tasks/Sous-agents wheel,
Group and Workflow wheel, sidebar drag/persistence, titlebar alignment, Code chat,
Monaco, terminal authorization, and unsaved-tab protection.

## Deploy and rollback

Build `dist/` from this checkout and replace only the installed web bundle using
the maintained reversible deployment helper in the workspace. The helper stops
Studio, stages the new bundle, validates it, renames the previous bundle, launches
Studio, and waits for the backend health endpoint. Keep the archive created before
the deployment.

If the build is bad, quit Studio and restore the archived `dist` directory. Do not
restore or overwrite profile/session directories. After a successful deployment,
fully quit and relaunch Studio once so Electron does not retain old renderer chunks.

## Push discipline

After review and native verification:

```bash
git diff --cached --check
git commit -m "feat: extend Studio workspace and activity sidebars"
git push -u origin feat/agents-tasks-code-workspace
```

When upstream changes conflict with these features, resolve the source conflict,
repeat the checks and native smoke tests, then push the updated branch. The fork,
feature branch, and this maintenance document are the durable mechanism that keeps
these changes available after official Studio releases; an official update can
replace the installed bundle, but it cannot replace this Git history or the user
data outside the application bundle.
