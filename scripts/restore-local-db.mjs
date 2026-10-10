import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(root, "apps", "api");
const requested = process.env.BACKUP_FILE;
if (!requested) { console.error("Set BACKUP_FILE to a backups/*.sql export. Restore into a fresh local D1 database."); process.exit(1); }
const backup = path.resolve(root, requested);
const backupRoot = `${path.resolve(root, "backups")}${path.sep}`;
if (!backup.startsWith(backupRoot) || !backup.endsWith(".sql") || !existsSync(backup)) {
  console.error("BACKUP_FILE must name an existing .sql file inside the ignored backups directory.");
  process.exit(1);
}
const restoreState = path.resolve(root, process.env.RESTORE_STATE_DIR ?? "backups/restored-state");
if (!restoreState.startsWith(backupRoot)) {
  console.error("RESTORE_STATE_DIR must stay inside the ignored backups directory.");
  process.exit(1);
}
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm db:restore:local.");
const result = spawnSync(process.execPath, [pnpmCli, "exec", "wrangler", "d1", "execute", "DB", "--local", "-c", "wrangler.local.toml", "--persist-to", restoreState, "--file", backup], { cwd: apiRoot, stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
