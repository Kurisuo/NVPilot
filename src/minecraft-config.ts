// This file does three things:
//   1. Reads Minecraft's options.txt into a structured object
//   2. Lets the agent modify specific settings
//   3. Writes the changes back to the file

// WHY: This is how the agent "tunes" the game. No hardware hacking,
// no driver manipulation — just editing the game's own config file.
// Safe, reversible, and effective.

// ---- IMPORTS ----
// "fs" = file system. Built-in Node.js module for reading/writing files.
// readFileSync  = read a file's contents into a string
// writeFileSync = write a string to a file
// copyFileSync  = copy a file (we use this for backups)
// existsSync    = check if a file exists

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { join } from "path";

// "path" module helps build file paths that work on any OS.
// join("folder", "file.txt") = "folder/file.txt" on Mac, "folder\file.txt" on Windows

// ---- TYPES ----

// The settings the agent cares about for performance tuning.
// We don't need ALL of Minecraft's settings — just the ones that meaningfully affect FPS.

export interface MinecraftPerformanceSettings {
  renderDistance: number;        // 2-32, biggest FPS impact
  simulationDistance: number;    // 5-32, affects entity processing
  maxFps: number;               // framerate cap
  enableVsync: boolean;         // locks FPS to monitor refresh rate
  graphicsPreset: string;       // "fast", "fancy", "custom"
  ao: boolean;                  // ambient occlusion (smooth lighting)
  entityDistanceScaling: number;// 0.5-5.0, how far entities render
  entityShadows: boolean;       // shadows under entities
  mipmapLevels: number;         // 0-4, texture smoothing at distance
  renderClouds: string;         // "true", "false", or "fast"
  cloudRange: number;           // how far clouds render
  particles: number;            // 0=all, 1=decreased, 2=minimal
  biomeBlendRadius: number;     // 0-7, biome color blending
  cutoutLeaves: boolean;        // fancy vs fast leaves
  improvedTransparency: boolean;// fabulous graphics transparency
  fullscreen: boolean;          // fullscreen mode
}

// ---- CONFIGURATION ----

// Build the path to Minecraft's options.txt
// On Windows: C:\Users\<you>\AppData\Roaming\.minecraft\options.txt
// process.env.APPDATA gives us the AppData\Roaming folder

const MINECRAFT_DIR = join(process.env.APPDATA || "", ".minecraft");
const OPTIONS_PATH = join(MINECRAFT_DIR, "options.txt");
const BACKUP_PATH = join(MINECRAFT_DIR, "options.txt.backup");

// ---- CORE FUNCTIONS ----

// readAllSettings():
// Reads the ENTIRE options.txt file and returns it as a
// key-value map (like a dictionary in Python, or std::map in C++).

function readAllSettings(): Map<string, string> {
  const content = readFileSync(OPTIONS_PATH, "utf-8");
  // "utf-8" tells Node how to decode the bytes into text

  const settings = new Map<string, string>();

  // Split the file into lines, process each one
  const lines = content.split("\n");
  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Split on the FIRST colon only.
    // We use indexOf instead of split because some values contain colons
  
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue; // no colon = skip

    const key = line.substring(0, colonIndex);
    const value = line.substring(colonIndex + 1).replace(/\r/g, "");
    settings.set(key, value);
  }

  return settings;
}

// getPerformanceSettings():
// Reads the full file, then extracts ONLY the settings that matter for performance tuning.
// Returns a clean typed object the agent can reason about.

export function getPerformanceSettings(): MinecraftPerformanceSettings {
  const all = readAllSettings();

  // Helper: get a value or use a default if missing
  // The "!" after .get() tells TypeScript "I know this won't be undefined but we provide fallbacks with || just in case
  return {
    renderDistance: parseInt(all.get("renderDistance") || "12"),
    simulationDistance: parseInt(all.get("simulationDistance") || "12"),
    maxFps: parseInt(all.get("maxFps") || "120"),
    enableVsync: all.get("enableVsync") === "true",
    graphicsPreset: (all.get("graphicsPreset") || "fancy").replace(/"/g, ""),
    // .replace(/"/g, "") strips quotes — Minecraft stores some values as "quoted strings"
    ao: all.get("ao") === "true",
    entityDistanceScaling: parseFloat(all.get("entityDistanceScaling") || "1.0"),
    entityShadows: all.get("entityShadows") === "true",
    mipmapLevels: parseInt(all.get("mipmapLevels") || "4"),
    renderClouds: (all.get("renderClouds") || "true").replace(/"/g, ""),
    cloudRange: parseInt(all.get("cloudRange") || "128"),
    particles: parseInt(all.get("particles") || "0"),
    biomeBlendRadius: parseInt(all.get("biomeBlendRadius") || "2"),
    cutoutLeaves: all.get("cutoutLeaves") === "true",
    improvedTransparency: all.get("improvedTransparency") === "false" ? false : true,
    fullscreen: all.get("fullscreen") === "true",
  };
}

// backupConfig():
// ALWAYS back up before modifying. If the agent breaks something,
// one command restores the original. This is a safety net.

export function backupConfig(): string {
  if (!existsSync(OPTIONS_PATH)) {
    return "ERROR: options.txt not found at " + OPTIONS_PATH;
  }
  copyFileSync(OPTIONS_PATH, BACKUP_PATH);
  return "Backup saved to " + BACKUP_PATH;
}

// restoreConfig():
// Undo everything. Copy the backup over the current file.

export function restoreConfig(): string {
  if (!existsSync(BACKUP_PATH)) {
    return "ERROR: No backup found at " + BACKUP_PATH;
  }
  copyFileSync(BACKUP_PATH, OPTIONS_PATH);
  return "Restored from backup.";
}

// modifySettings():
// Takes a partial set of changes and applies them to options.txt.
//
// "Partial<MinecraftPerformanceSettings>" means: an object with
// SOME of the fields from MinecraftPerformanceSettings.
// The agent might only want to change renderDistance and ao,
// leaving everything else untouched.

export function modifySettings(changes: Partial<MinecraftPerformanceSettings>): string {
  if (!existsSync(OPTIONS_PATH)) {
    return "ERROR: options.txt not found";
  }

  // Read the raw file content
  let content = readFileSync(OPTIONS_PATH, "utf-8");

  // Build a map of setting-name → new-value-as-string
  // We need to convert our typed values back to the format Minecraft expects
  const updates: Record<string, string> = {};

  if (changes.renderDistance !== undefined) updates["renderDistance"] = String(changes.renderDistance);
  if (changes.simulationDistance !== undefined) updates["simulationDistance"] = String(changes.simulationDistance);
  if (changes.maxFps !== undefined) updates["maxFps"] = String(changes.maxFps);
  if (changes.enableVsync !== undefined) updates["enableVsync"] = String(changes.enableVsync);
  if (changes.graphicsPreset !== undefined) updates["graphicsPreset"] = `"${changes.graphicsPreset}"`;
  if (changes.ao !== undefined) updates["ao"] = String(changes.ao);
  if (changes.entityDistanceScaling !== undefined) updates["entityDistanceScaling"] = String(changes.entityDistanceScaling);
  if (changes.entityShadows !== undefined) updates["entityShadows"] = String(changes.entityShadows);
  if (changes.mipmapLevels !== undefined) updates["mipmapLevels"] = String(changes.mipmapLevels);
  if (changes.renderClouds !== undefined) updates["renderClouds"] = `"${changes.renderClouds}"`;
  if (changes.cloudRange !== undefined) updates["cloudRange"] = String(changes.cloudRange);
  if (changes.particles !== undefined) updates["particles"] = String(changes.particles);
  if (changes.biomeBlendRadius !== undefined) updates["biomeBlendRadius"] = String(changes.biomeBlendRadius);
  if (changes.cutoutLeaves !== undefined) updates["cutoutLeaves"] = String(changes.cutoutLeaves);
  if (changes.improvedTransparency !== undefined) updates["improvedTransparency"] = String(changes.improvedTransparency);
  if (changes.fullscreen !== undefined) updates["fullscreen"] = String(changes.fullscreen);

  // Apply each update by finding the line and replacing the value
  for (const [key, value] of Object.entries(updates)) {
    // This regex finds "key:anything" and replaces with "key:newValue"
    // The "m" flag means multiline — ^ matches start of each line, not just start of file
    const regex = new RegExp(`^${key}:.*$`, "m");
    if (content.match(regex)) {
      content = content.replace(regex, `${key}:${value}`);
    }
  }

  // Write the modified content back to the file
  writeFileSync(OPTIONS_PATH, content, "utf-8");

  // Return a summary of what changed
  const changeList = Object.entries(updates)
    .map(([key, val]) => `  ${key} → ${val}`)
    .join("\n");

  return `Modified ${Object.keys(updates).length} settings:\n${changeList}`;
}

// ---- RUN IT ----
// Test: read current settings and display them

console.log("=== Minecraft Config Path ===");
console.log(OPTIONS_PATH);
console.log("");

if (!existsSync(OPTIONS_PATH)) {
  console.log("ERROR: Minecraft options.txt not found!");
  console.log("Expected at:", OPTIONS_PATH);
} else {
  const settings = getPerformanceSettings();
  console.log("=== Current Performance Settings ===");
  console.log(JSON.stringify(settings, null, 2));

  // Show which settings are "expensive" (hurting FPS)
  console.log("\n=== Performance Flags ===");
  if (settings.renderDistance > 16) {
    console.log(`⚠ renderDistance is ${settings.renderDistance} (high — try 10-16 for better FPS)`);
  }
  if (settings.ao) {
    console.log("⚠ Ambient Occlusion is ON (moderate FPS cost)");
  }
  if (settings.entityShadows) {
    console.log("⚠ Entity Shadows are ON (minor FPS cost)");
  }
  if (settings.renderClouds === "true") {
    console.log("⚠ Clouds set to FANCY (minor FPS cost)");
  }
  if (settings.mipmapLevels > 2) {
    console.log(`⚠ Mipmap Levels at ${settings.mipmapLevels} (minor FPS cost)`);
  }
  if (settings.cloudRange > 64) {
    console.log(`⚠ Cloud Range at ${settings.cloudRange} (minor FPS cost)`);
  }
  if (settings.cutoutLeaves) {
    console.log("⚠ Fancy Leaves are ON (minor FPS cost)");
  }
  if (settings.biomeBlendRadius > 3) {
    console.log(`⚠ Biome Blend Radius at ${settings.biomeBlendRadius} (minor FPS cost)`);
  }
  if (settings.particles === 0) {
    console.log("✓ Particles already at ALL (your choice — 1 or 2 saves FPS)");
  }
}
