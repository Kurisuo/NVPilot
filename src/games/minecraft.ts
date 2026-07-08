// games/minecraft.ts — Minecraft Java Edition adapter.
//
// Config store reads/writes options.txt directly — no hardware hacking,
// just the game's own config file. Fully reversible via backup/restore.
// Note: Minecraft reads options.txt at launch, so changes made while the
// game is running take effect on next restart.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ActionResult, GpuTier, JsonValue } from "../core/types";
import { GameConfigStore } from "../drivers/interfaces";
import { GameAdapter, SettingSpec, TierTarget } from "./adapter";

// ---- Paths (per-platform) ----

function minecraftDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || "", ".minecraft");
  }
  return join(homedir(), ".minecraft");
}

// ---- Setting schema ----
// Types + legal ranges are also what the LLM validator clamps against.

const impactConst = (v: "none" | "minimal" | "noticeable" | "significant") => () => v;

const SETTINGS: SettingSpec[] = [
  {
    key: "renderDistance", type: "number", min: 2, max: 32, weight: 10,
    visualImpact: (from, to) => {
      const diff = Math.abs((from as number) - (to as number));
      if (diff <= 4) return "minimal";
      if (diff <= 8) return "noticeable";
      return "significant";
    },
    describe: (from, to, tier) =>
      `Render distance ${from} exceeds the recommended range for a ${tier}-tier GPU. ` +
      `It is the single most expensive setting; reducing to ${to} reclaims render cost ` +
      `with limited visual difference at normal play distances.`,
  },
  {
    key: "simulationDistance", type: "number", min: 5, max: 32, weight: 6,
    visualImpact: impactConst("none"),
    describe: (from, to, tier) =>
      `Simulation distance ${from} is above the ${tier}-tier cap. It controls entity AI ` +
      `and redstone processing range — reducing to ${to} has zero visual impact but frees CPU cycles.`,
  },
  {
    key: "ao", type: "boolean", weight: 3,
    visualImpact: impactConst("minimal"),
    describe: (_f, _t, tier) =>
      `Ambient occlusion adds subtle shadow gradients. On a ${tier}-tier GPU the cost ` +
      `isn't justified — the difference is hard to notice during gameplay.`,
  },
  {
    key: "entityShadows", type: "boolean", weight: 2,
    visualImpact: impactConst("minimal"),
    describe: () =>
      `Entity shadows (small shadows under mobs/players) carry a render cost most players don't notice.`,
  },
  {
    key: "mipmapLevels", type: "number", min: 0, max: 4, weight: 2,
    visualImpact: impactConst("minimal"),
    describe: (from, to) =>
      `Mipmap smooths distant textures. Reducing from ${from} to ${to} has almost no visible difference.`,
  },
  {
    key: "renderClouds", type: "enum", enumValues: ["false", "fast", "true"], weight: 2,
    visualImpact: (_f, to) => (to === "false" ? "noticeable" : "minimal"),
    describe: (from, to) =>
      to === "fast"
        ? `Fast clouds are 2D instead of 3D — a subtle difference unless you're staring at the sky.`
        : `Disabling clouds (currently ${from}) is noticeable but a reasonable trade on constrained hardware.`,
  },
  {
    key: "cloudRange", type: "number", min: 32, max: 256, weight: 1,
    visualImpact: impactConst("none"),
    describe: (from, to) =>
      `Cloud render range ${from} is higher than needed; ${to} is invisible in practice.`,
  },
  {
    key: "biomeBlendRadius", type: "number", min: 0, max: 7, weight: 1,
    visualImpact: impactConst("minimal"),
    describe: (from, to) =>
      `Biome blend controls color transitions between biomes. Reducing from ${from} to ${to} is virtually invisible.`,
  },
  {
    // 0 = all, 1 = decreased, 2 = minimal — LOWER value costs more.
    key: "particles", type: "number", min: 0, max: 2, lowerIsCostlier: true, weight: 2,
    visualImpact: impactConst("minimal"),
    describe: () => `Most particles are decorative; reducing the particle level trims render cost.`,
  },
  {
    key: "cutoutLeaves", type: "boolean", weight: 1,
    visualImpact: impactConst("minimal"),
    describe: () => `Solid leaves render faster than transparent leaves. Minor visual change.`,
  },
];

// ---- Tier-relative targets ----
// Not a "low preset": per-setting sweet spots where cost outweighs visual
// benefit for that hardware class. (Empirically exercised on one RTX 3060
// Laptop machine; treat as designed defaults, not benchmarks.)

const TIER_TARGETS: Record<GpuTier, Record<string, TierTarget>> = {
  low: {
    renderDistance: { ideal: 8, max: 12 },
    simulationDistance: { ideal: 5, max: 8 },
    ao: { ideal: false },
    entityShadows: { ideal: false },
    mipmapLevels: { ideal: 0 },
    renderClouds: { ideal: "false" },
    cloudRange: { ideal: 64 },
    biomeBlendRadius: { ideal: 0 },
    particles: { ideal: 2 },
    cutoutLeaves: { ideal: false },
  },
  mid: {
    renderDistance: { ideal: 14, max: 18 },
    simulationDistance: { ideal: 8, max: 12 },
    ao: { ideal: true },
    entityShadows: { ideal: false },
    mipmapLevels: { ideal: 2 },
    renderClouds: { ideal: "fast" },
    cloudRange: { ideal: 96 },
    biomeBlendRadius: { ideal: 3 },
    particles: { ideal: 1 },
    cutoutLeaves: { ideal: false },
  },
  high: {
    renderDistance: { ideal: 18, max: 24 },
    simulationDistance: { ideal: 12, max: 12 },
    ao: { ideal: true },
    entityShadows: { ideal: true },
    mipmapLevels: { ideal: 4 },
    renderClouds: { ideal: "true" },
    cloudRange: { ideal: 128 },
    biomeBlendRadius: { ideal: 5 },
    particles: { ideal: 0 },
    cutoutLeaves: { ideal: true },
  },
  ultra: {
    renderDistance: { ideal: 24, max: 32 },
    simulationDistance: { ideal: 12, max: 16 },
    ao: { ideal: true },
    entityShadows: { ideal: true },
    mipmapLevels: { ideal: 4 },
    renderClouds: { ideal: "true" },
    cloudRange: { ideal: 192 },
    biomeBlendRadius: { ideal: 7 },
    particles: { ideal: 0 },
    cutoutLeaves: { ideal: true },
  },
};

// ---- Config store ----

const QUOTED_KEYS = new Set(["renderClouds", "graphicsPreset"]);

class MinecraftConfigStore implements GameConfigStore {
  private optionsPath = join(minecraftDir(), "options.txt");
  private backupPath = join(minecraftDir(), "options.txt.backup");

  async exists(): Promise<boolean> {
    return existsSync(this.optionsPath);
  }

  async read(): Promise<Record<string, JsonValue>> {
    let content: string;
    try {
      content = readFileSync(this.optionsPath, "utf-8");
    } catch {
      return {};
    }

    // options.txt is "key:value" per line; values may contain colons, so
    // split on the FIRST colon only. Strip \r (Windows line endings broke
    // boolean comparisons before — keep this).
    const raw = new Map<string, string>();
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      raw.set(line.substring(0, idx), line.substring(idx + 1).replace(/\r/g, ""));
    }

    // Convert the settings we care about to typed values per the schema.
    const result: Record<string, JsonValue> = {};
    for (const spec of SETTINGS) {
      const val = raw.get(spec.key);
      if (val === undefined) continue;
      const unquoted = val.replace(/"/g, "");
      switch (spec.type) {
        case "number": {
          const n = parseFloat(unquoted);
          if (Number.isFinite(n)) result[spec.key] = n;
          break;
        }
        case "boolean":
          result[spec.key] = unquoted === "true";
          break;
        case "enum":
          result[spec.key] = unquoted;
          break;
      }
    }
    return result;
  }

  async backup(): Promise<ActionResult> {
    if (!existsSync(this.optionsPath)) {
      return { ok: false, message: `options.txt not found at ${this.optionsPath}` };
    }
    try {
      copyFileSync(this.optionsPath, this.backupPath);
      return { ok: true, message: `Backup saved to ${this.backupPath}` };
    } catch (err) {
      return { ok: false, message: `Backup failed: ${err}` };
    }
  }

  async write(changes: Record<string, JsonValue>): Promise<ActionResult> {
    if (!existsSync(this.optionsPath)) {
      return { ok: false, message: `options.txt not found at ${this.optionsPath}` };
    }
    try {
      let content = readFileSync(this.optionsPath, "utf-8");
      const applied: string[] = [];
      for (const [key, value] of Object.entries(changes)) {
        const serialized = QUOTED_KEYS.has(key) ? `"${value}"` : String(value);
        const regex = new RegExp(`^${key}:.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${key}:${serialized}`);
          applied.push(`${key} → ${serialized}`);
        }
      }
      writeFileSync(this.optionsPath, content, "utf-8");
      return { ok: true, message: `Modified ${applied.length} settings: ${applied.join(", ")}` };
    } catch (err) {
      return { ok: false, message: `Write failed: ${err}` };
    }
  }

  async restore(): Promise<ActionResult> {
    if (!existsSync(this.backupPath)) {
      return { ok: false, message: `No backup found at ${this.backupPath}` };
    }
    try {
      copyFileSync(this.backupPath, this.optionsPath);
      return { ok: true, message: "Restored options.txt from backup" };
    } catch (err) {
      return { ok: false, message: `Restore failed: ${err}` };
    }
  }
}

// ---- Adapter ----

export const minecraftAdapter: GameAdapter = {
  id: "minecraft",
  displayName: "Minecraft Java Edition",
  processNames: ["minecraft", "javaw", "java"],
  configStore: new MinecraftConfigStore(),
  settings: SETTINGS,
  tierTargets: TIER_TARGETS,
};
