import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../src/config.mjs";

const sourceArgument = process.argv[2];
if (!sourceArgument) throw new Error("usage: node scripts/restore.mjs <backup.sqlite>");
const sourcePath = path.resolve(sourceArgument);
const targetPath = path.resolve(loadConfig().dbPath);
if (!existsSync(sourcePath) || sourcePath === targetPath || targetPath === path.parse(targetPath).root) throw new Error("invalid_restore_source");

function verifyDatabase(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
    const schemaVersion = database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value;
    if (integrity.integrity_check !== "ok" || foreignKeyErrors.length || !schemaVersion) throw new Error("restore_verification_failed");
  } finally {
    database.close();
  }
}

verifyDatabase(sourcePath);
mkdirSync(path.dirname(targetPath), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const pendingPath = `${targetPath}.restore-pending-${stamp}`;
copyFileSync(sourcePath, pendingPath);
verifyDatabase(pendingPath);

if (existsSync(targetPath)) {
  const safetyCopy = `${targetPath}.before-restore-${stamp}`;
  copyFileSync(targetPath, safetyCopy);
  console.log(JSON.stringify({ event: "safety_copy", path: safetyCopy }));
  unlinkSync(targetPath);
}
for (const sidecar of [`${targetPath}-wal`, `${targetPath}-shm`]) {
  if (existsSync(sidecar)) unlinkSync(sidecar);
}
renameSync(pendingPath, targetPath);
verifyDatabase(targetPath);
console.log(JSON.stringify({ ok: true, restored: targetPath, source: sourcePath }));
