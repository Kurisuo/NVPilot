# NVPilot

NVPilot is like personalized medicine for your PC. Just like a doctor doesn't prescribe the same treatment to every patient, NVPilot doesn't apply the same settings to every machine — it reads your specific hardware, figures out what's actually holding your system back, and prescribes the exact optimizations your machine needs for whatever you're running. Instead of nerfing your graphics like a one-size-fits-all preset, it identifies which settings are genuinely costing you performance on your GPU specifically, changes only those, and preserves everything else at full quality. It handles the full system: background apps eating your RAM, process priority, power plans, and game configs — all reasoned about together, not in isolation.

---

## Requirements

- Node.js v24+
- TypeScript (installed via `npm install`)
- NVIDIA GPU with drivers installed (`nvidia-smi` must be accessible in terminal)
- Windows 10/11 (current version — Linux support planned)
- Minecraft Java Edition (for game config optimization)

---

## Setup

```bash
git clone https://github.com/Kurisuo/NVPilot.git
cd NVPilot
npm install
```

---

## Running

### Standalone (no NemoClaw, no Docker)

Analyze your system and see recommendations without changing anything:

```bash
npx ts-node src/demo.ts
```

Apply all recommended optimizations:

```bash
npx ts-node src/demo.ts --apply
```

Restore your original settings:

```bash
npx ts-node src/demo.ts --restore
```

> Docker is not required for the standalone version. NemoClaw and Ollama features are not active in this mode.

---

### With NemoClaw + Ollama (full agent mode)

> Requires Docker and a NemoClaw-compatible environment (DGX Spark or local Docker setup).
> Setup instructions coming soon.

---

## What it does

| Layer | What NVPilot reads | What NVPilot changes |
|---|---|---|
| GPU | Utilization, VRAM, temp, power draw | — |
| Game | Current graphics settings | Render distance, shadows, clouds, mipmaps, particles |
| System | Running processes, memory usage | Process priority, background app cleanup |
| Power | Active Windows power plan | Switches to performance mode if needed |

---

## Project Status

- [x] GPU telemetry via `nvidia-smi`
- [x] Minecraft config reader/writer
- [x] GPU-tier-aware optimization engine
- [x] System-level optimizer (power plans, process priority, background apps)
- [ ] NemoClaw + Ollama agent integration (in progress)
- [ ] Multi-game support beyond Minecraft
- [ ] C++ rewrite using NVML and Windows API (planned)

---

## Built With

- TypeScript / Node.js
- NVIDIA System Management Interface (`nvidia-smi`)
- Windows PowerShell APIs
- NemoClaw + OpenClaw (agent runtime, coming soon)
- Ollama + Nemotron (local inference, coming soon)

---

*Built at the NemoClaw NVIDIA x ASUS Hackathon — UC Santa Cruz, May 2026*
