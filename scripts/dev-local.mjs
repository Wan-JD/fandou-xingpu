import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm dev.");
const pnpmArgs = (args) => [pnpmCli, ...args];
const migrate = spawnSync(process.execPath, pnpmArgs(["--dir", "apps/api", "db:migrate:local"]), { cwd: root, stdio: "inherit", shell: false });
if (migrate.error) throw migrate.error;
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const children = [
  spawn(process.execPath, pnpmArgs(["--dir", "apps/api", "dev"]), { cwd: root, stdio: "inherit", shell: false }),
  spawn(process.execPath, pnpmArgs(["--dir", "apps/web", "dev"]), { cwd: root, stdio: "inherit", shell: false }),
];
let shuttingDown = false;
const stop = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children) {
  child.on("error", (cause) => { console.error(cause); stop(); process.exitCode = 1; });
  child.on("exit", (code) => { if (!shuttingDown) { process.exitCode = code ?? 1; stop(); } });
}
