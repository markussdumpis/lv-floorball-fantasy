import type { Position } from '../constants/fantasyRules';

export type Player = {
  id: string;
  name: string;
  position: Position;
  team: string | null;
  price?: number | null;
  price_final?: number | null;
  price_manual?: number | null;
  price_computed?: number | null;
  fantasy_total?: number | null;
  fantasy_ppg?: number | null;
  points_total?: number | null;
};
