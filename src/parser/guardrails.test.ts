import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import { extractCommandNames } from "../test-helpers/extract-command-names";

// Real-world guardrail validation tests.
// The guardrails extension blocks commands matching /\bnpm\b/ on the full
// command string. This causes false positives when "npm" appears in arguments,
// grep patterns, heredocs, or subcommand strings rather than as the actual
// command being invoked.
//
// These tests validate that the parser produces an AST where the actual
// command name (first word of a SimpleCommand) is distinguishable from
// arguments, allowing a smarter guardrail to only check command positions.
describe("guardrail validation: package manager enforcement", () => {
  // Tests where npm appears in arguments/patterns but is NOT a command.
  it.each([
    {
      desc: "grep for npm pattern",
      input: String.raw`grep -rn '\bnpm\b' src/`,
      expected: ["grep"],
    },
    {
      desc: "grep with multiple npm/npx patterns",
      input: String.raw`grep -rn '\bnpx\b\|\bnpm \b\|\bnpm$' AGENTS.md`,
      expected: ["grep"],
    },
    {
      desc: "echo containing npm",
      input: 'echo "use npm install instead"',
      expected: ["echo"],
    },
    {
      desc: "cat of package.json",
      input: "cat /path/to/package.json",
      expected: ["cat"],
    },
    {
      desc: "npx is not npm",
      input: "npx wrangler --version",
      expected: ["npx"],
    },
    {
      desc: "pnpm is not npm",
      input: "pnpm --filter pi-relay-server typecheck",
      expected: ["pnpm"],
    },
    {
      desc: "which npm is not running npm",
      input: "which npm 2>/dev/null || echo 'npm not found'",
      expected: ["which", "echo"],
    },
    {
      desc: "if condition with npm check",
      input: "if command -v npm; then echo found; fi",
      expected: ["command", "echo"],
    },
    {
      desc: "variable assignment containing npm",
      input: 'PKG_MGR=npm echo "using $PKG_MGR"',
      expected: ["echo"],
    },
    {
      desc: "herestring containing npm",
      input: "grep -c npm <<< 'npm install pnpm bun'",
      expected: ["grep"],
    },
    {
      desc: "pipeline with npm in args",
      input: "find . -name '*.json' | grep npm | head -5",
      expected: ["find", "grep", "head"],
    },
    {
      desc: "biome check via pnpm exec",
      input: "pnpm exec biome check --write src/sandbox/cloudflare.test.ts",
      expected: ["pnpm"],
    },
    {
      desc: "curl piped to jq",
      input: "curl -s http://localhost:31415/health | jq .",
      expected: ["curl", "jq"],
    },
  ])("$desc: npm is not extracted as a command", ({ input, expected }) => {
    const cmds = extractCommandNames(parse(input).ast);
    expect(cmds).toEqual(expected);
    expect(cmds).not.toContain("npm");
  });

  // Tests where npm IS a real command.
  it.each([
    { desc: "npm install", input: "npm install --omit=dev" },
    { desc: "npm ci", input: "npm ci" },
    { desc: "npm in command substitution", input: "echo $(npm pack)" },
    { desc: "npm in subshell", input: "(cd /tmp && npm install)" },
  ])("$desc: npm is extracted as a command", ({ input }) => {
    const cmds = extractCommandNames(parse(input).ast);
    expect(cmds).toContain("npm");
  });

  it("cd && pnpm: both commands identified correctly", () => {
    const cmds = extractCommandNames(
      parse("cd /project && pnpm --filter pi-relay-server test").ast,
    );
    expect(cmds).toEqual(["cd", "pnpm"]);
    expect(cmds).not.toContain("npm");
  });

  it("npm in || fallback: both branches identified", () => {
    const cmds = extractCommandNames(
      parse("npm ci --omit=dev 2>/dev/null || npm install --omit=dev").ast,
    );
    expect(cmds).toEqual(["npm", "npm"]);
  });

  it("heredoc containing npm install is not an npm command", () => {
    const input = `cat <<'EOF'
RUN npm install --omit=dev
npm ci
EOF`;
    const cmds = extractCommandNames(parse(input).ast);
    expect(cmds).toEqual(["cat"]);
    expect(cmds).not.toContain("npm");
  });

  it("docker build with heredoc Dockerfile containing npm", () => {
    const input = `docker build -t myimage -f - . <<'DOCKERFILE'
FROM node:22-slim
RUN npm install --omit=dev
DOCKERFILE`;
    const cmds = extractCommandNames(parse(input).ast);
    expect(cmds).toEqual(["docker"]);
    expect(cmds).not.toContain("npm");
  });

  it("real session: cd && pnpm filter test piped to tail", () => {
    const cmds = extractCommandNames(
      parse("cd /project && pnpm --filter pi-relay-server test 2>&1 | tail -15")
        .ast,
    );
    expect(cmds).toContain("cd");
    expect(cmds).toContain("pnpm");
    expect(cmds).toContain("tail");
    expect(cmds).not.toContain("npm");
  });

  it("real session: write Dockerfile via heredoc then docker build", () => {
    const input = `mkdir -p /tmp/cf-sandbox-test && \\
cp bridge.js /tmp/cf-sandbox-test/ && \\
cat > /tmp/cf-sandbox-test/Dockerfile <<'DOCKERFILE'
FROM node:22-slim
RUN apt-get update && apt-get install -y curl tar bash git
WORKDIR /bridge
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true
COPY bridge.js ./
CMD ["node", "/bridge/bridge.js"]
DOCKERFILE

docker build --platform linux/arm64 -t pi-sandbox-cf:arm64-debian /tmp/cf-sandbox-test`;
    const { ast } = parse(input);
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("mkdir");
    expect(cmds).toContain("cp");
    expect(cmds).toContain("cat");
    expect(cmds).toContain("docker");
    expect(cmds).not.toContain("npm");
  });
});
