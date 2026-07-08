// core/config.ts — centralized tunables, allowlists, and environment.
//
// Kept as plain data (no logic) so the eventual C++ port can consume the
// same values, and so tuning never requires touching engine code.

import { GpuStats, GpuTier } from "./types";

// ---- Environment ----

export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.NVPILOT_MODEL || "nemotron-mini";
export const OLLAMA_TIMEOUT_MS = 15_000;

// ---- Daemon timing ----

export const POLL_MS_DEFAULT = 2_000;      // foreground app poll interval
export const DEBOUNCE_MS = 5_000;          // app change must hold this long before acting
export const REEVALUATE_MS = 60_000;       // re-perceive while a plan is active

// ---- Process allowlists ----
// Background apps most users don't need while gaming. The agent only ever
// closes processes from this list, never anything else, and only with
// --allow-close. Discord deliberately excluded (owner decision).

export const SAFE_TO_SUSPEND: string[] = [
  "slack",
  "obsidian",
  "multipass",
  "claude",
  "word",
  "teams",
  "spotify",
  "chrome",
  "msedge",
  "firefox",
  "wallpaper32", // Wallpaper Engine
  "icloudphotos",
  "onedrive",
  "dropbox",
  "docker desktop",
  "creative cloud",
  "adobenotification",
  "linkedin",
  "telegram",
  "whatsapp",
];

// Processes we must NEVER touch, even if they use resources.
export const NEVER_TOUCH: string[] = [
  "system",
  "svchost",
  "csrss",
  "wininit",
  "services",
  "lsass",
  "explorer",     // Windows shell
  "dwm",          // Desktop Window Manager
  "antimalware",
  "msmpeng",      // Windows Defender
  "securityapp",
  "nvidia",       // GPU drivers
  "amd",
  // Linux equivalents
  "systemd",
  "xorg",
  "wayland",
  "gnome-shell",
  "kwin",
  "pulseaudio",
  "pipewire",
];

// Only flag suspendable processes above this working-set size.
export const SUSPENDABLE_MIN_MB = 50;

// Only propose closing background apps when total reclaimable exceeds this.
export const RECLAIM_THRESHOLD_MB = 200;

// ---- GPU tier classification ----
// Tier-relative reasoning is the core design principle: a setting's cost is
// hardware-specific, so thresholds are keyed by tier, never absolute.

export function classifyGpuTier(gpu: GpuStats | null): GpuTier {
  if (!gpu) return "low"; // no telemetry: assume constrained hardware
  const vram = gpu.memoryTotalMiB;
  if (vram <= 4096) return "low";   // GTX 1050, 1650, ...
  if (vram <= 6144) return "mid";   // RTX 3060 Laptop, 2060, ...
  if (vram <= 8192) return "high";  // RTX 3070, 4060, ...
  return "ultra";                   // 12GB+
}
