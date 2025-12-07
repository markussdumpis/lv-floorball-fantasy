export type Position = 'U' | 'A' | 'V';

export interface PlayerStatsRow {
  id?: string;
  name: string;
  team: string;
  position: Position;
  games: number | null;
  goals: number | null;
  assists: number | null;
  points: number | null;
  shots: number | null;
  saves: number | null;
  save_pct: number | null;
  pen_min: number | null;
}

export interface PlayerSeasonStatsRow {
  name: string;
  team: string;
  position: Position;
  games: number | null;
  goals: number | null;
  assists: number | null;
  points: number | null;
  saves: number | null;
  save_pct: number | null;
  penalty_min: number | null;
}
