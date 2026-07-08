// core/types.ts — shared data model for the whole agent.
//
// Everything here is pure data (JSON-serializable). The perceive phase
// produces a SystemSnapshot, the plan phase produces a Plan, the act phase
// consumes it. This is the contract the future C++ rule engine will share.

export type JsonValue = string | number | boolean;

export type GpuTier = "low" | "mid" | "high" | "ultra";

export type VisualImpact = "none" | "minimal" | "noticeable" | "significant";

// ---- Telemetry ----

export interface GpuStats {
  name: string;
  temperatureC: number;
  powerUsageW: number;
  powerCapW: number;
  memoryUsedMiB: number;
  memoryTotalMiB: number;
  gpuUtilizationPercent: number;
  driverVersion: string;
}

export interface GpuProcess {
  pid: number;
  name: string;
}

// ---- Processes / power / foreground ----

export interface ProcessInfo {
  pid: number;
  name: string;
  memoryMB: number;
  priority: string; // platform-native priority label ("Normal", "High", nice value...)
}

export interface PowerState {
  id: string;   // GUID on Windows, profile/governor name on Linux
  name: string; // human-readable
}

export type Capability = "full" | "readonly" | "none";

export interface ForegroundApp {
  processName: string;
  pid: number;
  windowTitle?: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ---- Perceived state (input to planners) ----

export interface SystemSnapshot {
  timestamp: string;
  gpu: GpuStats | null;          // null = no NVIDIA GPU / driver unavailable
  gpuTier: GpuTier;
  power: {
    capability: Capability;
    current: PowerState | null;
    available: PowerState[];
  };
  suspendable: ProcessInfo[];    // candidates from SAFE_TO_SUSPEND, filtered
  gameProcess: ProcessInfo | null;
  targetApp: string;             // game adapter id or "generic"
  gameSettings: Record<string, JsonValue> | null; // null when no adapter/config
}

// ---- Plan (output of planners, input to executor) ----

export type Action =
  | { kind: "game_setting"; game: string; setting: string; from: JsonValue; to: JsonValue }
  // `to: "normal"` only appears in inverses (restoring the original level);
  // planners may only propose "high" or "above_normal".
  | { kind: "process_priority"; pid: number; processName: string; from: string; to: "high" | "above_normal" | "normal" }
  | { kind: "power_state"; from: string; to: string }
  | { kind: "close_process"; pid: number; processName: string; memoryMB: number };

export interface PlannedAction {
  action: Action;
  reason: string;
  visualImpact: VisualImpact; // meaningful for game_setting; "none" otherwise
}

export interface Plan {
  source: "llm" | "rules";
  targetApp: string;
  gpuTier: GpuTier;
  actions: PlannedAction[];
  keptSettings: string[]; // what was deliberately NOT changed — the surgical evidence
  summary: string;
}

// ---- Journal (reversibility ledger) ----

export interface JournalEntry {
  timestamp: string;
  action: Action;
  inverse: Action | null; // null = not mechanically reversible (close_process)
  result: ActionResult;
}

export interface JournalBatch {
  id: string;
  targetApp: string;
  createdAt: string;
  entries: JournalEntry[];
}
