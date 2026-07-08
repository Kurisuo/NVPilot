// drivers/linux/process.ts — process control via ps / renice / kill.
//
// Note on priority: negative nice values need root (or CAP_SYS_NICE).
// Without root we still lower to nice 0 if the process was deprioritized,
// and report degraded results honestly instead of crashing.

import { execFile } from "child_process";
import { NEVER_TOUCH } from "../../core/config";
import { ActionResult, ProcessInfo } from "../../core/types";
import { ProcessController } from "../interfaces";

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: err ? String(stderr || err) : stdout });
      });
  });
}

// nice values for each abstract priority level
const NICE_LEVEL: Record<"normal" | "above_normal" | "high", number> = {
  normal: 0,
  above_normal: -5,
  high: -10,
};

export class LinuxProcessController implements ProcessController {
  async listProcesses(): Promise<ProcessInfo[]> {
    // rss is in KiB; comm is the executable name (15-char truncated)
    const { ok, out } = await run("ps", ["-eo", "pid,rss,ni,comm", "--no-headers"]);
    if (!ok) return [];

    const processes: ProcessInfo[] = [];
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(-?\d+)\s+(.+)$/);
      if (!m) continue;
      processes.push({
        pid: parseInt(m[1], 10),
        memoryMB: parseInt(m[2], 10) / 1024,
        priority: `nice ${m[3]}`,
        name: m[4].trim(),
      });
    }
    return processes.sort((a, b) => b.memoryMB - a.memoryMB);
  }

  async findProcess(nameSubstrings: string[]): Promise<ProcessInfo | null> {
    const processes = await this.listProcesses();
    const terms = nameSubstrings.map((t) => t.toLowerCase());
    return (
      processes.find((p) => terms.some((t) => p.name.toLowerCase().includes(t))) || null
    );
  }

  async getPriority(pid: number): Promise<string | null> {
    if (!Number.isInteger(pid)) return null;
    const { ok, out } = await run("ps", ["-o", "ni=", "-p", String(pid)]);
    return ok && out.trim() ? `nice ${out.trim()}` : null;
  }

  async setPriority(
    pid: number,
    level: "normal" | "above_normal" | "high"
  ): Promise<ActionResult> {
    if (!Number.isInteger(pid)) return { ok: false, message: `Invalid PID: ${pid}` };
    const nice = NICE_LEVEL[level];
    const { ok, out } = await run("renice", ["-n", String(nice), "-p", String(pid)]);
    if (ok) return { ok: true, message: `Set PID ${pid} to nice ${nice} (${level})` };
    if (nice < 0) {
      // Raising priority needs root; try the best we can without it.
      const retry = await run("renice", ["-n", "0", "-p", String(pid)]);
      if (retry.ok) {
        return { ok: true, message: `Set PID ${pid} to nice 0 (raising further needs root)` };
      }
    }
    return { ok: false, message: `Failed to renice PID ${pid}: ${out.trim()}` };
  }

  async terminateProcess(pid: number, name: string): Promise<ActionResult> {
    if (!Number.isInteger(pid)) return { ok: false, message: `Invalid PID: ${pid}` };
    const lower = name.toLowerCase();
    if (NEVER_TOUCH.some((nt) => lower.includes(nt))) {
      return { ok: false, message: `REFUSED: ${name} is a protected process` };
    }
    const { ok } = await run("kill", ["-TERM", String(pid)]);
    return ok
      ? { ok: true, message: `Closed ${name} (PID ${pid})` }
      : { ok: true, message: `Skipped ${name} (PID ${pid}) — already closed` };
  }
}
