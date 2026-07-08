// planners/rule-planner.ts — deterministic tier-relative planner.
//
// This is the fallback when Ollama is unavailable, and the knowledge base
// whose tier targets are fed to the LLM as guidance. Generic over the game
// adapter's setting schema: compare each current value against the tier
// target, propose the ideal only when the current value is costlier than
// the threshold. Surgical by construction — everything within budget is
// explicitly "kept".

import { RECLAIM_THRESHOLD_MB } from "../core/config";
import { Plan, PlannedAction, SystemSnapshot } from "../core/types";
import { GameAdapter, isCostlier } from "../games/adapter";
import { Planner, PlanOptions } from "./planner";

// Power states whose names indicate the CPU may throttle under load.
const THROTTLING_HINTS = ["balanced", "quiet", "power saver", "powersave", "power-saver"];
const PERFORMANCE_HINTS = ["performance", "high", "turbo"];

export class RulePlanner implements Planner {
  name = "rules";

  async createPlan(
    snapshot: SystemSnapshot,
    adapter: GameAdapter | null,
    opts: PlanOptions
  ): Promise<Plan> {
    const actions: PlannedAction[] = [];
    const kept: string[] = [];
    const tier = snapshot.gpuTier;

    // ---- Game settings (tier-relative, surgical) ----
    if (adapter && snapshot.gameSettings) {
      const targets = adapter.tierTargets[tier];
      const proposed: { planned: PlannedAction; priority: number }[] = [];

      for (const spec of adapter.settings) {
        const current = snapshot.gameSettings[spec.key];
        const target = targets[spec.key];
        if (current === undefined || target === undefined) continue;

        const threshold =
          spec.type === "number" && target.max !== undefined ? target.max : target.ideal;

        if (isCostlier(spec, current, threshold)) {
          const to = target.ideal;
          const magnitude =
            spec.type === "number" ? Math.abs((current as number) - (to as number)) : 1;
          proposed.push({
            priority: spec.weight * magnitude,
            planned: {
              action: { kind: "game_setting", game: adapter.id, setting: spec.key, from: current, to },
              reason: spec.describe(current, to, tier),
              visualImpact: spec.visualImpact(current, to),
            },
          });
        } else {
          kept.push(`${spec.key} (${current}) — within budget for ${tier}-tier GPU`);
        }
      }

      // Biggest render-cost wins first
      proposed.sort((a, b) => b.priority - a.priority);
      actions.push(...proposed.map((p) => p.planned));
    }

    // ---- Power state ----
    const power = snapshot.power;
    if (power.capability === "full" && power.current) {
      const currentName = power.current.name.toLowerCase();
      if (THROTTLING_HINTS.some((h) => currentName.includes(h))) {
        const target = power.available.find((p) =>
          PERFORMANCE_HINTS.some((h) => p.name.toLowerCase().includes(h))
        );
        if (target) {
          actions.push({
            action: { kind: "power_state", from: power.current.id, to: target.id },
            reason: `Power state "${power.current.name}" may throttle the CPU during gaming; "${target.name}" keeps clocks up.`,
            visualImpact: "none",
          });
        }
      } else {
        kept.push(`power state (${power.current.name}) — already performance-oriented`);
      }
    }

    // ---- Game process priority ----
    const proc = snapshot.gameProcess;
    if (proc) {
      const pri = proc.priority.toLowerCase();
      const alreadyHigh = pri.includes("high") || /nice -(?:[5-9]|1\d|20)/.test(pri);
      if (!alreadyHigh) {
        actions.push({
          action: {
            kind: "process_priority",
            pid: proc.pid,
            processName: proc.name,
            from: proc.priority,
            to: "high",
          },
          reason: `${proc.name} is running at ${proc.priority} priority; elevating gives it more CPU time.`,
          visualImpact: "none",
        });
      } else {
        kept.push(`process priority (${proc.priority}) — already elevated`);
      }
    }

    // ---- Background processes (gated) ----
    if (opts.allowClose) {
      const reclaimable = snapshot.suspendable.reduce((sum, p) => sum + p.memoryMB, 0);
      if (reclaimable > RECLAIM_THRESHOLD_MB) {
        for (const p of snapshot.suspendable) {
          actions.push({
            action: { kind: "close_process", pid: p.pid, processName: p.name, memoryMB: p.memoryMB },
            reason: `${p.name} is using ${p.memoryMB.toFixed(0)} MB in the background.`,
            visualImpact: "none",
          });
        }
      }
    }

    // ---- Summary ----
    const gameChanges = actions.filter((a) => a.action.kind === "game_setting").length;
    const lowImpact = actions.filter(
      (a) => a.visualImpact === "none" || a.visualImpact === "minimal"
    ).length;
    const summary =
      actions.length === 0
        ? `Settings are well-matched to this ${tier}-tier system. No changes recommended.`
        : `${actions.length} change(s) recommended for a ${tier}-tier GPU` +
          (snapshot.gpu ? ` (${snapshot.gpu.name})` : "") +
          `: ${gameChanges} game setting(s), ${actions.length - gameChanges} system-level. ` +
          `${kept.length} setting(s) preserved at current quality; ` +
          `${lowImpact}/${actions.length} changes have minimal or no visual impact.`;

    return {
      source: "rules",
      targetApp: snapshot.targetApp,
      gpuTier: tier,
      actions,
      keptSettings: kept,
      summary,
    };
  }
}
