# NVPilot

NVPilot is like personalized medicine for your PC. Just like a doctor doesn't prescribe the same treatment to every patient, NVPilot doesn't apply the same settings to every machine — it reads your specific hardware, figures out what's actually holding your system back, and prescribes the exact optimizations your machine needs for whatever you're running. Instead of nerfing your graphics like a one-size-fits-all preset, it identifies which settings are genuinely costing you performance on your GPU specifically, changes only those, and preserves everything else at full quality. It handles the full system: background apps eating your RAM, process priority, power plans, and game configs — all reasoned about together, not in isolation.

In watch mode, NVPilot runs as a real-time agent: it detects the app you're actually using, runs a perceive → plan → act → reflect cycle for it, and reverts everything when you switch away or quit.

---

## Requirements

- Node.js v18+ (developed on v24)
- NVIDIA GPU with drivers installed (`nvidia-smi` must be accessible in terminal)
- Windows 10/11 or Linux
- Minecraft Java Edition (currently the only game with config-level tuning; other apps get system-level optimization only)
- Optional: [Ollama](https://ollama.com) with a local model (default: `nemotron-mini`) for LLM-driven planning

---

## Setup

```bash
git clone https://github.com/Kurisuo/NVPilot.git
cd NVPilot
npm install
```

Optional, for the LLM planner:

```bash
ollama pull nemotron-mini
```

---

## Running

```bash
npm run analyze    # read system state, print recommendations, change nothing (default)
npm run apply      # apply recommended optimizations once (journaled, reversible)
npm run watch      # real-time agent: watch the foreground app and optimize for it
npm run restore    # revert every change NVPilot has made
```

Flags (pass after `--`, e.g. `npm run watch -- --allow-close`):

| Flag | Effect |
|---|---|
| `--allow-close` | Permit closing background apps from the safe-to-close allowlist (off by default — closing is the one action that can't be auto-reverted) |
| `--no-llm` | Skip Ollama and use the deterministic rule engine |
| `--interval <ms>` | Foreground poll interval in watch mode (default 2000) |

Environment variables: `NVPILOT_MODEL` (Ollama model, default `nemotron-mini`), `OLLAMA_HOST` (default `http://localhost:11434`).

### How planning works

The perceived system state (GPU telemetry, classified GPU tier, current game settings with tier-relative guidance, power state, background processes) is sent to a local Ollama model, which proposes a plan as structured JSON. Every proposed action is validated and clamped in code — unknown settings are rejected, values are clamped to legal ranges, protected processes are always refused. If Ollama is unreachable or its output fails validation, NVPilot falls back to its built-in rule engine, so the tool always works without an LLM.

### Reversibility

Every mutation is recorded in a journal (`~/.nvpilot/journal.json`) together with its inverse before the next action runs. `--restore` (or Ctrl+C in watch mode, or switching to another app) replays the inverses. Game configs are additionally backed up before the first write. The one exception is closing background apps, which is why it's off by default.

---

## What it does

| Layer | What NVPilot reads | What NVPilot changes |
|---|---|---|
| GPU | Utilization, VRAM, temp, power draw (`nvidia-smi` CSV query) | — |
| Game | Current graphics settings | Render distance, shadows, clouds, mipmaps, particles (Minecraft) |
| System | Running processes, memory usage | Process priority, optional background app cleanup |
| Power | Active power plan/profile | Switches to a performance plan (Windows `powercfg`; Linux `powerprofilesctl`/cpufreq governor) |

On Linux, capabilities degrade gracefully: raising process priority and writing the CPU governor need root, and Wayland has no active-window API (NVPilot falls back to scanning for known game processes). NVPilot reports what it can and can't control instead of failing.

---

## NemoClaw / external agent integration

NVPilot exposes its capabilities as JSON-schema tool definitions so an external agent runtime (NemoClaw/OpenClaw) can drive it:

```bash
npx ts-node src/index.ts --tools-json
```

`src/tools/dispatch.ts` is the single execution entry point: external tool calls pass through the same validation and journal as NVPilot's own planners, so they are equally constrained and equally reversible.

---

## Architecture

```
perceive ─→ plan ─→ act ─→ reflect
   │          │       │        │
 drivers   planners  executor  re-perceive + verify
 (per-OS)  (LLM or   (journal
            rules)    + inverses)
```

- `src/core/` — agent cycle, daemon loop, executor, journal, config data
- `src/planners/` — Ollama planner (validated) + rule engine fallback
- `src/drivers/` — platform abstraction: telemetry, processes, power, foreground app (Windows + Linux implementations)
- `src/games/` — game registry; adding a game = a config store + a data schema of settings and tier targets
- `src/tools/` — NemoClaw-compatible tool definitions and dispatcher

Tier classification and per-tier targets were empirically exercised on one machine (RTX 3060 Laptop, 6 GB VRAM); treat them as designed defaults, not benchmarks. There is no FPS benchmark suite, and NVPilot makes no cross-title performance claims.

---

## Project Status

- [x] GPU telemetry via `nvidia-smi` (stable CSV query mode)
- [x] Minecraft config reader/writer with backup/restore
- [x] GPU-tier-aware rule engine
- [x] System-level optimizer (power, process priority, background apps)
- [x] Real-time watch mode (foreground app detection, debounce, revert-on-switch)
- [x] Ollama integration with validation and rule-engine fallback
- [x] Journal-based reversibility for every mutation
- [x] Linux support (with graceful capability degradation)
- [x] NemoClaw-compatible tool interface (`--tools-json`)
- [ ] Config-level adapters for more games (registry is ready; Minecraft is the only adapter)
- [ ] C++ rewrite using NVML and Windows API (planned)

---

## Built With

- TypeScript / Node.js
- NVIDIA System Management Interface (`nvidia-smi`)
- Windows PowerShell / `powercfg`; Linux `ps`/`renice`/`powerprofilesctl`
- Ollama + Nemotron (local inference, optional)

---

*Built initially as prep for the NemoClaw NVIDIA x ASUS Hackathon — UC Santa Cruz, May 2026*
