// drivers/windows/foreground.ts — detects the app in focus via a
// GetForegroundWindow P/Invoke through PowerShell. Spawning PowerShell per
// poll costs ~100-300ms, acceptable at a 2s interval. (Follow-up if it
// proves heavy: keep a persistent PowerShell child in a read loop.)

import { execFile } from "child_process";
import { ForegroundApp } from "../../core/types";
import { ForegroundAppDetector } from "../interfaces";

const SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$hwnd = [FgWin]::GetForegroundWindow()
$procId = 0
[FgWin]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
if ($procId -ne 0) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) { Write-Output "$($p.Id)|$($p.ProcessName)|$($p.MainWindowTitle)" }
}
`.trim();

export class WindowsForegroundDetector implements ForegroundAppDetector {
  async capabilities(): Promise<"window" | "process-poll" | "none"> {
    return "window";
  }

  async getForegroundApp(): Promise<ForegroundApp | null> {
    return new Promise((resolve) => {
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
        { encoding: "utf-8", timeout: 15_000 },
        (err, stdout) => {
          if (err) return resolve(null);
          const line = stdout.trim().split("\n").pop()?.replace(/\r/g, "") || "";
          const parts = line.split("|");
          if (parts.length < 2) return resolve(null);
          const pid = parseInt(parts[0], 10);
          if (!Number.isFinite(pid)) return resolve(null);
          resolve({
            pid,
            processName: parts[1],
            windowTitle: parts[2] || undefined,
          });
        }
      );
    });
  }
}
