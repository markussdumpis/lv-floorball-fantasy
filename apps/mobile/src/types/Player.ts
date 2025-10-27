export interface Player {
  id: string;
  name: string;
  position: 'F' | 'D' | 'G';
  team: string;
  price: number;
  fppg: number;
}

