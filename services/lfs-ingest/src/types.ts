export type ParsedTeam = {
  name: string;
  code: string;
  externalId?: string | null;
};

export type ParsedPlayer = {
  name: string;
  teamCode: string;
  jerseyNumber?: string | null;
  position?: string | null;
  externalId?: string | null;
};

export type ParsedMatch = {
  externalId: string;
  matchUrl?: string;
  startsAt?: string | null;
  homeTeamCode: string;
  awayTeamCode: string;
  homeScore?: number | null;
  awayScore?: number | null;
  raw?: Record<string, unknown>;
};

export type ParsedEvent = {
  eventType: string;
  period?: string | null;
  tsSeconds?: number | null;
  clock?: string | null;
  teamCode?: string | null;
  playerName?: string | null;
  assistName?: string | null;
  raw: Record<string, unknown>;
};

export type ParsedDocument = {
  match: ParsedMatch;
  teams: ParsedTeam[];
  players: ParsedPlayer[];
  events: ParsedEvent[];
};
