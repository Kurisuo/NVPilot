// scripts/bench.ts — reproducible latency/scale measurements.
//
// Measures what NVPilot actually does (perception, planning, config I/O)
// on THIS machine. Deliberately does NOT measure or estimate FPS — there
// is no FPS benchmark suite, and no claim should imply one.
//
// Run: npx ts-node scripts/bench.ts

import { perceive } from "../src/core/agent";
import { createDrivers } from "../src/drivers";
import { minecraftAdapter } from "../src/games/minecraft";
import { RulePlanner } from "../src/planners/rule-planner";

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms, result };
}

function stats(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return `median ${median.toFixed(0)}ms  (min ${min.toFixed(0)}, max ${max.toFixed(0)}, n=${samples.length})`;
}

async function bench<T>(
  label: string,
  n: number,
  fn: () => Promise<T>
): Promise<T> {
  const samples: number[] = [];
  let last!: T;
  for (let i = 0; i < n; i++) {
    const { ms, result } = await timed(fn);
    samples.push(ms);
    last = result;
  }
  console.log(`  ${label.padEnd(42)} ${stats(samples)}`);
  return last;
}

async function main(): Promise<void> {
  const drivers = createDrivers();
  const planner = new RulePlanner();

  console.log(`\nNVPilot benchmark — ${new Date().toISOString()}`);
  console.log(`Platform: ${process.platform}, Node ${process.version}\n`);

  console.log("PERCEPTION:");
  const gpu = await bench("GPU telemetry (nvidia-smi CSV query)", 10, () =>
    drivers.telemetry.getGpuStats()
  );
  const procs = await bench("Full process scan (name/mem/priority)", 10, () =>
    drivers.processes.listProcesses()
  );
  await bench("Power plan detection", 10, () => drivers.power.getCurrent());
  await bench("Foreground app detection", 10, () =>
    drivers.foreground.getForegroundApp()
  );
  await bench("Game config read (options.txt)", 10, () =>
    minecraftAdapter.configStore.read()
  );

  console.log("\nFULL PIPELINE:");
  const snapshot = await bench("perceive() — complete system snapshot", 5, () =>
    perceive(drivers, minecraftAdapter)
  );
  await bench("Rule planner — full plan from snapshot", 20, () =>
    planner.createPlan(snapshot, minecraftAdapter, { allowClose: true })
  );

  console.log("\nSCALE (this machine, this run):");
  console.log(`  GPU: ${gpu?.name ?? "n/a"} (${gpu?.memoryTotalMiB ?? 0} MiB VRAM)`);
  console.log(`  Processes scanned per cycle:        ${procs.length}`);
  console.log(`  Suspendable candidates identified:  ${snapshot.suspendable.length}`);
  const reclaimable = snapshot.suspendable.reduce((s, p) => s + p.memoryMB, 0);
  console.log(`  Reclaimable background memory:      ${reclaimable.toFixed(0)} MB (one-time observation, not an average)`);
  console.log(`  Game settings evaluated per plan:   ${minecraftAdapter.settings.length}`);

  const plan = await planner.createPlan(snapshot, minecraftAdapter, { allowClose: true });
  console.log(`  Actions proposed in this state:     ${plan.actions.length}`);
  console.log(`  Settings preserved (surgical):      ${plan.keptSettings.length}`);

  console.log(
    "\nNote: no FPS measurements exist or are implied. These are latency and" +
    "\nscale numbers for the agent itself on this machine.\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
