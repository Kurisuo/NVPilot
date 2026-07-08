// core/executor.ts — the ACT phase.
//
// Consumes a Plan (pure data) and executes each action through the driver
// layer, recording the inverse of every successful mutation in a journal
// batch. Reverting a batch replays inverses in reverse order.

import { Drivers } from "../drivers/interfaces";
import { GameAdapter } from "../games/adapter";
import { getAdapter } from "../games/registry";
import {
  Action,
  ActionResult,
  JournalBatch,
  JournalEntry,
  JsonValue,
  Plan,
} from "./types";
import { Journal } from "./journal";

function invert(action: Action): Action | null {
  switch (action.kind) {
    case "game_setting":
      return { ...action, from: action.to, to: action.from };
    case "process_priority": {
      // Map the recorded platform-native label back to an abstract level
      // so the inverse restores whatever the process had before.
      const from = action.from.toLowerCase();
      const level = from.includes("high")
        ? "high"
        : from.includes("above")
          ? "above_normal"
          : "normal";
      return {
        kind: "process_priority",
        pid: action.pid,
        processName: action.processName,
        from: action.to,
        to: level,
      };
    }
    case "power_state":
      return { kind: "power_state", from: action.to, to: action.from };
    case "close_process":
      return null; // cannot reopen an app for the user — journaled honestly
  }
}

async function execute(
  action: Action,
  drivers: Drivers,
  adapter: GameAdapter | null
): Promise<ActionResult> {
  switch (action.kind) {
    case "game_setting": {
      const game = adapter?.id === action.game ? adapter : getAdapter(action.game);
      if (!game) return { ok: false, message: `No adapter for game "${action.game}"` };
      return game.configStore.write({ [action.setting]: action.to } as Record<string, JsonValue>);
    }
    case "process_priority":
      return drivers.processes.setPriority(action.pid, action.to);
    case "power_state":
      return drivers.power.set(action.to);
    case "close_process":
      return drivers.processes.terminateProcess(action.pid, action.processName);
  }
}

export async function applyPlan(
  plan: Plan,
  drivers: Drivers,
  adapter: GameAdapter | null,
  journal: Journal
): Promise<JournalBatch> {
  const batch: JournalBatch = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    targetApp: plan.targetApp,
    createdAt: new Date().toISOString(),
    entries: [],
  };

  // Back up the game config once before the first game_setting write.
  if (adapter && plan.actions.some((a) => a.action.kind === "game_setting")) {
    const backup = await adapter.configStore.backup();
    console.log(`  ${backup.message}`);
  }

  for (const { action } of plan.actions) {
    const result = await execute(action, drivers, adapter);
    const entry: JournalEntry = {
      timestamp: new Date().toISOString(),
      action,
      inverse: result.ok ? invert(action) : null, // no inverse for failed actions
      result,
    };
    batch.entries.push(entry);
    console.log(`  ${result.ok ? "✓" : "✗"} ${result.message}`);
  }

  journal.addBatch(batch);
  return batch;
}

export async function revertBatch(
  batch: JournalBatch,
  drivers: Drivers,
  journal: Journal
): Promise<void> {
  const adapter = getAdapter(batch.targetApp);
  // Replay inverses in reverse order of application.
  for (const entry of [...batch.entries].reverse()) {
    if (!entry.inverse) {
      if (entry.action.kind === "close_process" && entry.result.ok) {
        console.log(
          `  (i) ${entry.action.processName} was closed and cannot be reopened automatically`
        );
      }
      continue;
    }
    const result = await execute(entry.inverse, drivers, adapter);
    console.log(`  ${result.ok ? "✓" : "✗"} revert: ${result.message}`);
  }
  journal.removeBatch(batch.id);
}

export async function revertAll(drivers: Drivers, journal: Journal): Promise<void> {
  const batches = journal.activeBatches();
  if (batches.length === 0) {
    console.log("  Nothing to revert — journal is empty.");
    return;
  }
  for (const batch of batches) {
    console.log(`  Reverting batch ${batch.id} (${batch.targetApp}):`);
    await revertBatch(batch, drivers, journal);
  }
}
