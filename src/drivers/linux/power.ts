// drivers/linux/power.ts — CPU power control with graceful degradation.
//
// Probe order:
//   1. powerprofilesctl (power-profiles-daemon: most modern desktops)
//   2. cpufreq scaling_governor via sysfs (needs root to write)
// If neither is usable we report capability "none" and the planner simply
// omits power actions — never crash on a missing subsystem.

import { execFile } from "child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { ActionResult, Capability, PowerState } from "../../core/types";
import { PowerController } from "../interfaces";

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", timeout: 10_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: err ? String(stderr || err) : stdout });
    });
  });
}

const CPUFREQ_DIR = "/sys/devices/system/cpu";

function governorPaths(): string[] {
  try {
    return readdirSync(CPUFREQ_DIR)
      .filter((d) => /^cpu\d+$/.test(d))
      .map((d) => `${CPUFREQ_DIR}/${d}/cpufreq/scaling_governor`)
      .filter((p) => existsSync(p));
  } catch {
    return [];
  }
}

type Backend = "ppd" | "sysfs" | "none";

export class LinuxPowerController implements PowerController {
  private backend: Backend | null = null;

  private async detect(): Promise<Backend> {
    if (this.backend !== null) return this.backend;
    const ppd = await run("powerprofilesctl", ["get"]);
    if (ppd.ok) {
      this.backend = "ppd";
    } else if (governorPaths().length > 0) {
      this.backend = "sysfs";
    } else {
      this.backend = "none";
    }
    return this.backend;
  }

  async capabilities(): Promise<Capability> {
    const backend = await this.detect();
    if (backend === "ppd") return "full";
    if (backend === "sysfs") {
      // Writing the governor needs root; reading never does.
      try {
        const path = governorPaths()[0];
        writeFileSync(path, readFileSync(path, "utf-8")); // no-op rewrite probe
        return "full";
      } catch {
        return "readonly";
      }
    }
    return "none";
  }

  async getCurrent(): Promise<PowerState | null> {
    const backend = await this.detect();
    if (backend === "ppd") {
      const { ok, out } = await run("powerprofilesctl", ["get"]);
      if (!ok) return null;
      const name = out.trim();
      return { id: name, name };
    }
    if (backend === "sysfs") {
      try {
        const gov = readFileSync(governorPaths()[0], "utf-8").trim();
        return { id: gov, name: `governor: ${gov}` };
      } catch {
        return null;
      }
    }
    return null;
  }

  async listAvailable(): Promise<PowerState[]> {
    const backend = await this.detect();
    if (backend === "ppd") {
      // Fixed set from power-profiles-daemon
      return ["power-saver", "balanced", "performance"].map((p) => ({ id: p, name: p }));
    }
    if (backend === "sysfs") {
      try {
        const path = `${CPUFREQ_DIR}/cpu0/cpufreq/scaling_available_governors`;
        const govs = readFileSync(path, "utf-8").trim().split(/\s+/);
        return govs.map((g) => ({ id: g, name: `governor: ${g}` }));
      } catch {
        return [];
      }
    }
    return [];
  }

  async set(id: string): Promise<ActionResult> {
    if (!/^[a-z-]+$/.test(id)) {
      return { ok: false, message: `Invalid power profile id: ${id}` };
    }
    const backend = await this.detect();
    if (backend === "ppd") {
      const { ok, out } = await run("powerprofilesctl", ["set", id]);
      return ok
        ? { ok: true, message: `Switched power profile to ${id}` }
        : { ok: false, message: `Failed to set power profile: ${out.trim()}` };
    }
    if (backend === "sysfs") {
      try {
        for (const path of governorPaths()) writeFileSync(path, id);
        return { ok: true, message: `Set CPU governor to ${id}` };
      } catch (err) {
        return { ok: false, message: `Failed to set governor (need root?): ${err}` };
      }
    }
    return { ok: false, message: "No power control backend available" };
  }
}
