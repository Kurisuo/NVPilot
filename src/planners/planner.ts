// planners/planner.ts — the Planner contract plus validation shared by the
// LLM path. The LLM chooses changes; this code decides whether they're
// legal. Anything that fails validation is dropped or clamped — the model
// is never trusted with raw system access.

import { NEVER_TOUCH } from "../core/config";
import {
  Action,
  JsonValue,
  Plan,
  PlannedAction,
  SystemSnapshot,
} from "../core/types";
import { GameAdapter } from "../games/adapter";

export interface PlanOptions {
  /** close_process actions are only legal when the user passed --allow-close. */
  allowClose: boolean;
}

export interface Planner {
  name: string;
  createPlan(
    snapshot: SystemSnapshot,
    adapter: GameAdapter | null,
    opts: PlanOptions
  ): Promise<Plan>;
}

// ---- Validation / clamping for LLM-produced plans ----

function clampNumber(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

/**
 * Takes a raw candidate object (parsed LLM JSON) and returns only the
 * actions that survive validation, with values clamped to legal ranges and
 * `from` values overwritten from the actually-perceived state.
 */
export function sanitizePlannedActions(
  candidates: unknown,
  snapshot: SystemSnapshot,
  adapter: GameAdapter | null,
  opts: PlanOptions
): { actions: PlannedAction[]; errors: string[] } {
  const actions: PlannedAction[] = [];
  const errors: string[] = [];

  if (!Array.isArray(candidates)) {
    return { actions, errors: ["`actions` is not an array"] };
  }

  for (const item of candidates) {
    const raw = item as { action?: Record<string, unknown>; reason?: unknown };
    const a = raw?.action;
    if (!a || typeof a.kind !== "string") {
      errors.push("action missing `kind`");
      continue;
    }
    const reason = typeof raw.reason === "string" ? raw.reason : "";

    switch (a.kind) {
      case "game_setting": {
        if (!adapter || !snapshot.gameSettings) {
          errors.push("game_setting proposed but no game config available");
          continue;
        }
        const spec = adapter.settings.find((s) => s.key === a.setting);
        if (!spec) {
          errors.push(`unknown setting: ${String(a.setting)}`);
          continue;
        }
        const current = snapshot.gameSettings[spec.key];
        if (current === undefined) {
          errors.push(`setting not present in config: ${spec.key}`);
          continue;
        }
        let to: JsonValue;
        if (spec.type === "number") {
          const n = typeof a.to === "number" ? a.to : parseFloat(String(a.to));
          if (!Number.isFinite(n)) {
            errors.push(`non-numeric value for ${spec.key}: ${String(a.to)}`);
            continue;
          }
          to = clampNumber(Math.round(n), spec.min, spec.max);
        } else if (spec.type === "boolean") {
          to = a.to === true || a.to === "true";
        } else {
          const v = String(a.to);
          if (!spec.enumValues?.includes(v)) {
            errors.push(`illegal value for ${spec.key}: ${v}`);
            continue;
          }
          to = v;
        }
        if (to === current) continue; // no-op, drop silently
        actions.push({
          action: { kind: "game_setting", game: adapter.id, setting: spec.key, from: current, to },
          reason: reason || spec.describe(current, to, snapshot.gpuTier),
          visualImpact: spec.visualImpact(current, to),
        });
        break;
      }

      case "process_priority": {
        const proc = snapshot.gameProcess;
        if (!proc) {
          errors.push("process_priority proposed but no game process found");
          continue;
        }
        const to = a.to === "above_normal" ? "above_normal" : "high";
        actions.push({
          action: {
            kind: "process_priority",
            pid: proc.pid, // always the perceived game PID, never the model's
            processName: proc.name,
            from: proc.priority,
            to,
          },
          reason: reason || `Give ${proc.name} more CPU time than background processes.`,
          visualImpact: "none",
        });
        break;
      }

      case "power_state": {
        if (snapshot.power.capability !== "full" || !snapshot.power.current) {
          errors.push("power_state proposed but power control unavailable");
          continue;
        }
        const target = snapshot.power.available.find(
          (p) => p.id === a.to || p.name === a.to
        );
        if (!target) {
          errors.push(`unknown power state: ${String(a.to)}`);
          continue;
        }
        if (target.id === snapshot.power.current.id) continue;
        actions.push({
          action: { kind: "power_state", from: snapshot.power.current.id, to: target.id },
          reason: reason || `Switch to "${target.name}" to prevent CPU throttling.`,
          visualImpact: "none",
        });
        break;
      }

      case "close_process": {
        if (!opts.allowClose) {
          errors.push("close_process proposed but --allow-close not set");
          continue;
        }
        const pid = typeof a.pid === "number" ? a.pid : parseInt(String(a.pid), 10);
        const candidate = snapshot.suspendable.find((p) => p.pid === pid);
        if (!candidate) {
          errors.push(`close_process PID ${String(a.pid)} not in suspendable list`);
          continue;
        }
        const lower = candidate.name.toLowerCase();
        if (NEVER_TOUCH.some((nt) => lower.includes(nt))) {
          errors.push(`close_process refused for protected process ${candidate.name}`);
          continue;
        }
        actions.push({
          action: {
            kind: "close_process",
            pid: candidate.pid,
            processName: candidate.name,
            memoryMB: candidate.memoryMB,
          },
          reason: reason || `Free ~${candidate.memoryMB.toFixed(0)} MB used by ${candidate.name}.`,
          visualImpact: "none",
        });
        break;
      }

      default:
        errors.push(`unknown action kind: ${a.kind}`);
    }
  }

  // De-duplicate (LLMs sometimes repeat actions)
  const seen = new Set<string>();
  const deduped = actions.filter(({ action }) => {
    const key = actionKey(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { actions: deduped, errors };
}

function actionKey(action: Action): string {
  switch (action.kind) {
    case "game_setting": return `gs:${action.setting}`;
    case "process_priority": return `pp:${action.pid}`;
    case "power_state": return "pw";
    case "close_process": return `cp:${action.pid}`;
  }
}
