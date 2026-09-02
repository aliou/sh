---
"@aliou/sh": patch
---

Fix parsing of commands that open multiple heredocs on one line (`cat << A << B`) or place a separator after a heredoc opener (`cmd << EOF && next`): heredoc bodies are now queued per command line and assigned to their redirects in opener order instead of throwing an unexpected-token parse error.
