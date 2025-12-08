export const ROSTER_RULES = {
  A: 4,
  D: 2,
  V: 1,
  FLEX: 1,
  TOTAL: 8,
} as const;

export const TOTAL_BUDGET = 100;

export const POSITIONS = {
  A: 'Attacker',
  D: 'Defender',
  V: 'Goalie',
} as const;

export type Position = keyof typeof POSITIONS;

// Flex slot accepts any position.
export const FLEX_ALLOWED_POSITIONS: Position[] = ['A', 'D', 'V'];
