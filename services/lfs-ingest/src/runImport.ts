import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadEnv } from './config.js';
import {
  EventInput,
  MatchInput,
  PlayerInput,
  TeamInput,
  replaceEvents,
  upsertMatch,
  upsertPlayers,
  upsertTeams,
} from './import.js';
import { getLatestJsonPath, normalizeName } from './utils.js';

type CachedDocument = {
  match: MatchInput;
  teams: TeamInput[];
  players: Array<{ name: string; team_code: string }>;
  events: EventInput[];
};

function buildTeamInputs(doc: CachedDocument): TeamInput[] {
  const teams = new Map<string, TeamInput>();

  const addTeam = (team?: TeamInput | null) => {
    if (!team?.code) return;
    if (!team.name) return;
    if (!teams.has(team.code)) {
      teams.set(team.code, { code: team.code, name: team.name });
    }
  };

  doc.teams?.forEach(team => addTeam(team));
  addTeam(doc.match?.home_team);
  addTeam(doc.match?.away_team);

  return [...teams.values()];
}

function buildPlayerInputs(doc: CachedDocument): PlayerInput[] {
  const players = new Map<string, PlayerInput>();

  const addPlayer = (name: string | null | undefined, teamCode: string | null | undefined) => {
    if (!name || !teamCode) return;
    const normalizedName = normalizeName(name);
    if (!normalizedName) return;
    const key = `${teamCode}:${normalizedName.toLowerCase()}`;
    if (!players.has(key)) {
      players.set(key, { name: normalizedName, team_code: teamCode });
    }
  };

  doc.players?.forEach(player => {
    addPlayer(player.name, player.team_code);
  });

  doc.events?.forEach(event => {
    if (!event.event_type || event.event_type === 'other') return;
    addPlayer(event.player_name ?? null, event.team_code ?? null);
    if (event.event_type === 'goal') {
      addPlayer(event.assist_name ?? null, event.team_code ?? null);
    }
  });

  return [...players.values()];
}

function buildEvents(doc: CachedDocument): EventInput[] {
  return (doc.events ?? []).map(event => {
    const minute =
      typeof event.minute === 'number'
        ? event.minute
        : typeof event.minute === 'string'
        ? Number.parseInt(event.minute, 10) || null
        : null;

    const rawPayload = { ...event };
    // Avoid recursive structures if raw is already present
    if (Object.prototype.hasOwnProperty.call(rawPayload, 'raw')) {
      delete (rawPayload as Record<string, unknown>).raw;
    }

    return {
      minute,
      clock: event.clock ?? null,
      ts_seconds: event.ts_seconds ?? null,
      period: event.period ?? null,
      team_code: event.team_code ?? null,
      player_name: event.player_name ?? null,
      assist_name: event.assist_name ?? null,
      event_type: event.event_type ?? 'other',
      value: event.value ?? null,
      penalty_minutes: event.penalty_minutes ?? null,
      raw_detail: event.raw_detail ?? null,
      raw: rawPayload,
    };
  });
}

async function main() {
  loadEnv();

  const jsonPath =
    process.env.MATCH_JSON_PATH && process.env.MATCH_JSON_PATH.trim().length
      ? process.env.MATCH_JSON_PATH.trim()
      : await getLatestJsonPath();

  const content = await readFile(jsonPath, 'utf-8');
  const doc = JSON.parse(content) as CachedDocument;

  const teamInputs = buildTeamInputs(doc);
  const { teamMap, upserted: teamsUpserted } = await upsertTeams(teamInputs);

  const playerInputs = buildPlayerInputs(doc);
  const { playerMap, upserted: playersUpserted } = await upsertPlayers(playerInputs, teamMap);

  const matchId = await upsertMatch(doc.match, teamMap);

  const events = buildEvents(doc);
  const eventsInserted = await replaceEvents(matchId, events, playerMap, teamMap);

  console.log(`[import] match_id=${matchId}`);
  console.log(
    '[import] counts',
    JSON.stringify({
      teamsUpserted,
      playersUpserted,
      eventsInserted,
    })
  );
}

const isDirectRun =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main().catch(error => {
    console.error('[import] failed', error);
    process.exitCode = 1;
  });
}
