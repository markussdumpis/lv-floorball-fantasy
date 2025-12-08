import { FLEX_ALLOWED_POSITIONS, POSITIONS, ROSTER_RULES, type Position } from '../constants/fantasyRules';
import type { Player } from '../types/Player';

export const RULES = ROSTER_RULES;
export const ROSTER_LIMIT = ROSTER_RULES.TOTAL;

const CORE_POSITIONS = Object.keys(POSITIONS) as Position[];

export type PositionCounts = Record<Position, number> & { FLEX: number };

const getSelectedPlayers = (players: Player[], selectedIds: string[]) =>
  players.filter(player => selectedIds.includes(player.id));

export function normalizePosition(pos?: string | null): Position {
  if (!pos) return 'A';
  if (pos === 'U') return 'A'; // LFS attacker -> fantasy attacker
  if (pos === 'A') return 'D'; // LFS defender -> fantasy defender
  if (pos === 'V') return 'V'; // goalie
  return 'A';
}

export function countByPos(players: Player[], selectedIds: string[]): PositionCounts {
  const selected = getSelectedPlayers(players, selectedIds);
  const counts: PositionCounts = { A: 0, D: 0, V: 0, FLEX: 0 };

  selected.forEach(player => {
    const normalized = normalizePosition(player.position);
    counts[normalized] += 1;
  });

  counts.FLEX = FLEX_ALLOWED_POSITIONS.reduce((total, position) => {
    const required = ROSTER_RULES[position];
    const actual = counts[position];
    return total + Math.max(0, actual - required);
  }, 0);

  return counts;
}

export function getPlayerPrice(player: Player): number {
  const raw = player.price_final ?? player.price_computed ?? 0;
  return typeof raw === 'number' && !Number.isNaN(raw) ? raw : 0;
}

export function totalPrice(players: Player[], selectedIds: string[]): number {
  return getSelectedPlayers(players, selectedIds).reduce((sum, player) => {
    const price = getPlayerPrice(player);
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

  const coreSatisfied = CORE_POSITIONS.every(position => counts[position] >= RULES[position]);
  if (!coreSatisfied) return false;
  if (counts.FLEX !== RULES.FLEX) return false;

  const withinBudget = totalPrice(players, selectedIds) <= totalBudget;

  return withinBudget;
}

export function validateRoster(roster: Array<Pick<Player, 'position'>>): boolean {
  const counts: PositionCounts = { A: 0, D: 0, V: 0, FLEX: 0 };

  roster.forEach(player => {
    counts[player.position] += 1;
  });

  counts.FLEX = FLEX_ALLOWED_POSITIONS.reduce((total, position) => {
    const required = ROSTER_RULES[position];
    const actual = counts[position];
    return total + Math.max(0, actual - required);
  }, 0);

  const goalieRequirementMet = counts.V >= ROSTER_RULES.V;
  const flexWithinLimits = counts.FLEX <= ROSTER_RULES.FLEX;
  const totalWithinLimit = roster.length <= ROSTER_RULES.TOTAL;

  return goalieRequirementMet && flexWithinLimits && totalWithinLimit;
}

export function selectionError(player: Player, players: Player[], selectedIds: string[]): string | null {
  if (selectedIds.includes(player.id)) return null;
  if (selectedIds.length >= ROSTER_LIMIT) {
    return 'You already have 8 players in your squad.';
  }

  const nextSelected = [...selectedIds, player.id];
  const counts = countByPos(players, nextSelected);

  const flexUsage = counts.FLEX;
  if (flexUsage > RULES.FLEX) {
    if (player.position === 'A') return 'Flex slot is already used for an attacker.';
    if (player.position === 'D') return 'Flex slot is already used for a defender.';
    return 'Flex slot is full.';
  }

  return null;
}

export function canSelect(player: Player, players: Player[], selectedIds: string[]): boolean {
  return selectionError(player, players, selectedIds) === null;
}
