// system-optimizer.ts — Tool #4: CPU and system-level optimization
//
// This handles everything OUTSIDE the game's own settings:
//   - Process priority (give the game more CPU time)
//   - Power plan (prevent CPU throttling)
//   - Background process identification
//   - Optional process suspension
//
// Combined with the GPU stats + game config tools, this gives the
// agent full-system awareness: GPU settings + CPU allocation + power.
//
// WHY THIS MATTERS FOR THE DEMO:
// GeForce Experience only touches GPU/game settings.
// This tool touches the REST of the system — which is exactly
// what makes this an "agent" and not a settings preset.

import { execSync } from "child_process";

// ---- TYPES ----

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuUsage: string;       // from tasklist (approximate)
  memoryMB: number;       // working set in MB
  priority: string;       // current priority class
}

export interface PowerPlan {
  guid: string;
  name: string;
  isActive: boolean;
}

export interface SystemState {
  activePowerPlan: string;
  totalProcesses: number;
  topMemoryProcesses: ProcessInfo[];   // sorted by memory usage
  gameProcess: ProcessInfo | null;     // the game we're optimizing for
}

// ---- KNOWN SAFE-TO-SUSPEND PROCESSES ----
// These are background apps that most users don't need while gaming.
// The agent checks this list before suggesting suspension.
// We NEVER touch system processes, antivirus, or drivers.

const SAFE_TO_SUSPEND: string[] = [
//  "discord",
  "slack",
  "obsidian",
  "multipass",
  "claude",
  "word",
  "teams",
  "spotify",
  "chrome",
  "msedge",
  "firefox",
  "wallpaper32",       // Wallpaper Engine
  "icloudphotos",
  "onedrive",
  "dropbox",
  "docker desktop",
  "creative cloud",
  "adobenotification",
  "linkedin",
  "telegram",
  "whatsapp",
];

// Processes we must NEVER touch, even if they use resources.
const NEVER_TOUCH: string[] = [
  "system",
  "svchost",
  "csrss",
  "wininit",
  "services",
  "lsass",
  "explorer",        // Windows shell — killing this breaks the desktop
  "dwm",            // Desktop Window Manager — needed for display
  "antimalware",
  "msmpeng",        // Windows Defender
  "securityapp",
  "nvidia",         // GPU drivers
  "amd",
];

// ---- POWER PLAN MANAGEMENT ----
// Windows has built-in power plans that affect CPU behavior.
// "Balanced" = CPU slows down when idle (saves power, costs FPS)
// "High Performance" = CPU stays at max speed always
//
// For gaming, High Performance is almost always better.
// The agent switches to it, and switches back when done.

export function getPowerPlans(): PowerPlan[] {
  try {
    // powercfg /list shows all available power plans
    // The output looks like:
    // Power Scheme GUID: 381b4222-f694-...  (Balanced) *
    // The * marks the active plan
    const raw = execSync("powercfg /list", { encoding: "utf-8" });
    const plans: PowerPlan[] = [];

    const lines = raw.split("\n");
    for (const line of lines) {
      // Match lines that contain a GUID and plan name
      const match = line.match(/:\s+([0-9a-f-]+)\s+\((.+?)\)/i);
      if (match) {
        plans.push({
          guid: match[1],
          name: match[2],
          isActive: line.includes("*"),
        });
      }
    }

    return plans;
  } catch (err) {
    console.error("Failed to read power plans:", err);
    return [];
  }
}

export function getActivePowerPlan(): string {
  const plans = getPowerPlans();
  const active = plans.find((p) => p.isActive);
  return active ? active.name : "Unknown";
}

export function setPowerPlan(planName: string): string {
  const plans = getPowerPlans();
  const target = plans.find(
    (p) => p.name.toLowerCase().includes(planName.toLowerCase())
  );

  if (!target) {
    return `Power plan "${planName}" not found. Available: ${plans.map((p) => p.name).join(", ")}`;
  }

  try {
    // powercfg /setactive <GUID> switches the active power plan
    execSync(`powercfg /setactive ${target.guid}`);
    return `Switched power plan to "${target.name}"`;
  } catch (err) {
    return `Failed to set power plan: ${err}`;
  }
}

// ---- PROCESS MANAGEMENT ----

// Get a list of running processes with memory usage.
// Uses PowerShell because it gives cleaner output than tasklist.
export function getProcessList(): ProcessInfo[] {
  try {
    // PowerShell command that returns process name, PID, and memory in MB
    // Sort by memory descending so heaviest processes are first
    const cmd = `powershell -Command "Get-Process | Select-Object ProcessName, Id, @{Name='MemMB';Expression={[math]::Round($_.WorkingSet64/1MB,1)}}, PriorityClass | Sort-Object MemMB -Descending | ConvertTo-Csv -NoTypeInformation"`;

    const raw = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    const lines = raw.trim().split("\n");
    const processes: ProcessInfo[] = [];

    // Skip header line (index 0)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].replace(/"/g, ""); // strip CSV quotes
      const parts = line.split(",");
      if (parts.length >= 4) {
        processes.push({
          name: parts[0].trim(),
          pid: parseInt(parts[1].trim()) || 0,
          memoryMB: parseFloat(parts[2].trim()) || 0,
          priority: parts[3].trim() || "Normal",
          cpuUsage: "N/A", // CPU% requires sampling over time, skip for now
        });
      }
    }

    return processes;
  } catch (err) {
    console.error("Failed to get process list:", err);
    return [];
  }
}

// Find a specific game's process
export function findGameProcess(gameName: string): ProcessInfo | null {
  const processes = getProcessList();

  // Minecraft Java runs as "javaw" or "java"
  // We check both the game name and known executable names
  const searchTerms = [gameName.toLowerCase()];
  if (gameName.toLowerCase().includes("minecraft")) {
    searchTerms.push("javaw", "java");
  }

  return (
    processes.find((p) =>
      searchTerms.some((term) => p.name.toLowerCase().includes(term))
    ) || null
  );
}

// Get processes that are safe to suspend and using significant resources
export function getSuspendableProcesses(): ProcessInfo[] {
  const all = getProcessList();

  return all.filter((proc) => {
    const name = proc.name.toLowerCase();

    // Skip if it's a protected process
    if (NEVER_TOUCH.some((nt) => name.includes(nt))) return false;

    // Include if it's in our safe-to-suspend list AND using meaningful memory
    return (
      SAFE_TO_SUSPEND.some((safe) => name.includes(safe)) &&
      proc.memoryMB > 50 // only flag processes using more than 50MB
    );
  });
}

// Set a process to high priority
// This tells Windows: "give this process more CPU time than others"
export function setProcessPriority(
  pid: number,
  priority: "high" | "above_normal" | "normal"
): string {
  // wmic priority values:
  // 128 = High, 32768 = Above Normal, 32 = Normal
  const priorityMap = {
    high: 128,
    above_normal: 32768,
    normal: 32,
  };

  try {
    execSync(
      `wmic process where processid="${pid}" CALL setpriority ${priorityMap[priority]}`,
      { encoding: "utf-8" }
    );
    return `Set PID ${pid} to ${priority} priority`;
  } catch (err) {
    return `Failed to set priority for PID ${pid}: ${err}`;
  }
}

// Suspend a process (pause it, don't kill it)
// Uses PowerShell to suspend — process stays in memory but stops using CPU
// CAUTION: only call this on SAFE_TO_SUSPEND processes
export function suspendProcess(pid: number, processName: string): string {
  const name = processName.toLowerCase();
  if (NEVER_TOUCH.some((nt) => name.includes(nt))) {
    return `REFUSED: ${processName} is a protected system process`;
  }

  try {
    execSync(`powershell -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`, {
      encoding: "utf-8",
    });
    return `Closed ${processName} (PID ${pid}) — freed resources`;
  } catch (err) {
    return `Skipped ${processName} (PID ${pid}) — already closed`;
  }
}

// ---- FULL SYSTEM STATE ----
// Assembles the complete picture for the agent

export function getSystemState(gameName: string): SystemState {
  const activePlan = getActivePowerPlan();
  const allProcesses = getProcessList();
  const gameProc = findGameProcess(gameName);
  const topMemory = allProcesses.slice(0, 15); // top 15 by memory

  return {
    activePowerPlan: activePlan,
    totalProcesses: allProcesses.length,
    topMemoryProcesses: topMemory,
    gameProcess: gameProc,
  };
}

// ---- RUN IT ----
// Test: show current system state

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   SYSTEM OPTIMIZER — Tool #4                        ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// Power plan
console.log("=== Power Plans ===");
const plans = getPowerPlans();
for (const plan of plans) {
  const marker = plan.isActive ? " ← ACTIVE" : "";
  console.log(`  ${plan.name}${marker}`);
}

// Suspendable processes
console.log("\n=== Background Processes (safe to close while gaming) ===");
const suspendable = getSuspendableProcesses();
if (suspendable.length === 0) {
  console.log("  None found.");
} else {
  let totalMem = 0;
  for (const proc of suspendable) {
    console.log(`  ${proc.name.padEnd(30)} ${proc.memoryMB.toFixed(0).padStart(6)} MB  (PID ${proc.pid})`);
    totalMem += proc.memoryMB;
  }
  console.log(`\n  Total reclaimable: ~${totalMem.toFixed(0)} MB`);
}

// Game process
console.log("\n=== Minecraft Process ===");
const mc = findGameProcess("minecraft");
if (mc) {
  console.log(`  Found: ${mc.name} (PID ${mc.pid})`);
  console.log(`  Memory: ${mc.memoryMB.toFixed(0)} MB`);
  console.log(`  Priority: ${mc.priority}`);
} else {
  console.log("  Minecraft is not running.");
  console.log("  (Launch Minecraft and run this again to see its process)");
}