// drivers/nvidia-smi.ts — shared NVIDIA telemetry for Windows and Linux.
//
// Uses the stable CSV query mode instead of scraping the human-readable
// table: robust across driver versions, and the field list already matches
// what NVML exposes (keeps the C++ port mechanical).

import { execFile } from "child_process";
import { GpuProcess, GpuStats } from "../core/types";
import { TelemetrySource } from "./interfaces";

const QUERY_FIELDS = [
  "name",
  "temperature.gpu",
  "power.draw",
  "power.limit",
  "memory.used",
  "memory.total",
  "utilization.gpu",
  "driver_version",
].join(",");

function run(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("nvidia-smi", args, { encoding: "utf-8", timeout: 10_000 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

function num(field: string): number {
  const n = parseFloat(field.trim());
  return Number.isFinite(n) ? n : 0;
}

export class NvidiaSmiTelemetry implements TelemetrySource {
  async isAvailable(): Promise<boolean> {
    return (await this.getGpuStats()) !== null;
  }

  async getGpuStats(): Promise<GpuStats | null> {
    const out = await run([
      `--query-gpu=${QUERY_FIELDS}`,
      "--format=csv,noheader,nounits",
    ]);
    if (!out) return null;

    // First GPU only (index 0) — multi-GPU laptops report the dGPU first.
    const line = out.trim().split("\n")[0];
    if (!line) return null;
    const f = line.split(",").map((s) => s.trim());
    if (f.length < 8) return null;

    return {
      name: f[0],
      temperatureC: num(f[1]),
      powerUsageW: num(f[2]),
      powerCapW: num(f[3]),
      memoryUsedMiB: num(f[4]),
      memoryTotalMiB: num(f[5]),
      gpuUtilizationPercent: num(f[6]),
      driverVersion: f[7],
    };
  }

  async getGpuProcesses(): Promise<GpuProcess[]> {
    // Best-effort: --query-compute-apps only lists compute processes;
    // graphics clients (games) are not reported by this query.
    const out = await run([
      "--query-compute-apps=pid,process_name",
      "--format=csv,noheader",
    ]);
    if (!out) return [];

    const processes: GpuProcess[] = [];
    for (const line of out.trim().split("\n")) {
      if (!line.trim()) continue;
      const idx = line.indexOf(",");
      if (idx === -1) continue;
      const pid = parseInt(line.slice(0, idx).trim(), 10);
      const path = line.slice(idx + 1).trim();
      if (!Number.isFinite(pid)) continue;
      processes.push({
        pid,
        name: path.split(/[\\/]/).pop() || path,
      });
    }
    return processes;
  }
}
