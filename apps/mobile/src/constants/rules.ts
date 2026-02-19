import { SEASON_BUDGET_CREDITS } from './fantasyRules';

export const GAME_RULES = [
  { label: 'Budget', value: `${SEASON_BUDGET_CREDITS.toFixed(1)}k credits` },
  { label: 'Roster', value: '4 Attackers / 2 Defenders / 1 Goalie / 1 Flex' },
  { label: 'Captain', value: '2× points' },
];
