import { load, CheerioAPI } from 'cheerio';
import { pathToFileURL } from 'node:url';
import { normalizeName, teamCode as deriveTeamCode } from './utils/normalizer.js';
import type { ParsedDocument, ParsedEvent, ParsedMatch, ParsedPlayer, ParsedTeam } from './types.js';

export type ParseOptions = {
  matchId?: string;
  matchUrl?: string;
};

const clockRegex = /(?:(\d+)\s*(?:st|nd|rd|th)\s*(?:period|p)|period\s*(\d+)|p\s*(\d+)|^(\d+)\s*\w+)/i;

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function firstNonEmpty<T>(values: Array<() => T | null | undefined>): T | null {
  for (const getter of values) {
    const value = getter();
    if (value !== undefined && value !== null && value !== '') {
      return value as T;
    }
  }
  return null;
}

function extractTeamName($: CheerioAPI, selectors: string[]): string | null {
  for (const selector of selectors) {
    const node = $(selector).first();
    const value = normalizeWhitespace(node.text());
    if (value) return value;
  }
  return null;
}

function extractTeams($: CheerioAPI): { homeName: string; awayName: string } {
  const selectorsHome = [
    '[data-role="home-team"]',
    '[data-team="home"]',
    '.home-team .team-name',
    '.team-home .team-name',
    '.match-header .team.home',
    '.match-teams .team.home',
    '.home .team-name',
    '.team.home',
    '.team--home',
  ];

  const selectorsAway = [
    '[data-role="away-team"]',
    '[data-team="away"]',
    '.away-team .team-name',
    '.team-away .team-name',
    '.match-header .team.away',
    '.match-teams .team.away',
    '.away .team-name',
    '.team.away',
    '.team--away',
  ];

  let homeName = extractTeamName($, selectorsHome) ?? '';
  let awayName = extractTeamName($, selectorsAway) ?? '';

  if (!homeName || !awayName) {
    const title = normalizeWhitespace($('title').first().text());
    const vsSplit = title.split(/\bvs\b|\bVS\b| vs\. | – | — | - | @/);
    if (vsSplit.length >= 2) {
      homeName ||= normalizeWhitespace(vsSplit[0]);
      awayName ||= normalizeWhitespace(vsSplit[1]);
    }
  }

  if (!homeName || !awayName) {
    const teamNodes = $('[class*="team"]').map((_, el) => normalizeWhitespace($(el).text())).get();
    if (teamNodes.length >= 2) {
      homeName ||= teamNodes[0];
      awayName ||= teamNodes[1];
    }
  }

  if (!homeName) homeName = 'Home';
  if (!awayName) awayName = 'Away';

  return { homeName, awayName };
}

function extractScore($: CheerioAPI): { homeScore: number | null; awayScore: number | null } {
  const scoreSelectors = [
    '.scoreboard .score',
    '.match-score',
    '.final-score',
    '.game-score',
    '.score',
  ];
  for (const selector of scoreSelectors) {
    const text = normalizeWhitespace($(selector).first().text());
    const parsed = parseScore(text);
    if (parsed) return parsed;
  }

  const title = normalizeWhitespace($('title').first().text());
  const parsedTitle = parseScore(title);
  if (parsedTitle) return parsedTitle;

  return { homeScore: null, awayScore: null };
}

function parseScore(text: string): { homeScore: number; awayScore: number } | null {
  const match = text.match(/(\d+)\s*[-:–]\s*(\d+)/);
  if (!match) return null;
  return {
    homeScore: Number.parseInt(match[1], 10),
    awayScore: Number.parseInt(match[2], 10),
  };
}

function extractStartTime($: CheerioAPI): string | null {
  const timeNode = $('time[datetime]').first();
  if (timeNode.length) {
    const value = timeNode.attr('datetime');
    if (value) return value;
  }

  const metaTime = firstNonEmpty<string | null>([
    () => $('meta[property="article:published_time"]').attr('content') ?? null,
    () => $('meta[name="match-date"]').attr('content') ?? null,
  ]);
  if (metaTime) return metaTime;

  const dateText = normalizeWhitespace($('[class*="date"], .match-date, .game-date').first().text());
  if (dateText) {
    const maybeDate = new Date(dateText);
    if (!Number.isNaN(maybeDate.getTime())) {
      return maybeDate.toISOString();
    }
  }

  return null;
}

function parseEvents($: CheerioAPI, homeCode: string, awayCode: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  $('table').each((_, table) => {
    const $table = $(table);
    const headerCells = $table.find('thead th');
    const headers = headerCells.length
      ? headerCells
      : $table.find('tr').first().find('th, td');

    const headerLabels = headers
      .map((_, cell) => normalizeWhitespace($(cell).text()).toLowerCase())
      .get();

    if (!headerLabels.length) return;

    const hasEventColumn = headerLabels.some(label => /event|type|action/i.test(label));
    const hasTimeColumn = headerLabels.some(label => /time|clock|min/i.test(label));
    const hasPlayerColumn = headerLabels.some(label => /player|scorer/i.test(label));

    if (!(hasEventColumn && hasTimeColumn && hasPlayerColumn)) return;

    const bodyRows = headerCells.length
      ? $table.find('tbody tr')
      : $table.find('tr').slice(1);

    bodyRows.each((__, row) => {
      const cells = $(row).find('td');
      if (!cells.length) return;

      const raw: Record<string, string> = {};
      const record: { [key: string]: string } = {};

      cells.each((idx, cell) => {
        const key = headerLabels[idx] ?? `col_${idx}`;
        const value = normalizeWhitespace($(cell).text());
        raw[key] = value;
        record[key] = value;
      });

      const eventType = normalizeEventType(
        record['event'] ??
          record['type'] ??
          record['action'] ??
          record['event type'] ??
          record['col_2'] ??
          ''
      );
      if (!eventType) return;

      const clock = record['time'] ?? record['clock'] ?? record['minute'] ?? null;
      const { tsSeconds, period } = parseClock(clock);
      const teamNameRaw = record['team'] ?? record['club'] ?? '';
      const teamCode = pickTeamCode(teamNameRaw, homeCode, awayCode);

      const playerName =
        record['player'] ??
        record['scorer'] ??
        record['goal scorer'] ??
        record['col_1'] ??
        null;
      const assistName =
        record['assist'] ??
        record['assist player'] ??
        record['helper'] ??
        null;

      events.push({
        eventType,
        clock,
        period,
        tsSeconds,
        teamCode,
        playerName: playerName ? normalizeName(playerName) : null,
        assistName: assistName ? normalizeName(assistName) : null,
        raw,
      });
    });
  });

  return dedupeEvents(events);
}

function normalizeEventType(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return '';
  if (value.includes('goal allowed') || value.includes('ga')) return 'goal_allowed';
  if (value.includes('goal')) return 'goal';
  if (value.includes('assist')) return 'assist';
  if (value.includes('hat')) return 'hat_trick';
  if (value.includes('penalty shot') && value.includes('miss')) return 'penalty_shot_missed';
  if (value.includes('penalty shot')) return 'penalty_shot_scored';
  if (value.includes('double')) return 'double_minor';
  if (value.includes('penalty')) return 'minor_2';
  if (value.includes('red')) return 'red_card';
  if (value.includes('mvp')) return 'mvp';
  if (value.includes('save')) return 'save';
  if (value.includes('goalkeeper') || value.includes('goalie')) return 'goal_allowed';
  return value.replace(/\s+/g, '_');
}

function parseClock(clock: string | null | undefined): { tsSeconds: number | null; period: string | null } {
  if (!clock) return { tsSeconds: null, period: null };
  const timeMatch = clock.match(/(\d+):(\d+)/);
  const minutes = timeMatch ? Number.parseInt(timeMatch[1], 10) : null;
  const seconds = timeMatch ? Number.parseInt(timeMatch[2], 10) : null;

  const periodMatch = clock.match(clockRegex);
  const periodValue =
    periodMatch && periodMatch.slice(1).find(Boolean)
      ? periodMatch.slice(1).find(Boolean)
      : null;

  const tsSeconds =
    minutes !== null && seconds !== null ? minutes * 60 + seconds : minutes !== null ? minutes * 60 : null;

  return {
    tsSeconds,
    period: periodValue ? String(periodValue) : null,
  };
}

function pickTeamCode(input: string, homeCode: string, awayCode: string): string | null {
  const normalized = normalizeWhitespace(input).toUpperCase();
  if (!normalized) return null;
  if (normalized.includes(homeCode.toUpperCase())) return homeCode;
  if (normalized.includes(awayCode.toUpperCase())) return awayCode;
  if (normalized.includes('HOME')) return homeCode;
  if (normalized.includes('AWAY')) return awayCode;
  return null;
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = JSON.stringify({
      eventType: event.eventType,
      clock: event.clock,
      player: event.playerName,
      team: event.teamCode,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePlayers($: CheerioAPI, home: ParsedTeam, away: ParsedTeam): ParsedPlayer[] {
  const players: ParsedPlayer[] = [];
  const pushPlayer = (teamCode: string, playerName: string, extras?: Partial<ParsedPlayer>) => {
    const normalized = normalizeName(playerName);
    if (!normalized) return;
    players.push({
      name: normalized,
      teamCode,
      jerseyNumber: extras?.jerseyNumber ?? null,
      position: extras?.position ?? null,
      externalId: extras?.externalId ?? null,
    });
  };

  $('table').each((_, table) => {
    const $table = $(table);
    const headers = $table.find('tr').first().find('th, td').map((__, cell) => normalizeWhitespace($(cell).text()).toLowerCase()).get();
    if (!headers.length) return;
    const hasPlayerColumn = headers.some(h => /player|name/i.test(h));
    if (!hasPlayerColumn) return;

    const sectionLabel = normalizeWhitespace(
      $table.prevAll('h1, h2, h3, h4, h5, h6, strong').first().text()
    ).toLowerCase();

    let teamCode: string | null = null;
    if (sectionLabel.includes(home.name.toLowerCase()) || sectionLabel.includes(home.code.toLowerCase())) {
      teamCode = home.code;
    } else if (sectionLabel.includes(away.name.toLowerCase()) || sectionLabel.includes(away.code.toLowerCase())) {
      teamCode = away.code;
    }

    const detectedTeam = teamCode;

    $table
      .find('tr')
      .slice(1)
      .each((__, row) => {
        const cells = $(row).find('td');
        if (!cells.length) return;
        const raw = cells.map((idx, cell) => ({
          header: headers[idx] ?? `col_${idx}`,
          value: normalizeWhitespace($(cell).text()),
        })).get();

        const nameEntry = raw.find(entry => /player|name/.test(entry.header));
        if (!nameEntry || !nameEntry.value) return;

        let rowTeamCode = detectedTeam;
        const teamEntry = raw.find(entry => /team|club/.test(entry.header));
        if (teamEntry && teamEntry.value) {
          const normalized = teamEntry.value.toLowerCase();
          if (normalized.includes(home.name.toLowerCase()) || normalized.includes(home.code.toLowerCase())) {
            rowTeamCode = home.code;
          } else if (normalized.includes(away.name.toLowerCase()) || normalized.includes(away.code.toLowerCase())) {
            rowTeamCode = away.code;
          }
        }

        if (!rowTeamCode) {
          rowTeamCode = raw.find(entry => /home/.test(entry.value.toLowerCase())) ? home.code : raw.find(entry => /away/.test(entry.value.toLowerCase())) ? away.code : null;
        }

        if (!rowTeamCode) return;

        const jerseyEntry = raw.find(entry => /#|number|no/.test(entry.header));
        const positionEntry = raw.find(entry => /pos|position/.test(entry.header));

        pushPlayer(rowTeamCode, nameEntry.value, {
          jerseyNumber: jerseyEntry?.value ?? null,
          position: positionEntry?.value ?? null,
        });
      });
  });

  return dedupePlayers(players);
}

function dedupePlayers(players: ParsedPlayer[]): ParsedPlayer[] {
  const seen = new Set<string>();
  return players.filter(player => {
    const key = `${player.teamCode}|${normalizeName(player.name).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parse(html: string, options: ParseOptions = {}): ParsedDocument {
  const $ = load(html);
  const { homeName, awayName } = extractTeams($);
  const homeTeam: ParsedTeam = {
    name: normalizeName(homeName),
    code: deriveTeamCode(homeName),
  };
  const awayTeam: ParsedTeam = {
    name: normalizeName(awayName),
    code: deriveTeamCode(awayName),
  };

  const score = extractScore($);
  const startsAt = extractStartTime($);

  const match: ParsedMatch = {
    externalId: options.matchId ?? options.matchUrl ?? `match-${Date.now()}`,
    matchUrl: options.matchUrl,
    startsAt,
    homeTeamCode: homeTeam.code,
    awayTeamCode: awayTeam.code,
    homeScore: score.homeScore,
    awayScore: score.awayScore,
    raw: {
      title: normalizeWhitespace($('title').first().text()),
    },
  };

  const players = parsePlayers($, homeTeam, awayTeam);
  const events = parseEvents($, homeTeam.code, awayTeam.code);

  // ensure event players are represented
  events.forEach(event => {
    if (event.playerName) {
      const exists = players.some(
        player => normalizeName(player.name).toLowerCase() === event.playerName?.toLowerCase() && player.teamCode === (event.teamCode ?? homeTeam.code)
      );
      if (!exists) {
        players.push({
          name: event.playerName,
          teamCode: event.teamCode ?? homeTeam.code,
        });
      }
    }
    if (event.assistName) {
      const exists = players.some(
        player => normalizeName(player.name).toLowerCase() === event.assistName?.toLowerCase()
      );
      if (!exists) {
        players.push({
          name: event.assistName,
          teamCode: event.teamCode ?? homeTeam.code,
        });
      }
    }
  });

  return {
    match,
    teams: [homeTeam, awayTeam],
    players: dedupePlayers(players),
    events,
  };
}

async function runCli() {
  const { scrape } = await import('./scrape.js');
  const result = await scrape();
  const doc = parse(result.html, { matchId: result.matchId, matchUrl: result.url });
  console.log(JSON.stringify(doc, null, 2));
}

const isDirectRun =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  runCli().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
