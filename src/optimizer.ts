// optimizer.ts — Tool #3: The agent's decision-making brain
//
// This file takes GPU stats + current Minecraft settings and
// AUTONOMOUSLY decides what to change and why.
//
// No manual benchmarking. No user input. The agent figures it out.
//
// At the hackathon: the LLM (Nemotron) replaces this logic.
// Right now: rule-based reasoning that simulates what the LLM would do.
//
// The key insight: different GPUs have different budgets.
// A setting that's fine on an RTX 4090 is a problem on a GTX 1050.
// The optimizer matches settings to YOUR hardware.

import { GpuStats } from "./gpu-stats";
import { MinecraftPerformanceSettings } from "./minecraft-config";

// ---- TYPES ----

// One proposed change with reasoning attached.
// The agent doesn't just change things — it explains WHY.
// This is what makes the demo compelling.
export interface ProposedChange {
  setting: string;              // which setting to change
  currentValue: string | number | boolean;
  proposedValue: string | number | boolean;
  estimatedFpsGain: number;     // rough estimate based on GPU tier
  visualImpact: "none" | "minimal" | "noticeable" | "significant";
  reason: string;               // human-readable explanation
}

// The full optimization report.
export interface OptimizationReport {
  gpuTier: "low" | "mid" | "high" | "ultra";  // classified from GPU stats
  currentSettingsScore: number;  // 0-100, how appropriate settings are for this GPU
  proposedChanges: ProposedChange[];
  estimatedTotalFpsGain: number;
  summary: string;               // one-paragraph explanation
  keptSettings: string[];        // what we DIDN'T change and why — the "surgical" angle
}

// ---- GPU TIER CLASSIFICATION ----
// Classify the GPU into a tier based on VRAM and name.
// This is simplified — the LLM will do this more intelligently on Friday.
//
// Why tiers? Because "render distance 29" means different things
// on different GPUs. Tiers let us set appropriate thresholds.

function classifyGpuTier(gpu: GpuStats): "low" | "mid" | "high" | "ultra" {
  const vram = gpu.memoryTotalMiB;
  const name = gpu.name.toLowerCase();

  // Check by VRAM first (most reliable signal)
  // Then refine by name if needed
  if (vram <= 4096) return "low";       // 4GB or less: GTX 1050, 1650, etc.
  if (vram <= 6144) {                    // 6GB: could be mid or high
    if (name.includes("3060") || name.includes("2060")) return "mid";
    return "mid";
  }
  if (vram <= 8192) return "high";       // 8GB: RTX 3070, 4060, etc.
  return "ultra";                        // 12GB+: RTX 3080, 4070+, 4090
}

// ---- TARGET SETTINGS PER TIER ----
// What each setting SHOULD be for each GPU tier.
// These aren't "low preset" — they're the sweet spot
// where visual quality is high but FPS cost is reasonable.
//
// The key: we're NOT setting everything to minimum.
// We're finding the per-setting value where cost > visual benefit.

interface TierTargets {
  renderDistance: { max: number; ideal: number };
  simulationDistance: { max: number; ideal: number };
  ao: boolean;
  entityShadows: boolean;
  mipmapLevels: number;
  renderClouds: string;
  cloudRange: number;
  biomeBlendRadius: number;
  particles: number;
  cutoutLeaves: boolean;
}

const TIER_TARGETS: Record<string, TierTargets> = {
  low: {
    renderDistance: { max: 12, ideal: 8 },
    simulationDistance: { max: 8, ideal: 5 },
    ao: false,
    entityShadows: false,
    mipmapLevels: 0,
    renderClouds: "false",
    cloudRange: 64,
    biomeBlendRadius: 0,
    particles: 2,   // minimal
    cutoutLeaves: false,
  },
  mid: {
    renderDistance: { max: 18, ideal: 14 },
    simulationDistance: { max: 12, ideal: 8 },
    ao: true,
    entityShadows: false,
    mipmapLevels: 2,
    renderClouds: "fast",
    cloudRange: 96,
    biomeBlendRadius: 3,
    particles: 1,   // decreased
    cutoutLeaves: false,
  },
  high: {
    renderDistance: { max: 24, ideal: 18 },
    simulationDistance: { max: 12, ideal: 12 },
    ao: true,
    entityShadows: true,
    mipmapLevels: 4,
    renderClouds: "true",
    cloudRange: 128,
    biomeBlendRadius: 5,
    particles: 0,   // all
    cutoutLeaves: true,
  },
  ultra: {
    renderDistance: { max: 32, ideal: 24 },
    simulationDistance: { max: 16, ideal: 12 },
    ao: true,
    entityShadows: true,
    mipmapLevels: 4,
    renderClouds: "true",
    cloudRange: 192,
    biomeBlendRadius: 7,
    particles: 0,
    cutoutLeaves: true,
  },
};

// ---- ESTIMATED FPS COST PER SETTING ----
// Rough estimates of FPS cost per "unit" of each setting.
// These are approximations — the LLM will reason more flexibly on Friday.
// But they're based on general Minecraft performance characteristics:
//   - Render distance is the single most expensive setting
//   - Simulation distance is second
//   - Everything else is relatively cheap

// Returns estimated FPS gained by changing a setting from one value to another.
// Positive = FPS improvement. Negative = FPS loss.
function estimateFpsGain(
  setting: string,
  currentVal: number | boolean | string,
  proposedVal: number | boolean | string,
  tier: string
): number {
  // Scale factor: lower-tier GPUs benefit MORE from the same change
  // because they're more bottlenecked
  const tierScale: Record<string, number> = {
    low: 1.5,
    mid: 1.0,
    high: 0.7,
    ultra: 0.4,
  };
  const scale = tierScale[tier] || 1.0;

  switch (setting) {
    case "renderDistance": {
      // ~2 FPS per chunk of render distance on a mid-tier GPU
      const diff = (currentVal as number) - (proposedVal as number);
      return Math.round(diff * 2.0 * scale);
    }
    case "simulationDistance": {
      const diff = (currentVal as number) - (proposedVal as number);
      return Math.round(diff * 1.2 * scale);
    }
    case "ao":
      return (currentVal === true && proposedVal === false) ? Math.round(5 * scale) : 0;
    case "entityShadows":
      return (currentVal === true && proposedVal === false) ? Math.round(3 * scale) : 0;
    case "mipmapLevels": {
      const diff = (currentVal as number) - (proposedVal as number);
      return Math.round(diff * 1.0 * scale);
    }
    case "renderClouds": {
      if (currentVal === "true" && proposedVal === "fast") return Math.round(3 * scale);
      if (currentVal === "true" && proposedVal === "false") return Math.round(5 * scale);
      if (currentVal === "fast" && proposedVal === "false") return Math.round(2 * scale);
      return 0;
    }
    case "biomeBlendRadius": {
      const diff = (currentVal as number) - (proposedVal as number);
      return Math.round(diff * 0.5 * scale);
    }
    case "particles": {
      const diff = (proposedVal as number) - (currentVal as number);
      return Math.round(diff * 2 * scale);
    }
    case "cutoutLeaves":
      return (currentVal === true && proposedVal === false) ? Math.round(2 * scale) : 0;
    case "cloudRange": {
      const diff = (currentVal as number) - (proposedVal as number);
      return Math.round(diff * 0.03 * scale);
    }
    default:
      return 0;
  }
}

// ---- VISUAL IMPACT ASSESSMENT ----
// How much does the player NOTICE this change?
// This is the surgical angle — we prioritize changes with
// high FPS gain and LOW visual impact.

function assessVisualImpact(
  setting: string,
  currentVal: number | boolean | string,
  proposedVal: number | boolean | string
): "none" | "minimal" | "noticeable" | "significant" {
  switch (setting) {
    case "renderDistance": {
      const diff = Math.abs((currentVal as number) - (proposedVal as number));
      if (diff <= 4) return "minimal";
      if (diff <= 8) return "noticeable";
      return "significant";
    }
    case "simulationDistance":
      return "none"; // player rarely notices this
    case "ao":
      return "minimal"; // subtle shadow difference
    case "entityShadows":
      return "minimal";
    case "mipmapLevels":
      return "minimal"; // only visible at distance
    case "renderClouds":
      if (proposedVal === "false") return "noticeable";
      return "minimal"; // fast vs fancy is subtle
    case "biomeBlendRadius":
      return "minimal"; // edge blending, rarely noticed
    case "particles":
      return "minimal";
    case "cutoutLeaves":
      return "minimal";
    case "cloudRange":
      return "none";
    default:
      return "minimal";
  }
}

// ---- THE MAIN OPTIMIZER ----
// This is the function the agent calls.
// Input: GPU stats + current Minecraft settings
// Output: a full optimization report with proposed changes and reasoning

export function optimize(
  gpu: GpuStats,
  settings: MinecraftPerformanceSettings
): OptimizationReport {
  const tier = classifyGpuTier(gpu);
  const targets = TIER_TARGETS[tier];
  const changes: ProposedChange[] = [];
  const kept: string[] = [];

  // --- Evaluate each setting ---

  // Render Distance
  if (settings.renderDistance > targets.renderDistance.max) {
    changes.push({
      setting: "renderDistance",
      currentValue: settings.renderDistance,
      proposedValue: targets.renderDistance.ideal,
      estimatedFpsGain: estimateFpsGain("renderDistance", settings.renderDistance, targets.renderDistance.ideal, tier),
      visualImpact: assessVisualImpact("renderDistance", settings.renderDistance, targets.renderDistance.ideal),
      reason: `Render distance ${settings.renderDistance} exceeds the recommended max of ${targets.renderDistance.max} for a ${tier}-tier GPU (${gpu.name}). Each chunk of render distance costs ~${(2 * (TIER_TARGETS[tier] === TIER_TARGETS.low ? 1.5 : 1.0)).toFixed(1)} FPS on your hardware. Reducing to ${targets.renderDistance.ideal} reclaims significant FPS with ${settings.renderDistance - targets.renderDistance.ideal > 8 ? "noticeable" : "minimal"} visual difference at normal play distances.`,
    });
  } else {
    kept.push(`renderDistance (${settings.renderDistance}) — within budget for ${tier}-tier GPU`);
  }

  // Simulation Distance
  if (settings.simulationDistance > targets.simulationDistance.max) {
    changes.push({
      setting: "simulationDistance",
      currentValue: settings.simulationDistance,
      proposedValue: targets.simulationDistance.ideal,
      estimatedFpsGain: estimateFpsGain("simulationDistance", settings.simulationDistance, targets.simulationDistance.ideal, tier),
      visualImpact: "none",
      reason: `Simulation distance ${settings.simulationDistance} is above the ${targets.simulationDistance.max} cap for ${tier}-tier. This controls entity AI and redstone processing range — reducing it has zero visual impact but frees CPU cycles.`,
    });
  } else {
    kept.push(`simulationDistance (${settings.simulationDistance}) — within budget`);
  }

  // Ambient Occlusion
  if (settings.ao && !targets.ao) {
    changes.push({
      setting: "ao",
      currentValue: true,
      proposedValue: false,
      estimatedFpsGain: estimateFpsGain("ao", true, false, tier),
      visualImpact: "minimal",
      reason: `Ambient occlusion adds subtle shadow gradients. On a ${tier}-tier GPU, the ~${Math.round(5 * (tier === "low" ? 1.5 : 1.0))} FPS cost isn't justified — the visual difference is hard to notice during gameplay.`,
    });
  } else if (settings.ao) {
    kept.push("ao (on) — your GPU handles this fine");
  }

  // Entity Shadows
  if (settings.entityShadows && !targets.entityShadows) {
    changes.push({
      setting: "entityShadows",
      currentValue: true,
      proposedValue: false,
      estimatedFpsGain: estimateFpsGain("entityShadows", true, false, tier),
      visualImpact: "minimal",
      reason: `Entity shadows (small shadows under mobs/players) cost ~${Math.round(3 * (tier === "low" ? 1.5 : 1.0))} FPS. Most players don't notice their absence.`,
    });
  } else if (settings.entityShadows) {
    kept.push("entityShadows (on) — affordable on your GPU");
  }

  // Mipmap Levels
  if (settings.mipmapLevels > targets.mipmapLevels) {
    changes.push({
      setting: "mipmapLevels",
      currentValue: settings.mipmapLevels,
      proposedValue: targets.mipmapLevels,
      estimatedFpsGain: estimateFpsGain("mipmapLevels", settings.mipmapLevels, targets.mipmapLevels, tier),
      visualImpact: "minimal",
      reason: `Mipmap smooths distant textures. Reducing from ${settings.mipmapLevels} to ${targets.mipmapLevels} saves ~${Math.round((settings.mipmapLevels - targets.mipmapLevels) * 1.0)} FPS with almost no visible difference.`,
    });
  } else {
    kept.push(`mipmapLevels (${settings.mipmapLevels}) — within budget`);
  }

  // Clouds
  const cloudTarget = targets.renderClouds;
  if (settings.renderClouds === "true" && cloudTarget !== "true") {
    changes.push({
      setting: "renderClouds",
      currentValue: settings.renderClouds,
      proposedValue: cloudTarget,
      estimatedFpsGain: estimateFpsGain("renderClouds", settings.renderClouds, cloudTarget, tier),
      visualImpact: cloudTarget === "false" ? "noticeable" : "minimal",
      reason: cloudTarget === "fast"
        ? `Switching clouds from Fancy to Fast saves ~${Math.round(3 * (tier === "low" ? 1.5 : 1.0))} FPS. Fast clouds are 2D instead of 3D — subtle difference unless you're staring at the sky.`
        : `Disabling clouds saves ~${Math.round(5 * (tier === "low" ? 1.5 : 1.0))} FPS. Noticeable but a good trade-off on ${tier}-tier hardware.`,
    });
  } else {
    kept.push(`renderClouds (${settings.renderClouds}) — appropriate for your GPU`);
  }

  // Biome Blend
  if (settings.biomeBlendRadius > targets.biomeBlendRadius) {
    changes.push({
      setting: "biomeBlendRadius",
      currentValue: settings.biomeBlendRadius,
      proposedValue: targets.biomeBlendRadius,
      estimatedFpsGain: estimateFpsGain("biomeBlendRadius", settings.biomeBlendRadius, targets.biomeBlendRadius, tier),
      visualImpact: "minimal",
      reason: `Biome blend radius controls color transitions between biomes. Reducing from ${settings.biomeBlendRadius} to ${targets.biomeBlendRadius} is virtually invisible.`,
    });
  } else {
    kept.push(`biomeBlendRadius (${settings.biomeBlendRadius}) — within budget`);
  }

  // Particles
  if (settings.particles < targets.particles) {
    changes.push({
      setting: "particles",
      currentValue: settings.particles,
      proposedValue: targets.particles,
      estimatedFpsGain: estimateFpsGain("particles", settings.particles, targets.particles, tier),
      visualImpact: "minimal",
      reason: `Reducing particle level from ${settings.particles === 0 ? "All" : "Decreased"} to ${targets.particles === 2 ? "Minimal" : "Decreased"} saves a few FPS. Most particles are decorative.`,
    });
  } else {
    kept.push(`particles (${settings.particles}) — already optimal`);
  }

  // Fancy Leaves
  if (settings.cutoutLeaves && !targets.cutoutLeaves) {
    changes.push({
      setting: "cutoutLeaves",
      currentValue: true,
      proposedValue: false,
      estimatedFpsGain: estimateFpsGain("cutoutLeaves", true, false, tier),
      visualImpact: "minimal",
      reason: "Solid leaves render faster than transparent leaves. Minor visual change, minor FPS gain.",
    });
  } else if (settings.cutoutLeaves) {
    kept.push("cutoutLeaves (on) — your GPU handles this");
  }

  // Cloud Range
  if (settings.cloudRange > targets.cloudRange) {
    changes.push({
      setting: "cloudRange",
      currentValue: settings.cloudRange,
      proposedValue: targets.cloudRange,
      estimatedFpsGain: estimateFpsGain("cloudRange", settings.cloudRange, targets.cloudRange, tier),
      visualImpact: "none",
      reason: `Cloud render range ${settings.cloudRange} is higher than needed for ${tier}-tier. Reducing to ${targets.cloudRange} is invisible in practice.`,
    });
  } else {
    kept.push(`cloudRange (${settings.cloudRange}) — fine`);
  }

  // ---- SORT by FPS gain (biggest wins first) ----
  changes.sort((a, b) => b.estimatedFpsGain - a.estimatedFpsGain);

  // ---- CALCULATE TOTALS ----
  const totalFpsGain = changes.reduce((sum, c) => sum + c.estimatedFpsGain, 0);

  // Score: how appropriate are current settings for this GPU? (0-100)
  // 100 = perfectly tuned, 0 = wildly misconfigured
  const maxPossibleGain = 80; // rough ceiling
  const score = Math.max(0, Math.round(100 - (totalFpsGain / maxPossibleGain) * 100));

  // ---- BUILD SUMMARY ----
  const summary = changes.length === 0
    ? `Your settings are well-matched to your ${gpu.name}. No changes recommended.`
    : `Your ${gpu.name} (${tier}-tier, ${gpu.memoryTotalMiB}MiB VRAM) is running ${changes.length} settings above its optimal range. ` +
      `The biggest issue is ${changes[0].setting} (currently ${changes[0].currentValue}, recommended ${changes[0].proposedValue}). ` +
      `Applying all ${changes.length} changes would gain an estimated ~${totalFpsGain} FPS ` +
      `while preserving ${kept.length} settings at their current quality level. ` +
      `Visual impact of changes: ${changes.filter(c => c.visualImpact === "none" || c.visualImpact === "minimal").length} of ${changes.length} changes have minimal or no visual impact.`;

  return {
    gpuTier: tier,
    currentSettingsScore: score,
    proposedChanges: changes,
    estimatedTotalFpsGain: totalFpsGain,
    summary,
    keptSettings: kept,
  };
}