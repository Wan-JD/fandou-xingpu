import { mkdirSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(root, "apps", "api");
const state = path.join(root, "backups", `verify-${Date.now()}`);
const port = Number(process.env.SMOKE_PORT ?? 8791);
const email = `isolated-admin-${Date.now()}@fandou.local`;
const password = `isolated-${crypto.randomUUID()}`;
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm test:integration:isolated.");
mkdirSync(state, { recursive: true });

const bootstrap = spawnSync(process.execPath, [pnpmCli, "--dir", "apps/api", "db:bootstrap:local"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_NAME: "隔离验收管理员", D1_PERSIST_TO: state },
});
if (bootstrap.error) throw bootstrap.error;
if (bootstrap.status !== 0) process.exit(bootstrap.status ?? 1);

const wranglerEntry = createRequire(path.join(apiRoot, "package.json")).resolve("wrangler/bin/wrangler.js");
const worker = spawn(process.execPath, [wranglerEntry, "dev", "-c", "wrangler.local.toml", "--persist-to", state, "--port", String(port)], {
  cwd: apiRoot,
  stdio: "inherit",
  shell: false,
});

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch { /* Worker is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Isolated Worker did not become ready.");
}

let exitCode = 1;
try {
  await waitForWorker();
  const smoke = spawnSync(process.execPath, [path.join(root, "scripts", "smoke-local.mjs")], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, API_BASE_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL: email, ADMIN_PASSWORD: password },
  });
  if (smoke.error) throw smoke.error;
  exitCode = smoke.status ?? 1;
} finally {
  if (worker.exitCode === null) {
    worker.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => worker.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  rmSync(state, { recursive: true, force: true });
}
process.exit(exitCode);
