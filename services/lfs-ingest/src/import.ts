import type { PostgrestError } from '@supabase/supabase-js';
import { admin } from './supabase.js';
import { normalizeName, toSeconds } from './utils.js';

export type TeamInput = {
  code: string;
  name: string;
};

export type PlayerInput = {
  name: string;
  team_code: string;
};

export type MatchInput = {
  external_id: string;
  date?: string | null;
  season?: string | null;
  home_team: { code: string; name: string };
  away_team: { code: string; name: string };
  home_score?: number | null;
  away_score?: number | null;
  venue?: string | null;
  status?: string | null;
};

export type EventInput = {
  minute?: number | null;
  clock?: string | null;
  ts_seconds?: number | null;
  period?: string | null;
  team_code?: string | null;
  player_name?: string | null;
  assist_name?: string | null;
  event_type: string;
  value?: number | string | null;
  penalty_minutes?: number | string | null;
  raw_detail?: string | null;
  raw?: Record<string, unknown>;
};

export type TeamRecord = {
  id: string;
  code: string;
  name: string;
};

export type PlayerRecord = {
  id: string;
  team_id: string;
  name: string;
  normalized: string;
};

type UpsertTeamsResult = {
  teamMap: Map<string, TeamRecord>;
  upserted: number;
};

type UpsertPlayersResult = {
  playerMap: Map<string, PlayerRecord>;
  upserted: number;
};

const normalizeKey = (value: string) => normalizeName(value).toLowerCase();

function makePlayerKey(teamId: string, playerName: string): string {
  return `${teamId}:${normalizeKey(playerName)}`;
}

function isMissingColumn(error: PostgrestError): boolean {
  const details = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return details.includes('column') && details.includes('does not exist');
}

export async function upsertTeams(teams: TeamInput[]): Promise<UpsertTeamsResult> {
  const uniqueByCode = new Map<string, TeamInput>();
  for (const team of teams) {
    if (!team.code) continue;
    if (!uniqueByCode.has(team.code)) {
      uniqueByCode.set(team.code, team);
    }
  }

  const teamMap = new Map<string, TeamRecord>();
  let upserted = 0;

  for (const team of uniqueByCode.values()) {
    const { data: existing, error } = await admin
      .from('teams')
      .select('id, code, name')
      .eq('code', team.code)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (existing) {
      if (existing.name !== team.name) {
        const { error: updateError } = await admin
          .from('teams')
          .update({ name: team.name })
          .eq('id', existing.id);
        if (updateError) throw updateError;
        upserted += 1;
      }
      teamMap.set(team.code, { id: existing.id, code: existing.code, name: team.name });
      continue;
    }

    const { data: inserted, error: insertError } = await admin
      .from('teams')
      .insert({ code: team.code, name: team.name })
      .select('id, code, name')
      .single();

    if (insertError) throw insertError;

    upserted += 1;
    teamMap.set(team.code, { id: inserted.id, code: inserted.code, name: inserted.name });
  }

  return { teamMap, upserted };
}

export async function upsertPlayers(
  players: PlayerInput[],
  teamMap: Map<string, TeamRecord>
): Promise<UpsertPlayersResult> {
  const grouped = new Map<string, Map<string, PlayerInput>>();

  for (const player of players) {
    const team = teamMap.get(player.team_code);
    if (!team) continue;
    const normalized = normalizeKey(player.name);
    if (!grouped.has(team.code)) {
      grouped.set(team.code, new Map<string, PlayerInput>());
    }
    const teamPlayers = grouped.get(team.code)!;
    if (!teamPlayers.has(normalized)) {
      teamPlayers.set(normalized, player);
    }
  }

  const playerMap = new Map<string, PlayerRecord>();
  let upserted = 0;

  for (const [teamCode, playersByName] of grouped) {
    const team = teamMap.get(teamCode);
    if (!team) continue;

    const { data: existingPlayers, error } = await admin
      .from('players')
      .select('id, name, team_id')
      .eq('team_id', team.id);

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    const existingMap = new Map<string, PlayerRecord>();
    existingPlayers?.forEach(record => {
      const normalized = normalizeKey(record.name);
      existingMap.set(makePlayerKey(record.team_id, record.name), {
        id: record.id,
        team_id: record.team_id,
        name: record.name,
        normalized,
      });
    });

    for (const player of playersByName.values()) {
      const key = makePlayerKey(team.id, player.name);
      const normalized = normalizeKey(player.name);

      const existingRecord =
        existingMap.get(key) ??
        [...existingMap.values()].find(candidate => candidate.normalized === normalized);

      if (existingRecord) {
        if (existingRecord.name !== player.name) {
          const { error: updateError } = await admin
            .from('players')
            .update({ name: player.name })
            .eq('id', existingRecord.id);
          if (updateError) throw updateError;
          upserted += 1;
        }
        playerMap.set(makePlayerKey(team.id, player.name), {
          ...existingRecord,
          name: player.name,
          normalized,
        });
        continue;
      }

      const { data: inserted, error: insertError } = await admin
        .from('players')
        .insert({
          name: player.name,
          team_id: team.id,
        })
        .select('id, name, team_id')
        .single();

      if (insertError) throw insertError;

      upserted += 1;

      const insertedRecord: PlayerRecord = {
        id: inserted.id,
        name: inserted.name,
        team_id: inserted.team_id,
        normalized,
      };

      playerMap.set(makePlayerKey(team.id, player.name), insertedRecord);
    }
  }

  return { playerMap, upserted };
}

export async function upsertMatch(
  match: MatchInput,
  teamMap: Map<string, TeamRecord>
): Promise<string> {
  const homeTeam = teamMap.get(match.home_team.code);
  const awayTeam = teamMap.get(match.away_team.code);

  const payloadWithTeams = {
    external_id: match.external_id,
    date: match.date ?? null,
    season: match.season ?? null,
    venue: match.venue ?? null,
    status: match.status ?? null,
    home_team: homeTeam?.id ?? null,
    away_team: awayTeam?.id ?? null,
    home_score: match.home_score ?? null,
    away_score: match.away_score ?? null,
  };

  const { data, error } = await admin
    .from('matches')
    .upsert(payloadWithTeams, { onConflict: 'external_id' })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

export async function replaceEvents(
  matchId: string,
  events: EventInput[],
  playerMap: Map<string, PlayerRecord>,
  teamMap: Map<string, TeamRecord>
): Promise<number> {
  if (!matchId) {
    throw new Error('replaceEvents requires a matchId');
  }

  await admin.from('match_events').delete().eq('match_id', matchId);

  if (!events.length) return 0;

  const rows = [];

  for (const event of events) {
    if (!event.event_type || event.event_type === 'other') continue;

    const team = event.team_code ? teamMap.get(event.team_code) : null;
    const teamId = team?.id ?? null;

    const player =
      teamId && event.player_name
        ? playerMap.get(makePlayerKey(teamId, event.player_name))
        : null;
    if (!player) continue;

    const assist =
      teamId && event.assist_name
        ? playerMap.get(makePlayerKey(teamId, event.assist_name))
        : null;

    const seconds =
      event.ts_seconds ??
      toSeconds(typeof event.minute === 'number' ? event.minute : event.clock ?? null);

    const raw = event.raw ?? {
      raw_detail: event.raw_detail ?? null,
    };

    const valueCandidate = event.value ?? event.penalty_minutes ?? null;
    const numericValue =
      typeof valueCandidate === 'number'
        ? valueCandidate
        : typeof valueCandidate === 'string' && /^\d+(?:\.\d+)?$/.test(valueCandidate)
        ? Number.parseFloat(valueCandidate)
        : null;

    rows.push({
      match_id: matchId,
      ts_seconds: seconds,
      period: event.period ?? null,
      team_id: teamId,
      player_id: player.id,
      assist_id: assist?.id ?? null,
      event_type: event.event_type,
      value: numericValue,
      raw,
    });
  }

  if (!rows.length) return 0;

  const { error } = await admin.from('match_events').insert(rows);

  if (error) {
    if (isMissingColumn(error)) {
      const fallbackRows = rows.map(row => ({
        match_id: row.match_id,
        player_id: row.player_id,
        event_type: row.event_type,
        value: row.value,
        minute: row.ts_seconds ? Math.round(row.ts_seconds / 60) : null,
      }));
      const { error: fallbackError } = await admin.from('match_events').insert(fallbackRows);
      if (fallbackError) throw fallbackError;
      return fallbackRows.length;
    }
    throw error;
  }

  return rows.length;
}
