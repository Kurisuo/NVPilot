// drivers/windows/power.ts — Windows power plan control via powercfg.

import { execFile } from "child_process";
import { ActionResult, Capability, PowerState } from "../../core/types";
import { PowerController } from "../interfaces";

function powercfg(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("powercfg", args, { encoding: "utf-8", timeout: 10_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: err ? String(stderr || err) : stdout });
    });
  });
}

interface ParsedPlan extends PowerState {
  isActive: boolean;
}

async function listPlans(): Promise<ParsedPlan[]> {
  const { ok, out } = await powercfg(["/list"]);
  if (!ok) return [];
  const plans: ParsedPlan[] = [];
  for (const line of out.split("\n")) {
    // "Power Scheme GUID: 381b4222-...  (Balanced) *"
    const match = line.match(/:\s+([0-9a-f-]+)\s+\((.+?)\)/i);
    if (match) {
      plans.push({ id: match[1], name: match[2], isActive: line.includes("*") });
    }
  }
  return plans;
}

export class WindowsPowerController implements PowerController {
  async capabilities(): Promise<Capability> {
    const plans = await listPlans();
    return plans.length > 0 ? "full" : "none";
  }

  async getCurrent(): Promise<PowerState | null> {
    const plans = await listPlans();
    const active = plans.find((p) => p.isActive);
    return active ? { id: active.id, name: active.name } : null;
  }

  async listAvailable(): Promise<PowerState[]> {
    return (await listPlans()).map(({ id, name }) => ({ id, name }));
  }

  async set(id: string): Promise<ActionResult> {
    if (!/^[0-9a-f-]+$/i.test(id)) {
      return { ok: false, message: `Invalid power plan GUID: ${id}` };
    }
    const { ok, out } = await powercfg(["/setactive", id]);
    return ok
      ? { ok: true, message: `Switched power plan to ${id}` }
      : { ok: false, message: `Failed to set power plan: ${out.trim()}` };
  }
}
