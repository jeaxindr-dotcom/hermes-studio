---
date: 2026-08-10
commit: pending-validation
feature: Session status indicators
impact: One status dot represents each session state; unread replies take precedence over the empty-history fallback, and Ctrl/Cmd-click remains routed through the desktop open-new handler without selecting the row.
---

The session list status implementation was tightened after independent review. The visible indicator is now the single representation for unread replies, working, waiting, finished, and error states. Validation covers the status derivation, session-row behavior, custom updater contract, typechecks, harness, and production build.
