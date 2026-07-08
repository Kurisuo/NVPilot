// drivers/linux/foreground.ts — active-window detection.
//
// X11: xdotool gives us the focused window's PID directly.
// Wayland: there is no portable active-window API, so we degrade to
// "process-poll" — the daemon scans running processes for known games
// instead. Worst case: we optimize for a running-but-unfocused game.

import { execFile } from "child_process";
import { readFileSync } from "fs";
import { ForegroundApp } from "../../core/types";
import { ForegroundAppDetector } from "../interfaces";

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", timeout: 5_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: err ? String(stderr || err) : stdout });
    });
  });
}

export class LinuxForegroundDetector implements ForegroundAppDetector {
  private capability: "window" | "process-poll" | "none" | null = null;

  async capabilities(): Promise<"window" | "process-poll" | "none"> {
    if (this.capability !== null) return this.capability;
    if (process.env.WAYLAND_DISPLAY) {
      this.capability = "process-poll";
    } else if (process.env.DISPLAY) {
      const probe = await run("xdotool", ["getactivewindow"]);
      this.capability = probe.ok ? "window" : "process-poll";
    } else {
      this.capability = "process-poll"; // headless / unknown session
    }
    return this.capability;
  }

  async getForegroundApp(): Promise<ForegroundApp | null> {
    if ((await this.capabilities()) !== "window") return null;

    const { ok, out } = await run("xdotool", ["getactivewindow", "getwindowpid"]);
    if (!ok) return null;
    const pid = parseInt(out.trim(), 10);
    if (!Number.isFinite(pid)) return null;

    let processName = "";
    try {
      processName = readFileSync(`/proc/${pid}/comm`, "utf-8").trim();
    } catch {
      return null;
    }

    const title = await run("xdotool", ["getactivewindow", "getwindowname"]);
    return {
      pid,
      processName,
      windowTitle: title.ok ? title.out.trim() : undefined,
    };
  }
}
