// drivers/interfaces.ts — the platform abstraction boundary.
//
// core/ and planners/ only ever see these contracts. Windows and Linux
// implementations live behind them, and the future C++ port swaps the
// implementation, not the contract. All methods are async and must not
// throw: failures come back as null / empty / ActionResult{ok:false}.

import {
  ActionResult,
  Capability,
  ForegroundApp,
  GpuProcess,
  GpuStats,
  JsonValue,
  PowerState,
  ProcessInfo,
} from "../core/types";

export interface TelemetrySource {
  isAvailable(): Promise<boolean>;
  getGpuStats(): Promise<GpuStats | null>;
  getGpuProcesses(): Promise<GpuProcess[]>;
}

export interface ProcessController {
  listProcesses(): Promise<ProcessInfo[]>;
  findProcess(nameSubstrings: string[]): Promise<ProcessInfo | null>;
  getPriority(pid: number): Promise<string | null>;
  setPriority(pid: number, level: "normal" | "above_normal" | "high"): Promise<ActionResult>;
  /** Kills the process. Caller is responsible for NEVER_TOUCH checks;
   *  implementations enforce them again as a second line of defense. */
  terminateProcess(pid: number, name: string): Promise<ActionResult>;
}

export interface PowerController {
  capabilities(): Promise<Capability>;
  getCurrent(): Promise<PowerState | null>;
  listAvailable(): Promise<PowerState[]>;
  set(id: string): Promise<ActionResult>;
}

export interface GameConfigStore {
  exists(): Promise<boolean>;
  read(): Promise<Record<string, JsonValue>>;
  backup(): Promise<ActionResult>;
  write(changes: Record<string, JsonValue>): Promise<ActionResult>;
  restore(): Promise<ActionResult>;
}

export interface ForegroundAppDetector {
  capabilities(): Promise<"window" | "process-poll" | "none">;
  getForegroundApp(): Promise<ForegroundApp | null>;
}

export interface Drivers {
  platform: "windows" | "linux";
  telemetry: TelemetrySource;
  processes: ProcessController;
  power: PowerController;
  foreground: ForegroundAppDetector;
}
