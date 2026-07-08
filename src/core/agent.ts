// core/agent.ts — one explicit perceive → plan → act → reflect cycle.
//
// Each phase is pure-data-in / pure-data-out where possible: perceive
// produces a SystemSnapshot, plan produces a Plan, act produces a journal
// batch, reflect re-reads state and reports intended-vs-actual.

import { Drivers } from "../drivers/interfaces";
import { GameAdapter } from "../games/adapter";
import { Planner, PlanOptions } from "../planners/planner";
import {
  classifyGpuTier,
  NEVER_TOUCH,
  SAFE_TO_SUSPEND,
  SUSPENDABLE_MIN_MB,
} from "./config";
import { applyPlan } from "./executor";
import { Journal } from "./journal";
import { JournalBatch, Plan, ProcessInfo, SystemSnapshot } from "./types";

// ---- PERCEIVE ----

export async function perceive(
  drivers: Drivers,
  adapter: GameAdapter | null
): Promise<SystemSnapshot> {
  const gpu = await drivers.telemetry.getGpuStats();

  const [capability, current, available, processes] = await Promise.all([
    drivers.power.capabilities(),
    drivers.power.getCurrent(),
    drivers.power.listAvailable(),
    drivers.processes.listProcesses(),
  ]);

  const suspendable = processes.filter((p) => {
    const name = p.name.toLowerCase();
    if (NEVER_TOUCH.some((nt) => name.includes(nt))) return false;
    return (
      SAFE_TO_SUSPEND.some((safe) => name.includes(safe)) &&
      p.memoryMB > SUSPENDABLE_MIN_MB
    );
  });

  let gameProcess: ProcessInfo | null = null;
  let gameSettings: SystemSnapshot["gameSettings"] = null;
  if (adapter) {
    gameProcess = findIn(processes, adapter.processNames);
    if (await adapter.configStore.exists()) {
      gameSettings = await adapter.configStore.read();
    }
  }

  return {
    timestamp: new Date().toISOString(),
    gpu,
    gpuTier: classifyGpuTier(gpu),
    power: { capability, current, available },
    suspendable,
    gameProcess,
    targetApp: adapter ? adapter.id : "generic",
    gameSettings,
  };
}

function findIn(processes: ProcessInfo[], terms: string[]): ProcessInfo | null {
  const lower = terms.map((t) => t.toLowerCase());
  return (
    processes.find((p) => lower.some((t) => p.name.toLowerCase().includes(t))) || null
  );
}

// ---- FULL CYCLE ----

export interface CycleResult {
  snapshot: SystemSnapshot;
  plan: Plan;
  batch: JournalBatch | null; // null when analyzing only
}

export async function runCycle(
  drivers: Drivers,
  planner: Planner,
  adapter: GameAdapter | null,
  opts: PlanOptions,
  journal: Journal,
  apply: boolean
): Promise<CycleResult> {
  const snapshot = await perceive(drivers, adapter);
  const plan = await planner.createPlan(snapshot, adapter, opts);

  if (!apply || plan.actions.length === 0) {
    return { snapshot, plan, batch: null };
  }

  const batch = await applyPlan(plan, drivers, adapter, journal);
  await reflect(plan, drivers, adapter);

  return { snapshot, plan, batch };
}

// ---- REFLECT: verify intended vs actual ----

export async function reflect(
  plan: Plan,
  drivers: Drivers,
  adapter: GameAdapter | null
): Promise<void> {
  const after = await perceive(drivers, adapter);
  for (const { action } of plan.actions) {
    switch (action.kind) {
      case "game_setting": {
        const actual = after.gameSettings?.[action.setting];
        const okMark = actual === action.to ? "✓" : "✗";
        console.log(`  ${okMark} verify ${action.setting}: ${action.from} → ${actual}`);
        break;
      }
      case "power_state": {
        const actual = after.power.current?.id;
        console.log(`  ${actual === action.to ? "✓" : "✗"} verify power state: ${after.power.current?.name}`);
        break;
      }
      case "process_priority": {
        const pri = await drivers.processes.getPriority(action.pid);
        console.log(`  ${pri ? "✓" : "✗"} verify priority of PID ${action.pid}: ${pri ?? "process gone"}`);
        break;
      }
      case "close_process": {
        const still = after.suspendable.find((p) => p.pid === action.pid);
        console.log(`  ${still ? "✗" : "✓"} verify ${action.processName} closed`);
        break;
      }
    }
  }
}
