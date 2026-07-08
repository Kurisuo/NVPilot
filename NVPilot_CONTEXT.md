# NVPilot — Project Context Brief

> Purpose of this file: orient an AI coding agent (Cursor) on what NVPilot is,
> how it's architected, what's actually built vs. planned, known quirks already
> hit, and the eventual C++ port target — so improvements to the TypeScript
> version move the codebase *toward* the C++ rewrite, not away from it.
>
> Source: reconstructed from the original build session and design notes. The
> agent should treat the actual repo as ground truth and reconcile against this
> brief where they differ. Items marked **[VERIFY]** are not certain.

---

## 1. What NVPilot is

An autonomous GPU performance agent. Instead of applying a blanket quality
preset (low/medium/high), it reads live hardware telemetry, classifies the GPU
tier, and surgically modifies *only* the settings that are actually costing
performance on that specific machine — preserving visual quality everywhere
else. It reasons about the whole system together: GPU state, game config,
background processes, process priority, and power plan.

- **Owner / repo:** github.com/Kurisuo/NVPilot
- **Origin:** built as a pre-hackathon demo for the NVIDIA × ASUS NemoClaw
  Hackathon, UC Santa Cruz, May 2026.
- **Language/runtime:** TypeScript / Node.js (developed on Node v24.x).
- **Target OS (current):** Windows 10/11. Linux support is planned, not built.
- **Game support (current):** Minecraft Java Edition only.

### Machine it was developed and demoed on
- Lenovo Legion laptop, Windows 11
- RTX 3060 Laptop GPU, 6 GB VRAM
- CUDA 12.6, Node.js v24.15.0

This matters: any "tested" behavior was observed on this single mid-tier
machine. The tier-classification logic should be treated as designed but only
empirically exercised on one GPU.

---

## 2. Architecture: perceive → plan → act → reflect

A `demo.ts` runner wires four tool modules into a control loop with three modes:

- `--analyze` — read system state, print recommendations, change nothing.
- `--apply`   — apply all recommended optimizations.
- `--restore` — restore original settings from backup.

Invocation (current):
```
npx ts-node src/demo.ts            # analyze (default)
npx ts-node src/demo.ts --apply
npx ts-node src/demo.ts --restore
```

### The four tools (src/)

| File | Responsibility | Reads | Writes |
|---|---|---|---|
| `gpu-stats.ts` | Telemetry | Parses `nvidia-smi` output into structured TS interfaces (`GpuStats`, `GpuProcess`, `FullGpuReport`): utilization, VRAM used/total, temp, power draw, running GPU processes, memory-pressure %. | — |
| `minecraft-config.ts` | Game config | Reads Minecraft `options.txt`. | Writes/backs-up/restores: render distance, shadows, clouds, mipmaps, particles. |
| `optimizer.ts` | Reasoning engine | GPU-tier-aware. Classifies GPU as low / mid / high / ultra and proposes *surgical* setting changes relative to that tier. | (produces a plan, doesn't touch disk) |
| `system-optimizer.ts` | OS-level controls | Detects active Windows power plan; identifies background processes + memory usage. | Elevates process priority (via `wmic`), switches power plan to performance, closes/suspends background apps (via PowerShell). |

### Layer summary
| Layer | NVPilot reads | NVPilot changes |
|---|---|---|
| GPU | utilization, VRAM, temp, power draw | — |
| Game | current graphics settings | render distance, shadows, clouds, mipmaps, particles |
| System | running processes, memory usage | process priority, background app cleanup |
| Power | active Windows power plan | switches to performance mode if needed |

All game/system changes are intended to be fully reversible via automatic
backup + restore.

---

## 3. Core design principles (do not violate when refactoring)

1. **No hardcoded "expensive" flags.** Cost of a setting is hardware-specific.
   The optimizer must reason *relative to the classified GPU tier*, never with
   absolute "this setting is always expensive" rules. This was a deliberate
   architectural correction — keep the tier-relative reasoning intact.
2. **Surgical, not blanket.** Change only what's costing performance on *this*
   machine; preserve quality elsewhere. Don't regress toward preset-style logic.
3. **Reversibility is mandatory.** Every mutating action needs a backup path and
   a working `--restore`. Don't add a mutation without its inverse.
4. **Perceive → plan → act → reflect stays explicit.** Keep the phases as
   distinct, inspectable stages. This separation is what makes the C++ port
   clean (see §6).

---

## 4. Known quirks / bugs already hit (so the agent doesn't re-trip them)

- **Windows `\r\n` line endings** broke boolean comparisons in the Minecraft
  config parser. Fix in place: strip `\r` (`.replace(/\r/g, "")`) when parsing
  values. Watch for this anywhere config text is compared.
- **PowerShell process-closing race:** child processes sometimes died before
  their PID was explicitly targeted, throwing. Fix: `-ErrorAction SilentlyContinue`
  on the relevant PowerShell calls.
- **tsconfig:** `verbatimModuleSyntax` caused conflicts. The working config used
  `"strict": false` and `"types": ["node"]`. **[VERIFY]** current tsconfig — if
  tightening `strict` is desired, expect import-syntax fallout to fix.
- **`parseInt` without radix** in the nvidia-smi parser — add radix `10` for lint
  strictness.
- **Discord** was explicitly excluded from the safe-to-suspend list. Preserve an
  allowlist/denylist concept for "do not suspend" processes; don't hardcode-kill.

### Suggested-but-[VERIFY]-if-done improvements raised earlier
- Move `gpu-stats.ts` off regex-parsing of raw `nvidia-smi` text to the stable
  `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` CSV form. More
  robust across driver versions. **This also makes the C++/NVML port conceptually
  closer**, since you're already thinking in structured fields, not screen-scrape.
- Wrap `execSync` in try/catch so the absence of an NVIDIA driver degrades
  gracefully instead of throwing.

---

## 5. Build status (honest)

Built and demoed:
- [x] GPU telemetry via `nvidia-smi`
- [x] Minecraft config reader/writer/backup/restore
- [x] GPU-tier-aware optimizer
- [x] System optimizer (power plan, process priority, background apps)
- [x] `--analyze` / `--apply` / `--restore` runner

Planned / not built (do not describe as done):
- [ ] NemoClaw + Ollama agent integration (was "in progress" — **[VERIFY]** state)
- [ ] Multi-game support beyond Minecraft
- [ ] Linux support
- [ ] C++ rewrite (NVML + Windows API)

### Measurement honesty (important — owner enforces strict no-inflation rules)
- The "~2 GB reclaimed" figure is an **observed, roughly one-time** result on the
  RTX 3060 Laptop machine (the demo identified ~1.8 GB of reclaimable memory from
  background processes incl. Discord, Docker Desktop, LinkedIn, iCloud). It is
  **not** a benchmark across titles and **not** a reproduced average.
- There is **no FPS benchmark suite.** Do not let any doc/README/comment imply
  "raised FPS across AAA titles." The real config surface tested is Minecraft.
- Keep telemetry/measurement claims in code comments and docs defensible.

---

## 6. The C++ rewrite target (shape TS improvements toward this)

The C++ version is a **ground-up rewrite, not a line port.** Architected
differently:
- **NVML** for direct GPU queries (replaces `nvidia-smi` text parsing).
- **Windows API** for process management (replaces PowerShell/`wmic`):
  `CreateToolhelp32Snapshot`, `OpenProcess`, `SetPriorityClass`.
- **A proper event loop** instead of sequential one-shot tool calls.
- Game-launch detection by watching process-creation events (WMI/ETW) instead of
  assuming Minecraft.
- Decision engine: a well-designed **rule engine in C++** is the goal — not an
  LLM wrapper.

Planned build order:
- Week 1 — NVML integration (query GPU stats directly).
- Week 2 — Windows API process management (enumerate, set priority, suspend/resume).
- Week 3 — game config detection/editing (auto-detect launched game).
- Week 4 — wire it together with the decision engine.

### Implication for improving the TS now
When refactoring the TypeScript, prefer changes that make the eventual port
mechanical:
- Treat each tool as a clean interface boundary (a "driver"): telemetry source,
  config store, process controller, power controller. The C++ version swaps the
  *implementation* behind each; keep the *contract* explicit and minimal.
- Replace screen-scraping with structured field access (CSV query mode) so the
  data model already matches what NVML returns.
- Make the perceive/plan/act/reflect phases pure-data-in, pure-data-out where
  possible (a plan is a serializable list of intended changes). That plan object
  is exactly what the C++ rule engine will produce and consume.
- Centralize the "do-not-touch" process allowlist and the tier-classification
  thresholds as data/config, not inline literals — easier to port and to tune.

---

## 7. Communication preference of the owner (for the agent's responses)
Direct, low-fluff. Explain commands/concepts when introducing them (owner
pattern-matches from a strong C++ background but is newer to the TS/Node web
ecosystem). No inflated claims, no fabricated metrics.
