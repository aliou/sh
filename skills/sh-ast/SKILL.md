---
name: sh-ast
description: |
  Parse and analyze shell commands using @aliou/sh. Use when working with shell
  scripts programmatically: extracting commands, analyzing pipelines, finding
  variables, checking for unsafe patterns, transforming shell code, or traversing
  the AST.
---

# @aliou/sh - Shell Parser

Parse shell commands into a typed AST for analysis and transformation.

## Quick Start

```typescript
import { parse } from "@aliou/sh";

const { ast } = parse('echo "hello $USER" | grep hello');
// ast.type === "Program"
// ast.body[0].command.type === "Pipeline"
```

## AST Structure

**Program** → contains **Statement[]** → each wraps a **Command**

### Command Types

| Type | Shell Syntax |
|------|-------------|
| `SimpleCommand` | `cmd args...` |
| `Pipeline` | `cmd1 \| cmd2` |
| `Logical` | `cmd1 && cmd2`, `cmd1 \|\| cmd2` |
| `IfClause` | `if cond; then ... fi` |
| `WhileClause` | `while cond; do ... done` |
| `ForClause` | `for x in a b c; do ... done` |
| `SelectClause` | `select x in a b c; do ... done` |
| `CStyleLoop` | `for ((i=0; i<10; i++)); do ... done` |
| `CaseClause` | `case x in a) ... esac` |
| `FunctionDecl` | `foo() { ... }` |
| `Subshell` | `( ... )` |
| `Block` | `{ ... }` |
| `TestClause` | `[[ ... ]]` |
| `ArithCmd` | `(( ... ))` |
| `CoprocClause` | `coproc name { ... }` |
| `TimeClause` | `time cmd` |
| `DeclClause` | `declare`, `local`, `export` |
| `LetClause` | `let x=1` |

### Word Parts

Words in commands contain typed parts:

| Part | Example |
|------|---------|
| `Literal` | `echo` |
| `SglQuoted` | `'hello'` |
| `DblQuoted` | `"hello $USER"` (contains nested parts) |
| `ParamExp` | `$USER`, `${var:-default}` |
| `CmdSubst` | `$(date)`, `` `date` `` |
| `ArithExp` | `$((1 + 2))` |
| `ProcSubst` | `<(cmd)`, `>(cmd)` |
| `BraceExp` | `{a,b}`, `{1..5}` (via `splitBraces`) |
| `ExtGlob` | `@(foo)`, `*(bar)` (Bash/mksh) |

### Positions

Every AST node has `pos` and `end` of type `Pos`:

```typescript
import type { Pos } from "@aliou/sh";

interface Pos {
  offset: number; // 0-indexed bytes
  line: number;   // 1-indexed
  col: number;    // 1-indexed
}
```

Use `NO_POS` as a sentinel when building nodes outside the parser.

## Parser Options

```typescript
interface ParseOptions {
  dialect?: "posix" | "bash" | "mksh" | "zsh"; // default: "bash"
  keepComments?: boolean; // default: false
  recoverErrors?: boolean; // default: false
}
```

Use `recoverErrors: true` to get a partial AST plus an `errors` array instead of throwing.

## Other Exports

- `parseStmtsSeq(source, options?)` -- yield each top-level statement lazily
- `parseWordsSeq(source, options?)` -- yield each word lazily
- `splitBraces(word)` -- expand `{a,b}` / `{1..5}` brace expansion in place
- `NO_POS` -- sentinel position

## Examples

### Extract Command Names

```typescript
import { parse, type SimpleCommand } from "@aliou/sh";

function extractCommandNames(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  const names: string[] = [];

  if (n.type === "SimpleCommand") {
    const cmd = n as unknown as SimpleCommand;
    if (cmd.words?.length) {
      const first = cmd.words[0];
      if (first.parts.length === 1 && first.parts[0].type === "Literal") {
        names.push(first.parts[0].value);
      }
    }
  }

  for (const val of Object.values(n)) {
    if (Array.isArray(val)) {
      for (const item of val) names.push(...extractCommandNames(item));
    } else if (val && typeof val === "object") {
      names.push(...extractCommandNames(val));
    }
  }
  return names;
}

const { ast } = parse("cat file | grep pattern | head -5");
extractCommandNames(ast); // ["cat", "grep", "head"]
```

### Find All Variables Used

```typescript
import { parse, type WordPart } from "@aliou/sh";

function findVariables(node: unknown): Set<string> {
  const vars = new Set<string>();

  function walk(n: unknown): void {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown>;

    if (obj.type === "ParamExp") {
      const param = (obj as { param: { value: string } }).param;
      vars.add(param.value);
    }

    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === "object") walk(val);
    }
  }

  walk(node);
  return vars;
}

const { ast } = parse('echo "$HOME" && cat "$PWD/file.txt"');
findVariables(ast); // Set {"HOME", "PWD"}
```

### Check for Command Substitution (security analysis)

```typescript
import { parse } from "@aliou/sh";

function hasCommandSubstitution(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const obj = node as Record<string, unknown>;

  if (obj.type === "CmdSubst" || obj.type === "ProcSubst") {
    return true;
  }

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      if (val.some(hasCommandSubstitution)) return true;
    } else if (val && typeof val === "object") {
      if (hasCommandSubstitution(val)) return true;
    }
  }
  return false;
}

const { ast } = parse('echo $(dangerous)');
hasCommandSubstitution(ast); // true
```

### Analyze Pipeline Structure

```typescript
import { parse, type Statement, type Pipeline, type SimpleCommand } from "@aliou/sh";

interface PipelineInfo {
  commands: string[];
  hasBackground: boolean;
}

function analyzePipeline(stmt: Statement): PipelineInfo | null {
  const cmd = stmt.command;
  if (cmd.type !== "Pipeline") return null;

  const commands: string[] = [];
  for (const pipelineStmt of cmd.commands) {
    if (pipelineStmt.command.type === "SimpleCommand") {
      const sc = pipelineStmt.command as SimpleCommand;
      if (sc.words?.[0]?.parts?.[0]?.type === "Literal") {
        commands.push(sc.words[0].parts[0].value);
      }
    }
  }

  return {
    commands,
    hasBackground: stmt.background ?? false,
  };
}

const { ast } = parse("cmd1 | cmd2 | cmd3 &");
analyzePipeline(ast.body[0]);
// { commands: ["cmd1", "cmd2", "cmd3"], hasBackground: true }
```

### Extract Redirects

```typescript
import { parse, type SimpleCommand, type Redirect } from "@aliou/sh";

interface RedirectInfo {
  op: string;
  fd?: string;
  target: string;
}

function extractRedirects(cmd: SimpleCommand): RedirectInfo[] {
  if (!cmd.redirects) return [];

  return cmd.redirects.map((r: Redirect) => ({
    op: r.op,
    fd: r.fd,
    target: r.target.parts
      .map((p) => (p.type === "Literal" ? p.value : p.type === "ParamExp" ? `$${p.param.value}` : "..."))
      .join(""),
  }));
}

const { ast } = parse("echo hello > file.txt 2>&1");
const cmd = ast.body[0].command as SimpleCommand;
extractRedirects(cmd);
// [{ op: ">", target: "file.txt" }, { op: ">&", fd: "2", target: "1" }]
```

`fd` is either a numeric string (`"2"`) or, in Bash/Zsh, a `{varname}` redirect such as `"{fd}"`:

```typescript
const { ast } = parse("foo {fd}<file");
const cmd = ast.body[0].command as SimpleCommand;
extractRedirects(cmd);
// [{ op: "<", fd: "{fd}", target: "file" }]
```

`{varname}` redirects are rejected in POSIX and mksh dialects.

### Count AST Nodes (complexity metric)

```typescript
import { parse } from "@aliou/sh";

function countNodes(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const obj = node as Record<string, unknown>;

  let count = 1; // Count this node

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      count += val.reduce((sum, item) => sum + countNodes(item), 0);
    } else if (val && typeof val === "object") {
      count += countNodes(val);
    }
  }

  return count;
}

const { ast } = parse("if true; then echo hi; fi");
countNodes(ast); // Approximate complexity
```

### Expand Brace Expansion

```typescript
import { parse, splitBraces, type Word } from "@aliou/sh";

const { ast } = parse("echo {a,b,c}.txt");
const word = ast.body[0].command as { words?: Word[] };
const target = word.words?.[1];
if (target) splitBraces(target);
// target.parts now contains a BraceExp node with three elements
```

## Common Patterns

### Walk all nodes

```typescript
function walk(node: unknown, visitor: (n: unknown) => void): void {
  if (!node || typeof node !== "object") return;
  visitor(node);
  const obj = node as Record<string, unknown>;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) val.forEach((item) => walk(item, visitor));
    else if (val && typeof val === "object") walk(val, visitor);
  }
}
```

### Type guards

```typescript
function isSimpleCommand(node: unknown): node is { type: "SimpleCommand" } {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: string }).type === "SimpleCommand"
  );
}
```

## Limitations

- Not a complete POSIX/Bash parser; some edge cases may differ from mvdan/sh.
- `ExtGlob` keeps its inner pattern as a raw string.
- `parse` does not perform brace expansion; call `splitBraces` explicitly.
