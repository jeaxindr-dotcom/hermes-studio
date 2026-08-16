---
date: 2026-08-16
pr: 1
feature: Windows hardening preserved during upstream 0.6.43 sync
impact: The synchronized custom Studio keeps renderer and Web UI recovery, steering, project drag-and-drop, and safe shutdown behavior while adopting the official 0.6.43 chat and navigation updates.
---

# Windows hardening preserved during upstream sync

The local crash-hardening commits based on the custom 0.6.40 build are merged
after the official 0.6.43 synchronization. Shared chat files keep the official
queue component and navigation entries while retaining the custom steering and
project behaviors. Desktop renderer recovery and automatic Web UI restart remain
enabled, and the server continues to distinguish recoverable Windows teardown
errors from fatal process failures.

The installed Web bundle can therefore be upgraded without losing the recovery
behavior of the previously installed custom build.
