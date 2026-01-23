import { pathToFileURL } from 'node:url';
import { getEnv } from './env.js';
import { createSupabase } from './supa.js';

type FantasyPosition = 'A' | 'D' | 'V';

type PlayerRow = {
  id: string;
  name?: string | null;
  position?: string | null;
  price_manual?: number | null;
  games?: number | null;
  goals?: number | null;
  assists?: number | null;
  saves?: number | null;
  save_pct?: number | null;
  save_percent?: number | null;
  goals_against?: number | null;
  goals_allowed?: number | null;
  points_total?: number | null;
  penalty_min?: number | null;
  pen_min?: number | null;
};

type ComputedPlayer = PlayerRow & {
  fantasyPosition: FantasyPosition;
  fppg: number;
  vorp?: number;
  finalPrice?: number;
  computedPrice?: number;
  fppgAdjusted?: number;
  fantasyGames?: number;
  fantasyTotal?: number;
  fantasyTotalAdjusted?: number;
};

const PRICE_RANGE: Record<FantasyPosition, [number, number]> = {
  A: [4.5, 13], // attackers (U)
  D: [4.0, 14], // defenders (A)
  V: [5, 12],   // goalies unchanged
};

const UNKNOWN_POSITION_LOGGED = new Set<string>();

function mapFantasyPosition(dbPos: string | null | undefined): FantasyPosition {
  const norm = (dbPos ?? '').toUpperCase();
  if (norm.startsWith('V')) return 'V';
  if (norm.startsWith('A')) return 'D';
  if (norm.startsWith('U')) return 'A';
  if (!UNKNOWN_POSITION_LOGGED.has(norm)) {
    UNKNOWN_POSITION_LOGGED.add(norm);
    console.warn('[prices] Unknown position; defaulting to attacker', { raw: dbPos });
  }
  return 'A';
}

function asNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function fetchCurrentSeason(client: ReturnType<typeof createSupabase>['client']): Promise<string | null> {
  const { data, error } = await client
    .from('matches')
    .select('season')
    .not('season', 'is', null)
    .order('season', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[prices] Failed to fetch current season; continuing without season filter', error);
    return null;
  }
  return (data as any)?.season ?? null;
}

function seasonToRange(season: string | null): { start: string | null; end: string | null } {
  if (!season) return { start: null, end: null };
  const match = season.match(/^(\d{4})-(\d{2})$/);
  if (!match) return { start: null, end: null };
  const startYear = Number(match[1]);
  const endYear = startYear + 1;
  return {
    start: new Date(Date.UTC(startYear, 8, 1, 0, 0, 0)).toISOString(), // Sep 1 start
    end: new Date(Date.UTC(endYear, 8, 1, 0, 0, 0)).toISOString(), // Sep 1 next year
  };
}

async function fetchAllRows<T>(makeQuery: () => any, pageSize = 1000): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await makeQuery().range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

function goalieGaBand(goalsAgainstPerGame: number): number {
  if (!Number.isFinite(goalsAgainstPerGame)) {
    return 0;
  }
  if (goalsAgainstPerGame <= 0) return 8;
  if (goalsAgainstPerGame <= 2) return 5;
  if (goalsAgainstPerGame <= 5) return 2;
  if (goalsAgainstPerGame <= 9) return -2;
  return -5;
}

function computeFantasyPoints(player: PlayerRow, fantasyPosition: FantasyPosition): number {
  const goals = asNumber(player.goals);
  const assists = asNumber(player.assists);
  const saves = asNumber(player.saves);
  const games = Math.max(0, asNumber(player.games));
  const penaltyMinutes = asNumber(player.penalty_min ?? player.pen_min);

  if (fantasyPosition === 'V') {
    const goalsAgainstTotal = asNumber(player.goals_against ?? player.goals_allowed);
    const gaPerGame = games > 0 ? goalsAgainstTotal / games : goalsAgainstTotal;
    const gaBandPoints = games > 0 ? goalieGaBand(gaPerGame) * games : 0;
    const savePoints = saves * 0.1;
    // Fall back to skater scoring if goal/assist stats exist for a goalie.
    const skaterPoints = goals * 1.5 + assists * 1.0;
    return gaBandPoints + savePoints + skaterPoints;
  }

  const goalWeight = fantasyPosition === 'D' ? 2.0 : 1.5;
  const assistWeight = fantasyPosition === 'D' ? 1.5 : 1.0;
  // Approximate penalties: treat each 2-minute block as a minor penalty (-0.5).
  const penaltyBlocks = penaltyMinutes / 2;
  const penaltyPoints = penaltyBlocks * -0.5;

  return goals * goalWeight + assists * assistWeight + penaltyPoints;
}

async function main(): Promise<void> {
  const env = getEnv();
  const supa = createSupabase(env);
  const supabase = supa.client;

  const currentSeason = await fetchCurrentSeason(supabase);
  const seasonRange = seasonToRange(currentSeason);

  const makeMpQuery = () => {
    let q = supabase
      .from('player_match_points')
      .select('player_id, match_id, fantasy_points, fantasy_points_bonus, matches!inner(status, season, date)')
      .eq('matches.status', 'finished');
    if (seasonRange.start) {
      q = q.gte('matches.date', seasonRange.start);
    }
    if (seasonRange.end) {
      q = q.lt('matches.date', seasonRange.end);
    }
    return q;
  };

  let matchPoints: any[] = [];
  try {
    matchPoints = await fetchAllRows<any>(makeMpQuery, 1000);
  } catch (matchPointsError) {
    console.error('[prices] Failed to load player_match_points', matchPointsError);
    process.exitCode = 1;
    return;
  }
  console.log('[prices] Loaded player_match_points rows:', matchPoints.length);

  type PmpAgg = { games: number; total: number };
  const pmpMap = new Map<string, PmpAgg>();
  const seenPerPlayer = new Map<string, Set<string>>();

  for (const row of matchPoints ?? []) {
    const playerId = (row as any).player_id as string | null;
    const matchId = (row as any).match_id as string | null;
    if (!playerId || !matchId) continue;
    let seen = seenPerPlayer.get(playerId);
    if (!seen) {
      seen = new Set();
      seenPerPlayer.set(playerId, seen);
    }
    if (seen.has(matchId)) continue;
    seen.add(matchId);
    const totalPoints = asNumber((row as any).fantasy_points) + asNumber((row as any).fantasy_points_bonus);
    const agg = pmpMap.get(playerId) ?? { games: 0, total: 0 };
    agg.games += 1;
    agg.total += totalPoints;
    pmpMap.set(playerId, agg);
  }

  const { data: players, error } = await supabase.from('players').select('*');
  if (error) {
    console.error('[prices] Failed to load players', error);
    process.exitCode = 1;
    return;
  }

  const computed: Record<FantasyPosition, ComputedPlayer[]> = {
    A: [],
    D: [],
    V: [],
  };

  for (const raw of players ?? []) {
    if (!raw?.id) continue;
    const fantasyPosition = mapFantasyPosition((raw as PlayerRow).position ?? null);
    const agg = pmpMap.get(raw.id);
    const games = agg?.games ?? 0;
    const fppg = games > 0 ? (agg?.total ?? 0) / games : 0;

    computed[fantasyPosition].push({
      ...(raw as PlayerRow),
      fantasyPosition,
      fppg,
      fantasyGames: agg?.games ?? 0,
      fantasyTotal: agg?.total ?? 0,
    });
  }

  const updates: { id: string; price_computed: number; price_final: number }[] = [];

  // Skater pricing (MVP):
  // - attackers: sqrt(total + 6) with logistic soft-cap to avoid max-price pile
  // - defenders: sqrt(total + 18) + 15% premium (scarcer slots)
  // - goalies: separate logic below (do not touch without approval)
  (['A', 'D'] satisfies FantasyPosition[]).forEach((fantasyPosition) => {
    const group = computed[fantasyPosition];
    if (!group.length) return;

    const [minPrice, maxPrice] = PRICE_RANGE[fantasyPosition];

    const priced = [...group].sort((a, b) => {
      const totalDiff = (b.fantasyTotal ?? 0) - (a.fantasyTotal ?? 0);
      if (totalDiff !== 0) return totalDiff;
      const gamesDiff = (b.fantasyGames ?? 0) - (a.fantasyGames ?? 0);
      if (gamesDiff !== 0) return gamesDiff;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });

    priced.forEach((player) => {
      const total = asNumber(player.fantasyTotal ?? 0);
      const OFFSET_A = 6;
      const OFFSET_D = 18;
      const offset = fantasyPosition === 'D' ? OFFSET_D : OFFSET_A;

      const effective = Math.sqrt(Math.max(0, total) + offset);

      const divisor = fantasyPosition === 'A' ? 0.55 : 0.70; // A=attackers(U), D=defenders(A)
      let computedPrice = effective / divisor;

      const span = maxPrice - minPrice;
      if (fantasyPosition === 'A' && span > 0) {
        const alpha = 0.35;
        const x = Math.max(0, computedPrice - minPrice);
        const t = 1 - Math.exp(-alpha * x); // 0..1 (approaches 1)
        computedPrice = minPrice + t * span;
      } else if (span > 0) {
        const t = Math.min(1, Math.max(0, (computedPrice - minPrice) / span));
        const tCurved = Math.pow(t, 1.25); // >1 compresses the top end (defenders keep prior behavior)
        computedPrice = minPrice + tCurved * span;
      }

      // defender premium: defenders are scarcer slots, make them slightly more expensive
      if (fantasyPosition === 'D') {
        computedPrice = computedPrice * 1.15;
      }

      computedPrice = Math.min(maxPrice, Math.max(minPrice, computedPrice));
      computedPrice = Math.round(computedPrice * 2) / 2;

      const finalPrice = player.price_manual ?? computedPrice;
      player.fantasyTotalAdjusted = total;
      player.computedPrice = computedPrice;
      player.finalPrice = finalPrice;

      updates.push({
        id: player.id,
        price_computed: computedPrice,
        price_final: finalPrice,
      });
    });

    const topPreview = priced.slice(0, 10).map((p) => ({
      name: p.name ?? 'Unknown',
      games: p.fantasyGames ?? 0,
      fppg: (p.fppg ?? 0).toFixed(2),
      total: (p.fantasyTotal ?? 0).toFixed(1),
      price: (p.finalPrice ?? 0).toFixed(1),
    }));
    console.log(
      `[prices] Skater ${fantasyPosition} count=${group.length} top=${topPreview
        .map((t) => `${t.name}:${t.games}g fppg=${t.fppg} total=${t.total} @${t.price}`)
        .join(', ')}`,
    );
  });

  // Goalie pricing: games-weighted fantasy totals mapped to percentile range 5..14
  const goalies = computed.V;
  if (goalies.length) {
    goalies.forEach((player) => {
      const games = player.fantasyGames ?? 0;
      const total = player.fantasyTotal ?? 0;
      const weight = games > 0 ? games / (games + 5) : 0;
      player.fantasyTotalAdjusted = total * weight;
    });

    // Sort ascending to map percentile directly; higher score ends up with higher percentile.
    goalies.sort((a, b) => (a.fantasyTotalAdjusted ?? 0) - (b.fantasyTotalAdjusted ?? 0));
    const [minPrice, maxPrice] = [5, 14];
    goalies.forEach((player, index) => {
      const percentile = goalies.length > 1 ? index / (goalies.length - 1) : 0;
      const priceRaw = minPrice + percentile * (maxPrice - minPrice);
      const clamped = Math.min(maxPrice, Math.max(minPrice, priceRaw));
      const computedPrice = Math.round(clamped * 2) / 2;
      const finalPrice = player.price_manual ?? computedPrice;
      updates.push({
        id: player.id,
        price_computed: computedPrice,
        price_final: finalPrice,
      });
    });
  }

  console.log(`[prices] Processed ${updates.length} players for pricing`);

  for (const row of updates) {
    const { error: updateError } = await supabase
      .from('players')
      .update({ price_computed: row.price_computed, price_final: row.price_final, price: Math.round(row.price_final) })
      .eq('id', row.id);

    if (updateError) {
      console.error('[prices] Failed to update prices', updateError);
      process.exitCode = 1;
      return;
    }
  }
  console.log('[prices] Updated prices for', updates.length, 'players');

  (['A', 'D', 'V'] satisfies FantasyPosition[]).forEach((fantasyPosition) => {
    const group = computed[fantasyPosition];
    if (!group.length) {
      console.log(`[prices] No players for position ${fantasyPosition}`);
      return;
    }
    const finals = group.map((p) => p.finalPrice ?? 0);
    const min = Math.min(...finals).toFixed(1);
    const max = Math.max(...finals).toFixed(1);
    console.log(`[prices] ${fantasyPosition} count=${group.length} top fppg=${group[0]?.fppg.toFixed(2)} price range ${min}-${max}`);
  });

  const logTopSkaters = (pos: FantasyPosition) => {
    if (pos === 'V') return;
    const group = computed[pos];
    if (!group.length) return;
    const top = [...group]
      .sort((a, b) => (b.fantasyTotalAdjusted ?? 0) - (a.fantasyTotalAdjusted ?? 0))
      .slice(0, 10)
      .map((p) => `${p.name ?? 'Unknown'}:${(p.fantasyTotalAdjusted ?? 0).toFixed(2)}@${(p.finalPrice ?? 0).toFixed(1)}`);
    console.log(`[prices] Top ${pos} fppg_adj -> price:`, top);
  };
  logTopSkaters('A');
  logTopSkaters('D');

  const skaters = [...computed.A, ...computed.D];
  if (skaters.length) {
    const expensiveLowTotal = [...skaters]
      .sort(
        (a, b) =>
          (b.finalPrice ?? 0) - (a.finalPrice ?? 0) ||
          (a.fantasyTotal ?? 0) - (b.fantasyTotal ?? 0),
      )
      .slice(0, 10)
      .map(
        (p) =>
          `${p.name ?? 'Unknown'}:${(p.finalPrice ?? 0).toFixed(1)} pts=${(p.fantasyTotal ?? 0).toFixed(
            1,
          )} vorp=${(p.vorp ?? 0).toFixed(2)}`,
      );
    console.log('[prices] Expensive skaters with lowest totals:', expensiveLowTotal);
  }

  const samplePlayers = Object.values(computed)
    .flat()
    .sort((a, b) => (b.vorp ?? 0) - (a.vorp ?? 0))
    .slice(0, 5);

  if (samplePlayers.length) {
    console.log('[prices] Sample players:');
    for (const player of samplePlayers) {
      console.log(
        `  ${player.id} ${player.name ?? 'Unknown'} (${player.fantasyPosition}) fppg=${player.fppg.toFixed(
          2,
        )} vorp=${(player.vorp ?? 0).toFixed(2)} price=${(player.finalPrice ?? 0).toFixed(1)}`,
      );
    }
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error) => {
    console.error('[prices] Fatal error', error);
    process.exitCode = 1;
  });
}
