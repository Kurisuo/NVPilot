// tools/dispatch.ts — single execution entry point for external agent
// runtimes (NemoClaw/OpenClaw). Every mutating tool goes through the same
// validation and journal as the built-in planners, so externally-driven
// changes are just as constrained and just as reversible.

import { perceive } from "../core/agent";
import { NEVER_TOUCH } from "../core/config";
import { applyPlan, revertAll } from "../core/executor";
import { Journal } from "../core/journal";
import { JsonValue, Plan, PlannedAction } from "../core/types";
import { Drivers } from "../drivers/interfaces";
import { getAdapter } from "../games/registry";
import { sanitizePlannedActions } from "../planners/planner";

export interface DispatchContext {
  drivers: Drivers;
  journal: Journal;
  allowClose: boolean;
}

/** Wrap validated actions in a minimal Plan so the executor/journal path is shared. */
function asPlan(targetApp: string, actions: PlannedAction[]): Plan {
  return {
    source: "llm",
    targetApp,
    gpuTier: "mid", // not meaningful for direct tool calls
    actions,
    keptSettings: [],
    summary: `external tool call: ${actions.length} action(s)`,
  };
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: DispatchContext
): Promise<unknown> {
  const { drivers, journal } = ctx;

  switch (name) {
    case "get_gpu_stats":
      return drivers.telemetry.getGpuStats();

    case "get_system_state": {
      const adapter = typeof args.game === "string" ? getAdapter(args.game) : null;
      return perceive(drivers, adapter);
    }

    case "read_game_config": {
      const adapter = getAdapter(String(args.game));
      if (!adapter) return { error: `Unknown game: ${String(args.game)}` };
      if (!(await adapter.configStore.exists())) return { error: "Game config not found" };
      return adapter.configStore.read();
    }

    case "write_game_config": {
      const adapter = getAdapter(String(args.game));
      if (!adapter) return { error: `Unknown game: ${String(args.game)}` };
      const snapshot = await perceive(drivers, adapter);
      if (!snapshot.gameSettings) return { error: "Game config not found" };

      const changes = (args.changes || {}) as Record<string, JsonValue>;
      const candidates = Object.entries(changes).map(([setting, to]) => ({
        action: { kind: "game_setting", setting, from: snapshot.gameSettings![setting], to },
        reason: "external tool call",
      }));
      const { actions, errors } = sanitizePlannedActions(
        candidates, snapshot, adapter, { allowClose: false }
      );
      if (actions.length === 0) return { error: `No valid changes. ${errors.join("; ")}` };
      const batch = await applyPlan(asPlan(adapter.id, actions), drivers, adapter, journal);
      return { applied: batch.entries.map((e) => e.result), rejected: errors };
    }

    case "set_process_priority": {
      const pid = Number(args.pid);
      const level = args.level === "above_normal" ? "above_normal" : "high";
      if (!Number.isInteger(pid)) return { error: "pid must be an integer" };
      const procs = await drivers.processes.listProcesses();
      const proc = procs.find((p) => p.pid === pid);
      if (!proc) return { error: `PID ${pid} not found` };
      const lower = proc.name.toLowerCase();
      if (NEVER_TOUCH.some((nt) => lower.includes(nt))) {
        return { error: `REFUSED: ${proc.name} is a protected process` };
      }
      const planned: PlannedAction = {
        action: { kind: "process_priority", pid, processName: proc.name, from: proc.priority, to: level },
        reason: "external tool call",
        visualImpact: "none",
      };
      const batch = await applyPlan(asPlan("generic", [planned]), drivers, null, journal);
      return batch.entries[0].result;
    }

    case "set_power_state": {
      const id = String(args.id);
      const [current, available] = await Promise.all([
        drivers.power.getCurrent(),
        drivers.power.listAvailable(),
      ]);
      if (!current) return { error: "Power control unavailable" };
      const target = available.find((p) => p.id === id || p.name === id);
      if (!target) return { error: `Unknown power state: ${id}` };
      const planned: PlannedAction = {
        action: { kind: "power_state", from: current.id, to: target.id },
        reason: "external tool call",
        visualImpact: "none",
      };
      const batch = await applyPlan(asPlan("generic", [planned]), drivers, null, journal);
      return batch.entries[0].result;
    }

    case "close_background_process": {
      if (!ctx.allowClose) return { error: "close_background_process requires --allow-close" };
      const pid = Number(args.pid);
      const snapshot = await perceive(drivers, null);
      const candidate = snapshot.suspendable.find((p) => p.pid === pid);
      if (!candidate) return { error: `PID ${pid} is not on the safe-to-close list` };
      const planned: PlannedAction = {
        action: { kind: "close_process", pid, processName: candidate.name, memoryMB: candidate.memoryMB },
        reason: "external tool call",
        visualImpact: "none",
      };
      const batch = await applyPlan(asPlan("generic", [planned]), drivers, null, journal);
      return batch.entries[0].result;
    }

    case "restore_all":
      await revertAll(drivers, journal);
      return { ok: true, message: "All journaled changes reverted" };

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
