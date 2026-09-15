import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { backup } from "node:sqlite";
import { loadConfig } from "../src/config.mjs";
import { SubHubDatabase } from "../src/database.mjs";

const config = loadConfig();
if (config.dbPath === ":memory:") throw new Error("cannot_backup_memory_database");
const targetDirectory = path.resolve(process.argv[2] || process.env.SUBHUB_BACKUP_DIR || "./backups");
const sourcePath = path.resolve(config.dbPath);
if (targetDirectory === sourcePath || targetDirectory.startsWith(`${sourcePath}${path.sep}`)) throw new Error("invalid_backup_directory");

mkdirSync(targetDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const targetPath = path.join(targetDirectory, `subhub-${stamp}.sqlite`);
const database = new SubHubDatabase(sourcePath);
try {
  await backup(database.db, targetPath);
} finally {
  database.close();
}

const verified = new SubHubDatabase(targetPath);
try {
  const integrity = verified.db.prepare("PRAGMA integrity_check").get();
  const foreignKeyErrors = verified.db.prepare("PRAGMA foreign_key_check").all();
  if (integrity.integrity_check !== "ok" || foreignKeyErrors.length) throw new Error("backup_verification_failed");
} finally {
  verified.close();
}

const keep = Math.max(1, Number(process.env.SUBHUB_BACKUP_RETENTION || 14));
const files = readdirSync(targetDirectory)
  .filter((name) => /^subhub-.*\.sqlite$/.test(name))
  .map((name) => ({ name, modified: statSync(path.join(targetDirectory, name)).mtimeMs }))
  .sort((left, right) => right.modified - left.modified);
for (const file of files.slice(keep)) unlinkSync(path.join(targetDirectory, file.name));

console.log(JSON.stringify({ ok: true, backup: targetPath, retained: Math.min(files.length, keep) }));
