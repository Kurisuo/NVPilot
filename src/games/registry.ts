// games/registry.ts — maps a detected process to a game adapter.
//
// Unknown apps resolve to null: the daemon then either applies generic
// system-level optimization (GPU-heavy apps) or does nothing (desktop apps).
// Adding a game = adding an adapter to GAME_ADAPTERS.

import { GameAdapter } from "./adapter";
import { minecraftAdapter } from "./minecraft";

export const GAME_ADAPTERS: GameAdapter[] = [minecraftAdapter];

export function resolveGame(processName: string): GameAdapter | null {
  const lower = processName.toLowerCase();
  return (
    GAME_ADAPTERS.find((g) =>
      g.processNames.some((term) => lower.includes(term))
    ) || null
  );
}

export function getAdapter(id: string): GameAdapter | null {
  return GAME_ADAPTERS.find((g) => g.id === id) || null;
}
