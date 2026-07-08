// planners/ollama-planner.ts — LLM planner via Ollama's HTTP API.
//
// The model receives the perceived system state (with the GPU tier
// pre-classified and the tier targets included as guidance) and returns a
// JSON list of proposed actions. Output is validated and clamped by
// sanitizePlannedActions — the LLM chooses changes, the code decides
// legality. One retry with the validation error, then fall back to the
// rule planner. The LLM path is an enhancement, never a dependency.

import { OLLAMA_HOST, OLLAMA_MODEL, OLLAMA_TIMEOUT_MS } from "../core/config";
import { Plan, SystemSnapshot } from "../core/types";
import { GameAdapter } from "../games/adapter";
import { Planner, PlanOptions, sanitizePlannedActions } from "./planner";
import { RulePlanner } from "./rule-planner";

const SYSTEM_PROMPT = `You are NVPilot, an autonomous PC performance agent. You receive a JSON snapshot of a machine's state: GPU telemetry, its classified tier, the target application's current settings with tier-relative target guidance, power state, and background processes.

Propose surgical optimizations as JSON. Rules you must follow:
1. Only change settings whose current value is costlier than the tier guidance suggests. Preserve everything else — do NOT apply a blanket low preset.
2. Only use setting names that appear in "available_settings". Only use power state ids from "power.available". Only use PIDs from "suspendable" for close_process.
3. Copy "from" values exactly from the snapshot.
4. Respond with ONLY a JSON object, no prose, matching this schema:
{
  "actions": [
    { "action": { "kind": "game_setting", "setting": "<name>", "from": <current>, "to": <proposed> }, "reason": "<why>" },
    { "action": { "kind": "process_priority", "to": "high" }, "reason": "<why>" },
    { "action": { "kind": "power_state", "to": "<power state id>" }, "reason": "<why>" },
    { "action": { "kind": "close_process", "pid": <pid> }, "reason": "<why>" }
  ],
  "keptSettings": ["<setting> — why it was preserved"],
  "summary": "<one paragraph explaining the overall reasoning>"
}
Reasons must be concrete and honest — never invent FPS numbers or benchmarks.`;

interface OllamaChatResponse {
  message?: { content?: string };
}

async function chatOnce(userContent: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = (await res.json()) as OllamaChatResponse;
    const content = data.message?.content;
    if (!content) throw new Error("Ollama returned empty message");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function buildUserMessage(
  snapshot: SystemSnapshot,
  adapter: GameAdapter | null,
  opts: PlanOptions
): string {
  const payload = {
    gpu: snapshot.gpu,
    gpu_tier: snapshot.gpuTier,
    target_app: snapshot.targetApp,
    game_settings_current: snapshot.gameSettings,
    available_settings: adapter
      ? adapter.settings.map((s) => ({
          name: s.key,
          type: s.type,
          legal_range: s.type === "number" ? { min: s.min, max: s.max } : s.enumValues,
          tier_guidance: adapter.tierTargets[snapshot.gpuTier][s.key],
        }))
      : [],
    game_process: snapshot.gameProcess,
    power: snapshot.power,
    suspendable: opts.allowClose ? snapshot.suspendable : [],
    close_process_allowed: opts.allowClose,
  };
  return JSON.stringify(payload);
}

export class OllamaPlanner implements Planner {
  name = "llm";
  private fallback = new RulePlanner();

  async createPlan(
    snapshot: SystemSnapshot,
    adapter: GameAdapter | null,
    opts: PlanOptions
  ): Promise<Plan> {
    const userMessage = buildUserMessage(snapshot, adapter, opts);

    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: string;
      try {
        raw = await chatOnce(
          attempt === 0
            ? userMessage
            : `${userMessage}\n\nYour previous output failed validation: ${this.lastError}. Return corrected JSON only.`
        );
      } catch (err) {
        console.log(`  [planner] Ollama unavailable (${err}); using rule engine.`);
        return this.fallback.createPlan(snapshot, adapter, opts);
      }

      let parsed: { actions?: unknown; keptSettings?: unknown; summary?: unknown };
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.lastError = "response was not valid JSON";
        continue;
      }

      const { actions, errors } = sanitizePlannedActions(
        parsed.actions, snapshot, adapter, opts
      );

      // Accept if we got a usable plan; hard-fail only when the model
      // proposed things and ALL of them were illegal.
      if (Array.isArray(parsed.actions) && parsed.actions.length > 0 && actions.length === 0) {
        this.lastError = errors.join("; ") || "no valid actions";
        continue;
      }

      const kept = Array.isArray(parsed.keptSettings)
        ? parsed.keptSettings.filter((k): k is string => typeof k === "string")
        : [];
      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : `${actions.length} change(s) proposed by ${OLLAMA_MODEL}.`;

      if (errors.length > 0) {
        console.log(`  [planner] dropped ${errors.length} invalid LLM action(s): ${errors.join("; ")}`);
      }

      return {
        source: "llm",
        targetApp: snapshot.targetApp,
        gpuTier: snapshot.gpuTier,
        actions,
        keptSettings: kept,
        summary,
      };
    }

    console.log(`  [planner] LLM output failed validation twice (${this.lastError}); using rule engine.`);
    return this.fallback.createPlan(snapshot, adapter, opts);
  }

  private lastError = "";
}
