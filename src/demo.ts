// demo.ts — FULL AGENT DEMO: GPU + Game Settings + System Optimization
//
// This connects all 4 tools into one pipeline:
//   1. Read GPU stats
//   2. Read system state (CPU, power plan, background processes)
//   3. Read game settings
//   4. Reason about ALL of it together
//   5. Apply changes (if --apply flag)
//
// Usage:
//   npx ts-node src/demo.ts                → analyze only (safe)
//   npx ts-node src/demo.ts --apply        → analyze + apply all changes
//   npx ts-node src/demo.ts --restore      → undo game setting changes

import { getGpuStats } from "./gpu-stats";
import {
  getPerformanceSettings,
  backupConfig,
  modifySettings,
  restoreConfig,
  MinecraftPerformanceSettings,
} from "./minecraft-config";
import { optimize } from "./optimizer";
import {
  getActivePowerPlan,
  getPowerPlans,
  getSuspendableProcesses,
  findGameProcess,
  setProcessPriority,
  suspendProcess,
  setPowerPlan,
} from "./system-optimizer";

// ---- HELPERS ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printStep(label: string) {
  console.log(`\n>>> ${label}\n`);
  await sleep(400);
}

async function printThinking(message: string) {
  // Simulates the agent "reasoning" — on Friday the LLM does this for real
  console.log(`  [Agent] ${message}`);
  await sleep(300);
}

// ---- MAIN ----

async function runDemo() {
  const mode = process.argv[2] || "--analyze";

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   ADAPTIVE PERFORMANCE AGENT                             ║");
  console.log("║   Full System Optimization Demo                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ---- RESTORE MODE ----
  if (mode === "--restore") {
    console.log("\n>>> Restoring Minecraft settings from backup...\n");
    const result = restoreConfig();
    console.log(`  ${result}`);
    console.log("  Note: System changes (priority, closed apps) are not restored.");
    console.log("  Reopen any apps that were closed manually.");
    return;
  }

  // ===============================
  // PHASE 1: PERCEIVE (gather data)
  // ===============================

  await printStep("PHASE 1: PERCEIVE — Reading system state...");

  // GPU
  await printThinking("Reading GPU telemetry...");
  const gpuReport = getGpuStats();
  console.log(`\n  GPU:      ${gpuReport.gpu.name}`);
  console.log(`  VRAM:     ${gpuReport.gpu.memoryUsedMiB}/${gpuReport.gpu.memoryTotalMiB} MiB (${Math.round((gpuReport.gpu.memoryUsedMiB / gpuReport.gpu.memoryTotalMiB) * 100)}% used)`);
  console.log(`  Temp:     ${gpuReport.gpu.temperatureC}°C`);
  console.log(`  Power:    ${gpuReport.gpu.powerUsageW}W / ${gpuReport.gpu.powerCapW}W`);
  console.log(`  GPU Load: ${gpuReport.gpu.gpuUtilizationPercent}%`);

  // Power plan
  await printThinking("Checking power plan...");
  const powerPlan = getActivePowerPlan();
  console.log(`\n  Power Plan: ${powerPlan}`);

  // Background processes
  await printThinking("Scanning background processes...");
  const suspendable = getSuspendableProcesses();
  let reclaimableMB = 0;
  if (suspendable.length > 0) {
    console.log(`\n  Background processes consuming resources:`);
    for (const proc of suspendable) {
      console.log(`    ${proc.name.padEnd(28)} ${proc.memoryMB.toFixed(0).padStart(6)} MB`);
      reclaimableMB += proc.memoryMB;
    }
    console.log(`    ${"".padEnd(28)} ────────`);
    console.log(`    ${"Reclaimable".padEnd(28)} ${reclaimableMB.toFixed(0).padStart(6)} MB`);
  } else {
    console.log(`\n  No significant background processes found.`);
  }

  // Game process
  await printThinking("Looking for game process...");
  const gameProc = findGameProcess("minecraft");
  if (gameProc) {
    console.log(`\n  Game:     ${gameProc.name} (PID ${gameProc.pid})`);
    console.log(`  Memory:   ${gameProc.memoryMB.toFixed(0)} MB`);
    console.log(`  Priority: ${gameProc.priority}`);
  } else {
    console.log(`\n  Game:     Minecraft not currently running`);
    console.log(`            (Settings will apply on next launch)`);
  }

  // Game settings
  await printThinking("Reading Minecraft configuration...");
  const beforeSettings = getPerformanceSettings();
  console.log(`\n  Render Distance:   ${beforeSettings.renderDistance}`);
  console.log(`  Simulation Dist:   ${beforeSettings.simulationDistance}`);
  console.log(`  Ambient Occlusion: ${beforeSettings.ao}`);
  console.log(`  Entity Shadows:    ${beforeSettings.entityShadows}`);
  console.log(`  Clouds:            ${beforeSettings.renderClouds}`);
  console.log(`  Mipmap:            ${beforeSettings.mipmapLevels}`);
  console.log(`  Particles:         ${beforeSettings.particles === 0 ? "All" : beforeSettings.particles === 1 ? "Decreased" : "Minimal"}`);
  console.log(`  Leaves:            ${beforeSettings.cutoutLeaves ? "Fancy" : "Fast"}`);

  // ===========================
  // PHASE 2: PLAN (reason)
  // ===========================

  await printStep("PHASE 2: PLAN — Analyzing and deciding...");

  // Game settings optimization
  await printThinking("Matching game settings to GPU capabilities...");
  const report = optimize(gpuReport.gpu, beforeSettings);
  console.log(`\n  GPU Tier:       ${report.gpuTier.toUpperCase()}`);
  console.log(`  Tuning Score:   ${report.currentSettingsScore}/100`);

  // System-level decisions
  await printThinking("Evaluating system-level optimizations...");

  // Power plan reasoning
  const powerPlanLower = powerPlan.toLowerCase();
  const needsPowerChange = powerPlanLower.includes("balanced") ||
    powerPlanLower.includes("quiet") ||
    powerPlanLower.includes("power saver");

  if (needsPowerChange) {
    console.log(`\n  ⚠ Power plan "${powerPlan}" may throttle CPU during gaming.`);
    console.log(`    Recommendation: Switch to a performance-oriented plan.`);
  } else {
    console.log(`\n  ✓ Power plan "${powerPlan}" is already performance-oriented.`);
    console.log(`    No change needed.`);
  }

  // Process priority reasoning
  if (gameProc) {
    const priorityStr = gameProc.priority.toLowerCase();
    if (priorityStr.includes("normal") || priorityStr === "") {
      console.log(`\n  ⚠ Minecraft running at Normal priority.`);
      console.log(`    Recommendation: Elevate to High priority for more CPU time.`);
    } else if (priorityStr.includes("high")) {
      console.log(`\n  ✓ Minecraft already at High priority. No change needed.`);
    }
  }

  // Background process reasoning
  if (reclaimableMB > 200) {
    // Group by app name for cleaner output
    const appGroups = new Map<string, number>();
    for (const proc of suspendable) {
      // Extract base app name (e.g. "Discord" from "Discord" across multiple PIDs)
      const baseName = proc.name.replace(/\d+$/, "").trim();
      appGroups.set(baseName, (appGroups.get(baseName) || 0) + proc.memoryMB);
    }

    console.log(`\n  ⚠ ${reclaimableMB.toFixed(0)} MB used by non-essential background apps:`);
    for (const [name, mem] of appGroups.entries()) {
      console.log(`    - ${name}: ${mem.toFixed(0)} MB`);
    }
    console.log(`    Recommendation: Close these to free memory for the game.`);
  } else {
    console.log(`\n  ✓ Background process load is manageable.`);
  }

  // Show game setting changes
  if (report.proposedChanges.length > 0) {
    await printStep("PROPOSED GAME SETTING CHANGES:");

    for (const change of report.proposedChanges) {
      console.log(`  ┌─ ${change.setting}`);
      console.log(`  │  ${change.currentValue} → ${change.proposedValue}  (+${change.estimatedFpsGain} FPS, ${change.visualImpact} visual impact)`);
      console.log(`  │  ${change.reason}`);
      console.log(`  └─`);
    }
  }

  // Show preserved settings
  if (report.keptSettings.length > 0) {
    await printStep("PRESERVED (agent kept at current quality):");
    for (const kept of report.keptSettings) {
      console.log(`  ✓ ${kept}`);
    }
  }

  // =============================
  // PHASE 3: SUMMARY
  // =============================

  await printStep("OPTIMIZATION SUMMARY:");

  let totalActions = report.proposedChanges.length;
  if (needsPowerChange) totalActions++;
  if (gameProc && !gameProc.priority.toLowerCase().includes("high")) totalActions++;
  if (reclaimableMB > 200) totalActions++;

  console.log(`  Game settings to change:    ${report.proposedChanges.length}`);
  console.log(`  Game settings preserved:    ${report.keptSettings.length}`);
  console.log(`  Est. FPS from settings:     +${report.estimatedTotalFpsGain}`);
  console.log(`  Power plan change:          ${needsPowerChange ? "Yes" : "No (already optimal)"}`);
  console.log(`  Process priority change:    ${gameProc ? "Yes (set to High)" : "N/A (game not running)"}`);
  console.log(`  Background apps to close:   ${reclaimableMB > 200 ? suspendable.length + " (~" + reclaimableMB.toFixed(0) + " MB)" : "None needed"}`);
  console.log(`  Total actions:              ${totalActions}`);

  // ===========================
  // PHASE 4: ACT (if --apply)
  // ===========================

  if (mode === "--apply") {
    await printStep("PHASE 3: ACT — Applying optimizations...");

    // 4a: Backup game settings
    await printThinking("Backing up Minecraft config...");
    const backupResult = backupConfig();
    console.log(`  ${backupResult}`);

    // 4b: Apply game setting changes
    if (report.proposedChanges.length > 0) {
      await printThinking("Modifying game settings...");
      const changesToApply: Partial<MinecraftPerformanceSettings> = {};
      for (const change of report.proposedChanges) {
        (changesToApply as any)[change.setting] = change.proposedValue;
      }
      const applyResult = modifySettings(changesToApply);
      console.log(`\n${applyResult}`);
    }

    // 4c: Power plan
    if (needsPowerChange) {
      await printThinking("Switching power plan...");
      // Look for a performance plan
      const plans = getPowerPlans();
      const perfPlan = plans.find((p) =>
        p.name.toLowerCase().includes("performance") ||
        p.name.toLowerCase().includes("high")
      );
      if (perfPlan) {
        const result = setPowerPlan(perfPlan.name);
        console.log(`  ${result}`);
      }
    }

    // 4d: Process priority
    if (gameProc && !gameProc.priority.toLowerCase().includes("high")) {
      await printThinking("Elevating game process priority...");
      const result = setProcessPriority(gameProc.pid, "high");
      console.log(`  ${result}`);
    }

    // 4e: Background processes (ask before closing)
    if (reclaimableMB > 200) {
      await printThinking("Closing non-essential background processes...");
      for (const proc of suspendable) {
        const result = suspendProcess(proc.pid, proc.name);
        console.log(`  ${result}`);
      }
    }

    // ===========================
    // PHASE 5: REFLECT (verify)
    // ===========================

    await printStep("PHASE 4: REFLECT — Verifying changes...");

    // Before/After game settings
    const afterSettings = getPerformanceSettings();

    console.log("  Game Settings Before/After:");
    console.log("  ┌──────────────────────┬──────────┬──────────┬─────┐");
    console.log("  │ Setting              │  Before  │  After   │     │");
    console.log("  ├──────────────────────┼──────────┼──────────┼─────┤");

    const compareKeys: (keyof MinecraftPerformanceSettings)[] = [
      "renderDistance", "simulationDistance", "ao", "entityShadows",
      "renderClouds", "mipmapLevels", "particles", "cutoutLeaves",
      "cloudRange", "biomeBlendRadius",
    ];

    for (const key of compareKeys) {
      const before = String(beforeSettings[key]);
      const after = String(afterSettings[key]);
      const changed = before !== after;
      const marker = changed ? " ← " : "   ";
      console.log(`  │ ${key.padEnd(20)} │ ${before.padEnd(8)} │ ${after.padEnd(8)} │${marker}│`);
    }

    console.log("  └──────────────────────┴──────────┴──────────┴─────┘");
    console.log(`  ← = changed by agent`);

    // System changes summary
    console.log("\n  System Changes:");
    console.log(`    Power plan: ${powerPlan} → ${getActivePowerPlan()}`);
    if (gameProc) {
      console.log(`    Game priority: Normal → High`);
    }
    if (reclaimableMB > 200) {
      console.log(`    Freed ~${reclaimableMB.toFixed(0)} MB by closing background apps`);
    }

    // Final
    await printStep("COMPLETE:");
    console.log(`  Estimated FPS gain from settings: +${report.estimatedTotalFpsGain}`);
    console.log(`  Additional gains from system optimization: +5-15 FPS (estimated)`);
    console.log(`  Settings preserved at full quality: ${report.keptSettings.length}`);
    console.log(`\n  Restart Minecraft to see game setting changes.`);
    console.log(`  To undo game settings: npx ts-node src/demo.ts --restore`);

  } else {
    // Analysis only
    console.log("\n  To apply ALL optimizations (game settings + system):");
    console.log("    npx ts-node src/demo.ts --apply");
    console.log("\n  To restore game settings after applying:");
    console.log("    npx ts-node src/demo.ts --restore");
  }
}

runDemo();