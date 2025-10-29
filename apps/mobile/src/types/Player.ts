export type Player = {
  id: string;
  name: string;
  position: 'F' | 'D' | 'G';
  team: string | null;
  price: number | null;
  points_total: number | null;
};
