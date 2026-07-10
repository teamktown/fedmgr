/**
 * FileSubordinateRegistry
 *
 * Persistent variant of SubordinateRegistry that reads/writes a JSON file.
 * Designed as a drop-in replacement: it extends SubordinateRegistry so
 * existing code that holds a SubordinateRegistry reference works unchanged.
 *
 * File format: JSON array of SubordinateEntry objects.
 *
 * Policy:
 *   - Writes are synchronous (fs.writeFileSync) to avoid losing data between
 *     concurrent awaits; the registry is written infrequently (admin-plane ops).
 *   - Reads happen once at construction time.
 *   - The parent directory is created if it doesn't exist.
 *
 * Usage:
 *   const registry = new FileSubordinateRegistry("/var/lib/ta/registry.json");
 *   // All SubordinateRegistry methods work; register() additionally persists.
 */

import fs from "node:fs";
import path from "node:path";
import {
  SubordinateRegistry,
  type SubordinateEntry,
} from "./subordinate-statements.js";

export class FileSubordinateRegistry extends SubordinateRegistry {
  private readonly filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = path.resolve(filePath);
    this._load();
  }

  override register(entry: SubordinateEntry): void {
    super.register(entry);
    this._save();
  }

  /** Remove a subordinate entry and persist. */
  remove(entityId: string): boolean {
    const existed = this.entries.has(entityId);
    if (existed) {
      this.entries.delete(entityId);
      this._save();
    }
    return existed;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const entries = JSON.parse(raw) as SubordinateEntry[];
      for (const entry of entries) {
        // Use super.register() so we don't trigger _save() during load.
        super.register(entry);
      }
    } catch {
      // File doesn't exist yet or is empty — start fresh.
    }
  }

  private _save(): void {
    const entries = this.listEntityIds().map((id) => this.entries.get(id)!);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 2), "utf8");
  }
}
