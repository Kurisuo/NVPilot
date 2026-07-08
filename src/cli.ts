// cli.ts — argument parsing. Kept free of any execution logic.

import { POLL_MS_DEFAULT } from "./core/config";

export type Mode = "analyze" | "apply" | "restore" | "watch" | "tools-json" | "help";

export interface RunOptions {
  mode: Mode;
  allowClose: boolean;
  noLlm: boolean;
  intervalMs: number;
}

export function parseArgs(argv: string[]): RunOptions {
  const args = argv.slice(2);
  const opts: RunOptions = {
    mode: "analyze",
    allowClose: false,
    noLlm: false,
    intervalMs: POLL_MS_DEFAULT,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--analyze": opts.mode = "analyze"; break;
      case "--apply": opts.mode = "apply"; break;
      case "--restore": opts.mode = "restore"; break;
      case "--watch": opts.mode = "watch"; break;
      case "--tools-json": opts.mode = "tools-json"; break;
      case "--help": case "-h": opts.mode = "help"; break;
      case "--allow-close": opts.allowClose = true; break;
      case "--no-llm": opts.noLlm = true; break;
      case "--interval": {
        const ms = parseInt(args[++i], 10);
        if (Number.isFinite(ms) && ms >= 500) opts.intervalMs = ms;
        break;
      }
      default:
        console.error(`Unknown argument: ${args[i]} (see --help)`);
        process.exit(1);
    }
  }
  return opts;
}

export const HELP_TEXT = `
NVPilot — autonomous GPU/system performance agent

Usage:
  npx ts-node src/index.ts [mode] [flags]

Modes:
  --analyze      Read system state and print recommendations (default, changes nothing)
  --apply        Apply recommended optimizations once
  --restore      Revert all journaled changes + restore game config backup
  --watch        Daemon mode: watch the foreground app and optimize in real time
  --tools-json   Print NemoClaw-compatible tool definitions as JSON

Flags:
  --allow-close  Permit closing background apps (off by default; kills processes)
  --no-llm       Skip Ollama, use the rule engine directly
  --interval ms  Foreground poll interval in --watch mode (default ${POLL_MS_DEFAULT})

Environment:
  NVPILOT_MODEL  Ollama model (default: nemotron-mini)
  OLLAMA_HOST    Ollama endpoint (default: http://localhost:11434)
`.trim();
