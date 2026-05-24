import * as fs from "fs";
import * as path from "path";
import { db, initDatabase } from "../database";

const PROJECT_ROOT = path.join(import.meta.dir, "../..");
const BACKUP_DIR = path.join(PROJECT_ROOT, "backups");
const DB_PATH = path.join(PROJECT_ROOT, "data/system.db");
const MAX_BACKUPS = 7;

function padded(n: number): string {
  return String(n).padStart(2, "0");
}

function timestamp(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}-${padded(d.getUTCMonth() + 1)}-${padded(d.getUTCDate())}` +
    `_${padded(d.getUTCHours())}-${padded(d.getUTCMinutes())}-${padded(d.getUTCSeconds())}`
  );
}

export async function createBackup(note?: string): Promise<{
  success: boolean;
  filename?: string;
  file_size_kb?: number;
  created_at?: string;
  backups_kept?: number;
  error?: string;
}> {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const filename = `system_db_backup_${timestamp()}.db`;
    const destPath = path.join(BACKUP_DIR, filename);

    fs.copyFileSync(DB_PATH, destPath);

    const stat = fs.statSync(destPath);
    const file_size_kb = Math.round(stat.size / 1024);
    const created_at = new Date().toISOString();

    db.run(
      "INSERT INTO backup_log (filename, file_size_kb, note) VALUES (?, ?, ?)",
      [filename, file_size_kb, note ?? null]
    );

    // Trim old backups keeping only MAX_BACKUPS most recent
    const all = db
      .query<{ id: number; filename: string }, []>(
        "SELECT id, filename FROM backup_log ORDER BY created_at DESC"
      )
      .all();

    let kept = 0;
    for (const row of all) {
      kept++;
      if (kept > MAX_BACKUPS) {
        const oldPath = path.join(BACKUP_DIR, row.filename);
        try { fs.unlinkSync(oldPath); } catch { /* already gone */ }
        db.run("DELETE FROM backup_log WHERE id = ?", [row.id]);
      }
    }

    return { success: true, filename, file_size_kb, created_at, backups_kept: Math.min(all.length, MAX_BACKUPS) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function restoreBackup(filename: string): Promise<{
  success: boolean;
  restored?: string;
  safety_backup?: string;
  error?: string;
}> {
  const srcPath = path.join(BACKUP_DIR, filename);

  if (!fs.existsSync(srcPath)) {
    return { success: false, error: "Backup file not found" };
  }

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const safetyName = `pre_restore_backup_${timestamp()}.db`;
    const safetyPath = path.join(BACKUP_DIR, safetyName);
    fs.copyFileSync(DB_PATH, safetyPath);

    const safetyStat = fs.statSync(safetyPath);
    db.run(
      "INSERT OR IGNORE INTO backup_log (filename, file_size_kb, note) VALUES (?, ?, ?)",
      [safetyName, Math.round(safetyStat.size / 1024), `Auto safety backup before restoring ${filename}`]
    );

    // Brief pause to let any pending WAL writes flush
    await new Promise((r) => setTimeout(r, 1000));

    fs.copyFileSync(srcPath, DB_PATH);

    initDatabase();

    db.run(
      "INSERT OR IGNORE INTO backup_log (filename, file_size_kb, note) VALUES (?, ?, ?)",
      [filename, Math.round(fs.statSync(srcPath).size / 1024), `Restored from ${filename}`]
    );

    return { success: true, restored: filename, safety_backup: safetyName };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listBackups(): Promise<{
  id: number;
  filename: string;
  file_size_kb: number;
  created_at: string;
  note: string | null;
  file_exists: boolean;
}[]> {
  const rows = db
    .query<{ id: number; filename: string; file_size_kb: number; created_at: string; note: string | null }, []>(
      "SELECT id, filename, file_size_kb, created_at, note FROM backup_log ORDER BY created_at DESC"
    )
    .all();

  return rows.map((r) => ({
    ...r,
    file_exists: fs.existsSync(path.join(BACKUP_DIR, r.filename)),
  }));
}

export async function deleteBackup(filename: string): Promise<{ success: boolean; error?: string }> {
  const filePath = path.join(BACKUP_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.run("DELETE FROM backup_log WHERE filename = ?", [filename]);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getBackupStats(): Promise<{
  total_backups: number;
  total_size_kb: number;
  oldest_backup: string | null;
  newest_backup: string | null;
  backups_dir: string;
  auto_backup_enabled: boolean;
}> {
  const total_backups =
    db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM backup_log").get()?.count ?? 0;

  const total_size_kb =
    db.query<{ total: number | null }, []>("SELECT SUM(file_size_kb) as total FROM backup_log").get()?.total ?? 0;

  const oldest_backup =
    db.query<{ created_at: string }, []>("SELECT created_at FROM backup_log ORDER BY created_at ASC LIMIT 1").get()?.created_at ?? null;

  const newest_backup =
    db.query<{ created_at: string }, []>("SELECT created_at FROM backup_log ORDER BY created_at DESC LIMIT 1").get()?.created_at ?? null;

  const autoRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'auto_backup_enabled'")
    .get();

  return {
    total_backups,
    total_size_kb: total_size_kb ?? 0,
    oldest_backup,
    newest_backup,
    backups_dir: BACKUP_DIR,
    auto_backup_enabled: autoRow?.value === "1",
  };
}

export function getBackupDir(): string {
  return BACKUP_DIR;
}
