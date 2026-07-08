// tools/definitions.ts — NemoClaw/OpenClaw-compatible tool definitions.
//
// These describe NVPilot's capabilities as JSON-schema tools so an external
// agent runtime can drive them. `--tools-json` prints this array; dispatch.ts
// is the single entry point that executes a named tool.

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (draft-07) object schema
}

const NO_PARAMS = { type: "object", properties: {}, required: [] as string[] };

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_gpu_stats",
    description:
      "Read live NVIDIA GPU telemetry: name, temperature, power draw/cap, VRAM used/total, utilization, driver version. Returns null if no NVIDIA GPU/driver is available.",
    parameters: NO_PARAMS,
  },
  {
    name: "get_system_state",
    description:
      "Full perceived system snapshot: GPU stats + classified tier, power state and capability, background processes safe to close, detected game process, and current game settings for the given game.",
    parameters: {
      type: "object",
      properties: {
        game: {
          type: "string",
          description: "Game adapter id (e.g. \"minecraft\"). Omit for system-only snapshot.",
        },
      },
      required: [],
    },
  },
  {
    name: "read_game_config",
    description: "Read the current performance-relevant settings of a supported game.",
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", description: "Game adapter id (e.g. \"minecraft\")." },
      },
      required: ["game"],
    },
  },
  {
    name: "write_game_config",
    description:
      "Change one or more game settings. The game config is backed up first and every change is journaled with its inverse, so restore_all can undo it.",
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", description: "Game adapter id (e.g. \"minecraft\")." },
        changes: {
          type: "object",
          description: "Map of setting name to new value. Unknown settings and out-of-range values are rejected.",
        },
      },
      required: ["game", "changes"],
    },
  },
  {
    name: "set_process_priority",
    description: "Elevate a process's CPU scheduling priority. Journaled and reversible.",
    parameters: {
      type: "object",
      properties: {
        pid: { type: "integer", description: "Target process id." },
        level: { type: "string", enum: ["high", "above_normal"], description: "Priority level." },
      },
      required: ["pid", "level"],
    },
  },
  {
    name: "set_power_state",
    description:
      "Switch the OS power plan/profile (e.g. to a performance plan). Journaled and reversible. Use get_system_state to list available states.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Power state id from get_system_state." },
      },
      required: ["id"],
    },
  },
  {
    name: "close_background_process",
    description:
      "Close a background process. Only processes on the safe-to-close allowlist are permitted; protected system processes are always refused. NOT reversible — the journal records what was closed.",
    parameters: {
      type: "object",
      properties: {
        pid: { type: "integer", description: "Process id, must appear in get_system_state's suspendable list." },
      },
      required: ["pid"],
    },
  },
  {
    name: "restore_all",
    description: "Revert every journaled change: game settings, process priorities, power state.",
    parameters: NO_PARAMS,
  },
];
