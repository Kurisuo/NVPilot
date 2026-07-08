// core/daemon.ts — the real-time agent loop (--watch).
//
//   poll foreground app → debounce → on settled change:
//     revert the previous app's journal batch, then if the new app is a
//     known game (or a game process is running, on process-poll platforms)
//     run a full perceive → plan → act → reflect cycle.
//   every REEVALUATE_MS while a plan is active: re-perceive and re-plan if
//     state drifted materially.
//
// Ctrl+C reverts everything before exiting. The journal is persisted after
// every apply, so even a hard kill leaves --restore able to clean up.

import { Drivers } from "../drivers/interfaces";
import { GameAdapter } from "../games/adapter";
import { GAME_ADAPTERS, resolveGame } from "../games/registry";
import { Planner, PlanOptions } from "../planners/planner";
import { DEBOUNCE_MS, REEVALUATE_MS } from "./config";
import { revertAll } from "./executor";
import { Journal } from "./journal";
import { runCycle } from "./agent";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Processes that are never optimization targets (our own shells etc.)
const IGNORED_FOREGROUND = [
  "node", "powershell", "cmd", "windowsterminal", "wt", "conhost", "bash",
];

export async function runDaemon(
  drivers: Drivers,
  planner: Planner,
  opts: PlanOptions & { intervalMs: number },
  journal: Journal
): Promise<void> {
  const capability = await drivers.foreground.capabilities();
  console.log(`  Foreground detection: ${capability}`);
  if (capability === "process-poll") {
    console.log("  (No active-window API here — scanning for known game processes instead.)");
  }

  let running = true;
  let busy = false;

  const shutdown = async () => {
    if (!running) return;
    running = false;
    console.log("\n>>> Shutting down — reverting applied changes...");
    // Journal inverses restore game settings, priority, and power state.
    await revertAll(drivers, journal);
    console.log("  Done. Goodbye.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let currentTarget: string | null = null;   // adapter id or null (idle)
  let appliedFor: string | null = null;      // adapter id we applied a plan for
  let candidateSince: number | null = null;  // debounce timer
  let candidateTarget: string | null = null;
  let lastReevaluate = 0;

  console.log(`  Watching (poll ${opts.intervalMs}ms, debounce ${DEBOUNCE_MS}ms). Ctrl+C to stop and revert.\n`);

  while (running) {
    if (busy) { await sleep(opts.intervalMs); continue; }

    // ---- Detect the current target ----
    let detected: GameAdapter | null = null;
    if (capability === "window") {
      const fg = await drivers.foreground.getForegroundApp();
      if (fg && !IGNORED_FOREGROUND.includes(fg.processName.toLowerCase())) {
        detected = resolveGame(fg.processName);
      }
    } else if (capability === "process-poll") {
      // No focus info: any running known game counts as the target.
      for (const g of GAME_ADAPTERS) {
        if (await drivers.processes.findProcess(g.processNames)) { detected = g; break; }
      }
    }
    const target = detected ? detected.id : null;

    // ---- Debounce app changes (alt-tab churn) ----
    if (target !== candidateTarget) {
      candidateTarget = target;
      candidateSince = Date.now();
    }
    const settled =
      candidateSince !== null && Date.now() - candidateSince >= DEBOUNCE_MS;

    if (settled && candidateTarget !== currentTarget) {
      busy = true;
      try {
        // Leaving an optimized app: revert its changes.
        if (appliedFor && journal.hasActiveChanges()) {
          console.log(`\n>>> ${appliedFor} no longer active — reverting its optimizations...`);
          await revertAll(drivers, journal);
          appliedFor = null;
        }

        currentTarget = candidateTarget;

        if (detected) {
          console.log(`\n>>> Detected ${detected.displayName} — running optimization cycle (${new Date().toLocaleTimeString()})`);
          const { plan, batch } = await runCycle(drivers, planner, detected, opts, journal, true);
          console.log(`  [${plan.source}] ${plan.summary}`);
          if (batch) {
            appliedFor = detected.id;
            const touchedGameConfig = plan.actions.some((a) => a.action.kind === "game_setting");
            if (touchedGameConfig) {
              console.log(`  Note: ${detected.displayName} reads its config at launch — restart it to pick up setting changes.`);
            }
          } else {
            console.log("  Nothing to change — already well-tuned.");
          }
          lastReevaluate = Date.now();
        }
      } finally {
        busy = false;
      }
    }

    // ---- Periodic re-evaluation while a plan is active ----
    if (appliedFor && detected && Date.now() - lastReevaluate >= REEVALUATE_MS) {
      lastReevaluate = Date.now();
      busy = true;
      try {
        const gpu = await drivers.telemetry.getGpuStats();
        if (gpu && gpu.temperatureC >= 90) {
          console.log(`\n>>> GPU at ${gpu.temperatureC}°C — re-planning for thermal headroom...`);
          const { plan, batch } = await runCycle(drivers, planner, detected, opts, journal, true);
          console.log(`  [${plan.source}] ${plan.summary}`);
          if (batch) lastReevaluate = Date.now();
        }
      } finally {
        busy = false;
      }
    }

    await sleep(opts.intervalMs);
  }
}
