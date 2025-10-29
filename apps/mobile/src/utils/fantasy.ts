import type { Player } from '../types/Player';

export const RULES = {
  F: 5,
  D: 3,
  G: 1,
  FLEX: 1,
} as const;

export const ROSTER_LIMIT =
  RULES.F + RULES.D + RULES.G + RULES.FLEX;

type PositionKey = keyof typeof RULES;
export type PositionCounts = Record<Exclude<PositionKey, 'FLEX'>, number> & { FLEX: number };

const getSelectedPlayers = (players: Player[], selectedIds: string[]) =>
  players.filter(player => selectedIds.includes(player.id));

export function countByPos(players: Player[], selectedIds: string[]): PositionCounts {
  const selected = getSelectedPlayers(players, selectedIds);
  const counts: PositionCounts = { F: 0, D: 0, G: 0, FLEX: 0 };

  selected.forEach(player => {
    counts[player.position] += 1;
  });

  const extraF = Math.max(0, counts.F - RULES.F);
  const extraD = Math.max(0, counts.D - RULES.D);
  counts.FLEX = extraF + extraD;

  return counts;
}

export function canSelect(player: Player, players: Player[], selectedIds: string[]): boolean {
  if (selectedIds.includes(player.id)) return true;
  if (selectedIds.length >= ROSTER_LIMIT) return false;
  const nextSelected = [...selectedIds, player.id];
  const counts = countByPos(players, nextSelected);

  if (counts.G > RULES.G) return false;

  const extraF = Math.max(0, counts.F - RULES.F);
  const extraD = Math.max(0, counts.D - RULES.D);
  if (extraF + extraD > RULES.FLEX) return false;

  return true;
}

export function totalPrice(players: Player[], selectedIds: string[]): number {
  return getSelectedPlayers(players, selectedIds).reduce((sum, player) => {
    const price = player.price ?? 0;
    return sum + price;
  }, 0);
}

export function remainingBudget(
  totalBudget: number,
  players: Player[],
  selectedIds: string[]
): number {
  return totalBudget - totalPrice(players, selectedIds);
}

export function isValidTeam(
  players: Player[],
  selectedIds: string[],
  totalBudget: number
): boolean {
  if (selectedIds.length !== ROSTER_LIMIT) return false;
  const counts = countByPos(players, selectedIds);
  if (counts.G !== RULES.G) return false;

  const extraF = Math.max(0, counts.F - RULES.F);
  const extraD = Math.max(0, counts.D - RULES.D);
  if (counts.F < RULES.F || counts.D < RULES.D) return false;
  if (extraF + extraD !== RULES.FLEX) return false;

  const withinBudget = totalPrice(players, selectedIds) <= totalBudget;

  return withinBudget;
}
