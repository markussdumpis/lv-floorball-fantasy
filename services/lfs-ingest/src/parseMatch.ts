import { load, CheerioAPI } from 'cheerio';
import { loadEnv } from './config.js';
import { normalizeName, teamCode } from './utils/normalizer.js';

const SELECTORS = {
  header: {
    table: 'div.proto-logo-center table.tablo',
    homeName: 'td.logo_majnieki',
    awayName: 'td.logo_viesi',
    homeScore: 'td.rez_maj',
    awayScore: 'td.rez_vie',
    meta: 'td.viduslogo',
    status: 'tr th strong span',
  },
  eventsTable: 'table.event_list',
  eventRow: 'tr',
  timeCell: 'td:nth-child(1)',
  typeCell: 'td:nth-child(2)',
  detailCell: 'td:nth-child(4)',
};

const LATVIAN_MONTHS: Record<string, number> = {
  janvaris: 1,
  janvarys: 1,
  februaris: 2,
  marts: 3,
  aprilis: 4,
  maijs: 5,
  junijs: 6,
  julijs: 7,
  augusts: 8,
  septembris: 9,
  oktobris: 10,
  novembris: 11,
  decembris: 12,
};

const warningCache = new Set<string>();
const debugEventTypeCache = new Set<string>();

type EventType = 'goal' | 'penalty' | 'best_player' | 'other';

type ParsedEventRow = {
  minute: number;
  team_code: string;
  player_name: string;
  assist_name: string | null;
  event_type: EventType;
  raw_detail: string;
  penalty_minutes?: number | string;
  value?: number | string;
};

export type ParsedMatchPayload = Awaited<ReturnType<typeof parseMatch>>;

export async function parseMatch(html: string, baseUrl: string) {
  loadEnv();
  const debug = process.env.DEBUG === '1';
  const $ = load(html);
  const externalId = deriveExternalId(baseUrl) ?? `match-${Date.now()}`;

  const header = extractHeader($, debug);

  const homeTeam = {
    code: teamCode(header.homeName),
    name: normalizeName(header.homeName),
  };
  const awayTeam = {
    code: teamCode(header.awayName),
    name: normalizeName(header.awayName),
  };

  const status = resolveStatus(header.statusText);

  const players = parsePlayers($, homeTeam.code, awayTeam.code);
  const events = parseEvents($, homeTeam.code, awayTeam.code, debug);

  return {
    match: {
      external_id: externalId,
      date: header.dateIso,
      home_team: homeTeam,
      away_team: awayTeam,
      home_score: header.homeScore,
      away_score: header.awayScore,
      venue: header.venue,
      status,
    },
    teams: [homeTeam, awayTeam],
    players,
    events,
  };
}

function extractHeader($: CheerioAPI, debug: boolean) {
  const headerTable = $(SELECTORS.header.table).first();
  const scoreboardRow = headerTable.find('tr').eq(1);
  const statusText = cleanText(headerTable.find(SELECTORS.header.status).first().text());

  const homeCell = scoreboardRow.find(SELECTORS.header.homeName).first();
  const awayCell = scoreboardRow.find(SELECTORS.header.awayName).first();
  const homeScoreCell = scoreboardRow.find(SELECTORS.header.homeScore).first();
  const awayScoreCell = scoreboardRow.find(SELECTORS.header.awayScore).first();
  const metaCell = scoreboardRow.find(SELECTORS.header.meta).first();

  const homeNameRaw = cleanText(homeCell.find('p').first().text() || homeCell.text());
  const awayNameRaw = cleanText(awayCell.find('p').first().text() || awayCell.text());
  const homeScoreRaw = cleanText(homeScoreCell.text());
  const awayScoreRaw = cleanText(awayScoreCell.text());

  const headerTextCandidate = normalizeWhitespace(
    [homeNameRaw, `${homeScoreRaw}:${awayScoreRaw}`, awayNameRaw].filter(Boolean).join(' ')
  );

  const fallbackTitle = normalizeWhitespace($('title').first().text());
  const headerText = headerTextCandidate || fallbackTitle;

  let homeName = homeNameRaw || 'Home';
  let awayName = awayNameRaw || 'Away';
  let scoreStr = '';

  if (headerText) {
    const match = headerText.match(/^(.+?)\s+(\d+\s*[:\-]\s*\d+)\s+(.+?)$/);
    if (match) {
      homeName = normalizeWhitespace(match[1]);
      scoreStr = normalizeWhitespace(match[2]);
      awayName = normalizeWhitespace(match[3]);
    } else if (!homeNameRaw || !awayNameRaw) {
      const parts = headerText.split(/\s+-\s+/);
      if (parts.length >= 2) {
        const firstPart = normalizeWhitespace(parts[0]);
        const secondPart = normalizeWhitespace(parts[1]);
        const scoreMatch = secondPart.match(/^(\d+\s*[:\-]\s*\d+)\s+(.+)$/);
        if (scoreMatch) {
          homeName = firstPart;
          scoreStr = normalizeWhitespace(scoreMatch[1]);
          awayName = normalizeWhitespace(scoreMatch[2]);
        }
      }
    }
  }

  const scoreFromCells = parseScoreParts(homeScoreRaw, awayScoreRaw);
  const scoreFromString = parseScore(scoreStr);

  const homeScore = scoreFromCells.homeScore ?? scoreFromString.homeScore ?? undefined;
  const awayScore = scoreFromCells.awayScore ?? scoreFromString.awayScore ?? undefined;

  const metaLines = extractMetaLines(metaCell);
  const details = extractMetaDetails(metaLines);
  const dateIso = buildIso(details.dateText, details.timeText);

  const venue = details.venue || undefined;

  if (debug) {
    console.log('[HEADER]', {
      headerText,
      homeName,
      awayName,
      scoreStr: scoreStr || `${homeScore ?? ''}:${awayScore ?? ''}`,
      dateText: details.dateText,
      timeText: details.timeText,
      venue,
    });
  } else {
    if (!homeNameRaw) {
      logWarnOnce('home-team', homeCell.html()?.slice(0, 120) ?? headerText.slice(0, 120));
    }
    if (!awayNameRaw) {
      logWarnOnce('away-team', awayCell.html()?.slice(0, 120) ?? headerText.slice(0, 120));
    }
    if (homeScore === undefined || awayScore === undefined) {
      logWarnOnce('score', headerText.slice(0, 120));
    }
    if (!dateIso && (details.dateText || metaLines.length)) {
      logWarnOnce('date', metaLines.join(' | ').slice(0, 120));
    }
  }

  return {
    headerText,
    homeName,
    awayName,
    homeScore,
    awayScore,
    dateIso,
    venue,
    statusText,
  };
}

function extractMetaLines(metaCell: ReturnType<CheerioAPI['find']>) {
  if (!metaCell || !metaCell.length) return [];
  const html = metaCell.html() ?? '';
  if (!html) {
    const text = metaCell.text();
    return text.split(/\r?\n/).map(cleanText).filter(Boolean);
  }
  return html
    .split(/<br\s*\/?>/i)
    .map(segment => segment.replace(/<[^>]+>/g, ''))
    .map(cleanText)
    .filter(Boolean);
}

function extractMetaDetails(lines: string[]) {
  let dateText = '';
  let timeText = '';
  let venue = '';

  for (const line of lines) {
    if (!dateText && looksLikeDate(line)) {
      dateText = line;
      continue;
    }
    if (!timeText && /\d{1,2}:\d{2}/.test(line)) {
      timeText = line.match(/(\d{1,2}:\d{2})/)?.[1] ?? '';
      continue;
    }
  }

  if (!venue && lines.length) {
    venue = lines[lines.length - 1];
  }

  return { dateText, timeText, venue };
}

function looksLikeDate(value: string): boolean {
  return /(\d{1,2}\.\s*[A-Za-zĀ-ž]+,?\s*\d{4})|(\d{1,2}\.\d{1,2}\.\d{4})/.test(value);
}

function buildIso(dateText: string, timeText: string) {
  if (!dateText) return undefined;
  const parsed = parseLatvianDate(dateText) ?? parseNumericDate(dateText);
  if (!parsed) return undefined;
  const time = parseTime(timeText) ?? '00:00';
  const { year, month, day } = parsed;
  return `${year}-${pad(month)}-${pad(day)}T${time}:00Z`;
}

function parseLatvianDate(value: string) {
  const match = value.match(/(\d{1,2})\.\s*([A-Za-zĀ-ž]+),?\s*(\d{4})/);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  const monthName = normalizeMonth(match[2]);
  const year = Number.parseInt(match[3], 10);
  const month = LATVIAN_MONTHS[monthName];
  if (!month) return null;
  return { year, month, day };
}

function parseNumericDate(value: string) {
  const match = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return { year, month, day };
}

function parseTime(value: string | undefined) {
  if (!value) return undefined;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return undefined;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}

function normalizeMonth(raw: string) {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

function parsePlayers($: CheerioAPI, homeCode: string, awayCode: string) {
  const rosterSelectors = ['table:contains("Sastāvs")', 'table:contains("Roster")'];
  const players: Array<{ name: string; team_code: string }> = [];

  rosterSelectors.forEach(selector => {
    $(selector)
      .find('tr')
      .slice(1)
      .each((_, row) => {
        const cells = $(row).find('td');
        if (!cells.length) return;
        const nameRaw = cleanText(cells.eq(1).text());
        const teamRaw = cleanText(cells.eq(0).text());
        if (!nameRaw) return;
        const normalized = normalizeName(nameRaw);
        if (!normalized) return;
        const code = determineTeamCode(teamRaw, homeCode, awayCode);
        players.push({
          name: normalized,
          team_code: code ?? homeCode,
        });
      });
  });

  return dedupePlayers(players);
}

function dedupePlayers(players: Array<{ name: string; team_code: string }>) {
  const seen = new Set<string>();
  return players.filter(player => {
    const key = `${player.team_code}:${player.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseEvents(
  $: CheerioAPI,
  homeCode: string,
  awayCode: string,
  debug: boolean
) {
  const events: ParsedEventRow[] = [];

  const $table = $(SELECTORS.eventsTable).first();
  if (!$table.length) {
    return events;
  }

  $table.find(SELECTORS.eventRow).each((rowIndex, row) => {
    if (rowIndex === 0) return;
    const $row = $(row);
    const cells = $row.find('td');
    if (!cells.length) return;

    const teamClass = cells.first().attr('class') ?? '';
    const teamCode = teamClass.includes('maj')
      ? homeCode
      : teamClass.includes('vie')
      ? awayCode
      : null;
    if (!teamCode) return;

    const timeText = cleanText($row.find(SELECTORS.timeCell).text());
    const minute = parseMinute(timeText);
    if (minute === null) return;

    const typeText = cleanText($row.find(SELECTORS.typeCell).text());
    const eventType = mapEventKind(typeText);
    if (debug && typeText) {
      logEventTypeDetection(typeText, eventType);
    }

    const detailText = cleanText($row.find(SELECTORS.detailCell).text());
    if (!detailText) return;

    const { player, assist } = parseDetailNames(detailText);
    if (!player) return;

    const event: ParsedEventRow = {
      minute,
      team_code: teamCode,
      player_name: player,
      assist_name: assist ?? null,
      event_type: eventType,
      raw_detail: detailText,
    };

    if (eventType === 'penalty') {
      const penaltyMinutes = extractPenaltyMinutes(detailText);
      if (penaltyMinutes !== null) {
        event.penalty_minutes = penaltyMinutes;
        event.value = penaltyMinutes;
      }
    } else if (eventType === 'best_player') {
      event.value = 1;
    }

    if (debug) {
      console.log('[EVENT]', event);
    }

    events.push(event);
  });

  events.sort((a, b) => a.minute - b.minute);
  console.log('[parseMatch][event_count]', events.length);

  return events;
}

function parseScoreParts(homeRaw: string, awayRaw: string) {
  const homeScore = parseIntSafe(homeRaw);
  const awayScore = parseIntSafe(awayRaw);
  return { homeScore: homeScore ?? undefined, awayScore: awayScore ?? undefined };
}

function parseScore(raw: string) {
  const match = raw.match(/(\d+)\s*[-:–]\s*(\d+)/);
  if (!match) return {};
  return {
    homeScore: Number.parseInt(match[1], 10),
    awayScore: Number.parseInt(match[2], 10),
  };
}

function parseMinute(value: string): number | null {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number.parseInt(match[1], 10);
  if (Number.isNaN(minutes)) return null;
  return minutes;
}

function mapEventKind(raw: string): EventType {
  const normalized = normalizeForMatching(cleanText(raw));
  if (!normalized) return 'other';
  if (normalized.includes('labakais speletajs') || normalized.includes('best player')) return 'best_player';
  if (normalized.includes('varti') || normalized.includes('goal')) return 'goal';
  if (
    normalized.includes('sods') ||
    normalized.includes('penalty') ||
    normalized.includes('noraid')
  ) {
    return 'penalty';
  }
  return 'other';
}

function extractPenaltyMinutes(detail: string): number | string | null {
  const match = detail.match(/(\d+(?:\+\d+)?)\s*min/i);
  if (!match) return null;
  const value = match[1];
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return value;
}

function parseDetailNames(detail: string) {
  const segments = detail.split('(');
  const playerRaw = segments[0]?.trim() ?? '';
  const player = normalizeName(stripJersey(playerRaw));

  let assist: string | null = null;
  const assistMatch = detail.match(/\(([^)]+)\)/);
  if (assistMatch) {
    const inside = assistMatch[1];
    const candidate = inside.split(';')[0]?.split(',')[0]?.trim() ?? '';
    if (/#\d+/.test(candidate)) {
      assist = normalizeName(stripJersey(candidate));
    }
  }

  return { player, assist: assist || null };
}

function stripJersey(value: string): string {
  return value.replace(/^#\d+\s*/, '').trim();
}

function normalizeForMatching(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function determineTeamCode(raw: string, homeCode: string, awayCode: string): string | null {
  const value = cleanText(raw).toUpperCase();
  if (!value) return null;
  if (value.includes(homeCode.toUpperCase())) return homeCode;
  if (value.includes(awayCode.toUpperCase())) return awayCode;
  if (value.includes('HOME')) return homeCode;
  if (value.includes('AWAY')) return awayCode;
  return null;
}

function resolveStatus(raw: string): 'scheduled' | 'live' | 'finished' {
  const text = cleanText(raw).toLowerCase();
  if (!text) return 'scheduled';
  if (text.includes('beigusies') || text.includes('beidzies') || text.includes('finished')) {
    return 'finished';
  }
  if (text.includes('tiešraid') || text.includes('live')) {
    return 'live';
  }
  return 'scheduled';
}

function cleanText(value?: string | null): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseIntSafe(value: string) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

function deriveExternalId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const paramId = parsed.searchParams.get('id');
    if (paramId) return paramId;
    const slug = parsed.pathname.split('/').filter(Boolean).pop();
    return slug ?? null;
  } catch {
    return null;
  }
}

function logWarnOnce(key: string, snippet: string) {
  if (warningCache.has(key)) return;
  warningCache.add(key);
  console.warn(`[parseMatch][warn:${key}] ${snippet}`);
}

function logEventTypeDetection(raw: string, mapped: EventType) {
  const key = normalizeForMatching(raw);
  if (!key || debugEventTypeCache.has(key)) return;
  debugEventTypeCache.add(key);
  console.log('[EVENT][TYPE]', { raw, mapped });
}
