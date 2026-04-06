#!/usr/bin/env node

// Cross-platform dev setup for venpm.
// Usage: node scripts/setup.mjs
//
// What it does:
//   1. Checks Node.js version (>=18 required)
//   2. Checks npm is available
//   3. Runs npm install
//   4. Builds TypeScript
//   5. Links venpm globally (npm link)
//   6. Verifies the global command works

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const isWindows = process.platform === "win32";
const PASS = "\x1b[32m\u2714\x1b[0m";
const FAIL = "\x1b[31m\u2716\x1b[0m";
const WARN = "\x1b[33m\u26A0\x1b[0m";

function run(cmd, opts = {}) {
    try {
        return execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf-8", ...opts }).trim();
    } catch (err) {
        return null;
    }
}

function log(symbol, msg) {
    console.log(`  ${symbol} ${msg}`);
}

console.log("\n  venpm dev setup\n");

// 1. Check Node.js version
const nodeVersion = process.versions.node;
const [major] = nodeVersion.split(".").map(Number);
if (major < 18) {
    log(FAIL, `Node.js >= 18 required (you have ${nodeVersion})`);
    process.exit(1);
}
log(PASS, `Node.js ${nodeVersion}`);

// 2. Check npm
const npmVersion = run("npm --version");
if (!npmVersion) {
    log(FAIL, "npm not found");
    process.exit(1);
}
log(PASS, `npm ${npmVersion}`);

// 3. Check optional tools
const gitVersion = run("git --version");
if (gitVersion) {
    log(PASS, gitVersion);
} else {
    log(WARN, "git not found (venpm will use tarball-only mode)");
}

const pnpmVersion = run("pnpm --version");
if (pnpmVersion) {
    log(PASS, `pnpm ${pnpmVersion}`);
} else {
    log(WARN, "pnpm not found (venpm rebuild won't work)");
}

console.log();

// 4. npm install
console.log("  Installing dependencies...");
try {
    execSync("npm install", { cwd: root, stdio: "inherit" });
} catch {
    log(FAIL, "npm install failed");
    process.exit(1);
}
log(PASS, "Dependencies installed");

// 5. Build
console.log("  Building...");
try {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
} catch {
    log(FAIL, "Build failed");
    process.exit(1);
}
log(PASS, "TypeScript compiled");

// 6. Check dist/index.js has shebang
const distEntry = join(root, "dist", "index.js");
if (!existsSync(distEntry)) {
    log(FAIL, "dist/index.js not found after build");
    process.exit(1);
}

// 7. npm link
console.log("  Linking globally...");
try {
    execSync("npm link", { cwd: root, stdio: "inherit" });
} catch {
    log(WARN, "npm link failed — you may need to run with sudo (Linux/macOS) or as admin (Windows)");
    log(WARN, "Alternatively: npm link --prefix ~/.local");
    console.log(`\n  You can still run venpm directly: node ${distEntry}\n`);
    process.exit(0);
}
log(PASS, "venpm linked globally");

// 8. Verify
console.log();
const venpmVersion = run(isWindows ? "venpm.cmd --version" : "venpm --version");
if (venpmVersion) {
    log(PASS, `venpm ${venpmVersion} is ready!`);
} else {
    log(WARN, "venpm command not found in PATH — you may need to restart your shell");
    log(WARN, `Direct usage: node ${distEntry}`);
}

console.log(`
  Quick start:
    venpm doctor          Check your environment
    venpm search <query>  Find plugins
    venpm install <name>  Install a plugin
    venpm --help          All commands

  Development:
    npm run dev           Watch mode (auto-rebuild on changes)
    npm test              Run tests
    npm run lint          Type check
`);
