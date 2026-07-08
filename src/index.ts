// index.ts — NVPilot entry point. The only file with top-level execution.

import { perceive, reflect } from "./core/agent";
import { applyPlan } from "./core/executor";
import { OLLAMA_MODEL } from "./core/config";
import { runDaemon } from "./core/daemon";
import { revertAll } from "./core/executor";
import { Journal } from "./core/journal";
import { Plan, SystemSnapshot } from "./core/types";
import { createDrivers } from "./drivers";
import { GAME_ADAPTERS } from "./games/registry";
import { OllamaPlanner } from "./planners/ollama-planner";
import { Planner } from "./planners/planner";
import { RulePlanner } from "./planners/rule-planner";
import { HELP_TEXT, parseArgs } from "./cli";
import { TOOL_DEFINITIONS } from "./tools/definitions";

function banner(): void {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   NVPilot — Adaptive Performance Agent                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
}

function printSnapshot(s: SystemSnapshot): void {
  console.log("\n>>> PERCEIVE — system state\n");
  if (s.gpu) {
    const memPct = Math.round((s.gpu.memoryUsedMiB / s.gpu.memoryTotalMiB) * 100);
    console.log(`  GPU:      ${s.gpu.name} (driver ${s.gpu.driverVersion})`);
    console.log(`  VRAM:     ${s.gpu.memoryUsedMiB}/${s.gpu.memoryTotalMiB} MiB (${memPct}% used)`);
    console.log(`  Temp:     ${s.gpu.temperatureC}°C   Power: ${s.gpu.powerUsageW}W / ${s.gpu.powerCapW}W   Load: ${s.gpu.gpuUtilizationPercent}%`);
  } else {
    console.log("  GPU:      no NVIDIA telemetry available (nvidia-smi missing or failed)");
  }
  console.log(`  Tier:     ${s.gpuTier.toUpperCase()}`);

  if (s.power.current) {
    console.log(`  Power:    ${s.power.current.name} (control: ${s.power.capability})`);
  } else {
    console.log(`  Power:    unavailable (control: ${s.power.capability})`);
  }

  if (s.gameProcess) {
    console.log(`  Game:     ${s.gameProcess.name} (PID ${s.gameProcess.pid}, ${s.gameProcess.memoryMB.toFixed(0)} MB, priority ${s.gameProcess.priority})`);
  } else if (s.targetApp !== "generic") {
    console.log(`  Game:     ${s.targetApp} not currently running (settings apply on next launch)`);
  }

  if (s.gameSettings) {
    console.log(`  Config:   ${Object.entries(s.gameSettings).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  if (s.suspendable.length > 0) {
    const total = s.suspendable.reduce((sum, p) => sum + p.memoryMB, 0);
    console.log(`  Background apps on safe-to-close list: ${s.suspendable.length} (~${total.toFixed(0)} MB)`);
    for (const p of s.suspendable) {
      console.log(`    - ${p.name.padEnd(28)} ${p.memoryMB.toFixed(0).padStart(6)} MB`);
    }
  }
}

function printPlan(plan: Plan): void {
  console.log(`\n>>> PLAN — decided by ${plan.source === "llm" ? `LLM (${OLLAMA_MODEL})` : "rule engine"}\n`);
  console.log(`  ${plan.summary}\n`);

  if (plan.actions.length > 0) {
    console.log("  Proposed changes:");
    for (const { action, reason, visualImpact } of plan.actions) {
      let head = "";
      switch (action.kind) {
        case "game_setting":
          head = `${action.setting}: ${action.from} → ${action.to}  (${visualImpact} visual impact)`;
          break;
        case "process_priority":
          head = `priority of ${action.processName} (PID ${action.pid}): ${action.from} → ${action.to}`;
          break;
        case "power_state":
          head = `power state: ${action.from} → ${action.to}`;
          break;
        case "close_process":
          head = `close ${action.processName} (PID ${action.pid}, ${action.memoryMB.toFixed(0)} MB) [not auto-reversible]`;
          break;
      }
      console.log(`  ┌─ ${head}`);
      console.log(`  └─ ${reason}`);
    }
  }

  if (plan.keptSettings.length > 0) {
    console.log("\n  Preserved (kept at current quality):");
    for (const kept of plan.keptSettings) console.log(`  ✓ ${kept}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.mode === "help") {
    console.log(HELP_TEXT);
    return;
  }

  if (opts.mode === "tools-json") {
    console.log(JSON.stringify(TOOL_DEFINITIONS, null, 2));
    return;
  }

  banner();
  const drivers = createDrivers();
  const journal = new Journal();
  const planner: Planner = opts.noLlm ? new RulePlanner() : new OllamaPlanner();

  switch (opts.mode) {
    case "restore": {
      console.log("\n>>> Restoring from journal...\n");
      await revertAll(drivers, journal);
      // Belt and braces: also restore game config backups if present.
      for (const g of GAME_ADAPTERS) {
        const result = await g.configStore.restore();
        if (result.ok) console.log(`  ✓ ${g.displayName}: ${result.message}`);
      }
      return;
    }

    case "analyze":
    case "apply": {
      // One-shot mode targets the first game whose config exists (Minecraft
      // today); daemon mode targets whatever app is actually in focus.
      let adapter = null;
      for (const g of GAME_ADAPTERS) {
        if (await g.configStore.exists()) { adapter = g; break; }
      }

      const apply = opts.mode === "apply";
      if (apply) console.log("\n  Mode: APPLY — changes will be made (journaled, reversible)");

      const snapshot = await perceive(drivers, adapter);
      const plan = await planner.createPlan(snapshot, adapter, opts);
      printSnapshot(snapshot);
      printPlan(plan);

      if (apply && plan.actions.length > 0) {
        console.log("\n>>> ACT — applying changes\n");
        const batch = await applyPlan(plan, drivers, adapter, journal);
        console.log("\n>>> REFLECT — verifying\n");
        await reflect(plan, drivers, adapter);
        console.log(`\n>>> Applied ${batch.entries.length} change(s).`);
        if (plan.actions.some((a) => a.action.kind === "game_setting") && adapter) {
          console.log(`  Restart ${adapter.displayName} to pick up config changes.`);
        }
        console.log("  Undo everything: npx ts-node src/index.ts --restore");
      } else if (apply) {
        console.log("\n>>> Nothing to apply — already well-tuned.");
      } else {
        console.log("\n  Apply these changes:   npx ts-node src/index.ts --apply");
        console.log("  Watch in real time:    npx ts-node src/index.ts --watch");
      }
      return;
    }

    case "watch": {
      console.log(`\n  Planner: ${opts.noLlm ? "rule engine" : `Ollama (${OLLAMA_MODEL}) with rule fallback`}`);
      console.log(`  Close background apps: ${opts.allowClose ? "ENABLED (--allow-close)" : "disabled"}`);
      await runDaemon(drivers, planner, opts, journal);
      return;
    }
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
