import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { AgentPersona } from '../types.js';
import { createDefaultPersonas } from './defaults.js';
import { openDatabase } from '../db/database.js';

export class PersonaRegistry {
  private db: DatabaseSync;

  constructor(storageDir = path.resolve(process.cwd(), 'data')) {
    this.db = openDatabase(storageDir);
    this.ensureSeeded();
  }

  private ensureSeeded(): void {
    const { count } = this.db.prepare(`SELECT COUNT(*) as count FROM personas`).get() as { count: number };
    if (count === 0) {
      for (const persona of createDefaultPersonas()) {
        this.set(persona);
      }
    }
  }

  public getAll(): AgentPersona[] {
    const rows = this.db.prepare(`SELECT data FROM personas`).all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as AgentPersona);
  }

  public get(id: string): AgentPersona | undefined {
    const row = this.db.prepare(`SELECT data FROM personas WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AgentPersona) : undefined;
  }

  public set(persona: AgentPersona): void {
    this.db
      .prepare(`INSERT INTO personas (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(persona.id, JSON.stringify(persona));
  }

  public remove(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM personas WHERE id = ?`).run(id);
    return result.changes > 0;
  }
}
