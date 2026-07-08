// core/journal.ts — the reversibility ledger.
//
// Every mutating action is recorded with its mechanical inverse BEFORE the
// next action runs, and the journal is persisted after every batch, so a
// crash mid-apply still leaves --restore able to clean up on the next run.
// Reversibility is mandatory: no mutation without its inverse (or, for
// close_process, an honest record that it can't be reopened automatically).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { JournalBatch } from "./types";

const NVPILOT_DIR = join(homedir(), ".nvpilot");
const JOURNAL_PATH = join(NVPILOT_DIR, "journal.json");

export class Journal {
  private batches: JournalBatch[] = [];

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (existsSync(JOURNAL_PATH)) {
        this.batches = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));
      }
    } catch {
      this.batches = []; // corrupted journal: start clean rather than crash
    }
  }

  save(): void {
    try {
      if (!existsSync(NVPILOT_DIR)) mkdirSync(NVPILOT_DIR, { recursive: true });
      writeFileSync(JOURNAL_PATH, JSON.stringify(this.batches, null, 2), "utf-8");
    } catch (err) {
      console.error(`  [journal] failed to persist: ${err}`);
    }
  }

  addBatch(batch: JournalBatch): void {
    this.batches.push(batch);
    this.save();
  }

  removeBatch(id: string): void {
    this.batches = this.batches.filter((b) => b.id !== id);
    this.save();
  }

  /** Batches with changes still applied, newest first (revert order). */
  activeBatches(): JournalBatch[] {
    return [...this.batches].reverse();
  }

  hasActiveChanges(): boolean {
    return this.batches.length > 0;
  }

  clear(): void {
    this.batches = [];
    this.save();
  }
}
