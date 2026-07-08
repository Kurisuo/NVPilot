// games/adapter.ts — the contract a supported game implements.
//
// A GameAdapter bundles:
//   - how to find the game (process names)
//   - where its config lives (GameConfigStore)
//   - a schema of tunable settings (types, legal ranges, cost direction)
//   - tier-relative targets (the core "no absolute expensive flags" rule)
//
// The rule planner and the LLM validator are generic over this schema, so
// adding a game means writing data + a config store, not new engine logic.

import { GameConfigStore } from "../drivers/interfaces";
import { GpuTier, JsonValue, VisualImpact } from "../core/types";

export interface SettingSpec {
  key: string;
  type: "number" | "boolean" | "enum";
  /** Legal range for numbers (used to clamp LLM output). */
  min?: number;
  max?: number;
  /** Legal values for enums, ordered cheapest → costliest. */
  enumValues?: string[];
  /** For numbers where a LOWER value costs more (e.g. Minecraft particles:
   *  0=all, 2=minimal). Default: higher value costs more. */
  lowerIsCostlier?: boolean;
  /** Relative render-cost weight — used only to order proposed changes
   *  (biggest wins first). Not an FPS claim. */
  weight: number;
  visualImpact: (from: JsonValue, to: JsonValue) => VisualImpact;
  describe: (from: JsonValue, to: JsonValue, tier: GpuTier) => string;
}

/** Target for one setting at one tier. For numbers, `max` is the threshold
 *  above which we act and `ideal` is what we propose; for boolean/enum the
 *  threshold is `ideal` itself. */
export interface TierTarget {
  ideal: JsonValue;
  max?: number;
}

export interface GameAdapter {
  id: string;
  displayName: string;
  /** Substrings matched against process names to detect the game. */
  processNames: string[];
  configStore: GameConfigStore;
  settings: SettingSpec[];
  tierTargets: Record<GpuTier, Record<string, TierTarget>>;
}

/** Is value `a` costlier than value `b` for this setting? */
export function isCostlier(spec: SettingSpec, a: JsonValue, b: JsonValue): boolean {
  switch (spec.type) {
    case "number":
      return spec.lowerIsCostlier ? (a as number) < (b as number) : (a as number) > (b as number);
    case "boolean":
      return a === true && b === false;
    case "enum": {
      const order = spec.enumValues || [];
      return order.indexOf(String(a)) > order.indexOf(String(b));
    }
  }
}
