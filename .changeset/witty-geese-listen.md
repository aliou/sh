---
"@aliou/sh": patch
---

Fix heredoc commands swallowing the statement that follows the delimiter line: a heredoc as the last command of an if/for/while body no longer throws, and a command after the delimiter now parses as its own statement instead of merging into the heredoc-opening command.
