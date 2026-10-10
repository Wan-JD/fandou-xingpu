import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(root, "apps", "api");
const directory = path.join(root, "backups");
mkdirSync(directory, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const output = path.join(directory, `fandou-local-${timestamp}.sql`);
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm db:backup:local.");
const result = spawnSync(process.execPath, [pnpmCli, "exec", "wrangler", "d1", "export", "DB", "--local", "-c", "wrangler.local.toml", "--output", output], { cwd: apiRoot, stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Backup written to ${output}`);
