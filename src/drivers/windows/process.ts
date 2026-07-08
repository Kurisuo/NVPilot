// drivers/windows/process.ts — process control via PowerShell.
// wmic is deprecated on Windows 11, so priority is set through
// (Get-Process).PriorityClass instead.

import { execFile } from "child_process";
import { NEVER_TOUCH } from "../../core/config";
import { ActionResult, ProcessInfo } from "../../core/types";
import { ProcessController } from "../interfaces";

function powershell(script: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf-8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: err ? String(stderr || err) : stdout });
      }
    );
  });
}

const PRIORITY_CLASS: Record<"normal" | "above_normal" | "high", string> = {
  normal: "Normal",
  above_normal: "AboveNormal",
  high: "High",
};

export class WindowsProcessController implements ProcessController {
  async listProcesses(): Promise<ProcessInfo[]> {
    const { ok, out } = await powershell(
      "Get-Process | Select-Object ProcessName, Id, @{Name='MemMB';Expression={[math]::Round($_.WorkingSet64/1MB,1)}}, PriorityClass | Sort-Object MemMB -Descending | ConvertTo-Csv -NoTypeInformation"
    );
    if (!ok) return [];

    const processes: ProcessInfo[] = [];
    const lines = out.trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].replace(/\r/g, "").replace(/"/g, "").split(",");
      if (parts.length < 4) continue;
      const pid = parseInt(parts[1].trim(), 10);
      if (!Number.isFinite(pid)) continue;
      processes.push({
        name: parts[0].trim(),
        pid,
        memoryMB: parseFloat(parts[2].trim()) || 0,
        priority: parts[3].trim() || "Normal",
      });
    }
    return processes;
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
    const { ok, out } = await powershell(`(Get-Process -Id ${pid} -ErrorAction Stop).PriorityClass`);
    return ok ? out.trim() : null;
  }

  async setPriority(
    pid: number,
    level: "normal" | "above_normal" | "high"
  ): Promise<ActionResult> {
    if (!Number.isInteger(pid)) return { ok: false, message: `Invalid PID: ${pid}` };
    const { ok, out } = await powershell(
      `(Get-Process -Id ${pid} -ErrorAction Stop).PriorityClass = '${PRIORITY_CLASS[level]}'`
    );
    return ok
      ? { ok: true, message: `Set PID ${pid} to ${level} priority` }
      : { ok: false, message: `Failed to set priority for PID ${pid}: ${out.trim()}` };
  }

  async terminateProcess(pid: number, name: string): Promise<ActionResult> {
    if (!Number.isInteger(pid)) return { ok: false, message: `Invalid PID: ${pid}` };
    const lower = name.toLowerCase();
    if (NEVER_TOUCH.some((nt) => lower.includes(nt))) {
      return { ok: false, message: `REFUSED: ${name} is a protected process` };
    }
    // -ErrorAction SilentlyContinue: child processes may already be gone
    // by the time we target their PID (known race).
    const { ok } = await powershell(
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`
    );
    return ok
      ? { ok: true, message: `Closed ${name} (PID ${pid})` }
      : { ok: true, message: `Skipped ${name} (PID ${pid}) — already closed` };
  }
}
