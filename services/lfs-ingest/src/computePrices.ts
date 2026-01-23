import { pathToFileURL } from 'node:url';
import { getEnv } from './env.js';
import { createSupabase } from './supa.js';

type FantasyPosition = 'A' | 'D' | 'V';
const MIN_GAMES = 5;

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
  fantasyGames?: number;
  fantasyTotal?: number;
  fantasyTotalAdjusted?: number;
};

const REPLACEMENT_INDEX: Record<FantasyPosition, number> = {
  A: 9, // 10th attacker
  D: 7, // 8th defender
  V: 2, // 3rd goalie
};

const PRICE_RANGE: Record<FantasyPosition, [number, number]> = {
  A: [4, 13],
  D: [3, 14],
  V: [5, 12],
};

function mapFantasyPosition(dbPos: string | null | undefined): FantasyPosition {
  if (dbPos === 'A') return 'D'; // DB defender -> fantasy defender
  if (dbPos === 'V') return 'V'; // goalie
  // default and 'U' -> attacker
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

  let mpQuery = supabase
    .from('player_match_points')
    .select('player_id, match_id, fantasy_points, fantasy_points_bonus, matches!inner(status, date)')
    .eq('matches.status', 'finished');
  if (seasonRange.start) {
    mpQuery = mpQuery.gte('matches.date', seasonRange.start);
  }
  if (seasonRange.end) {
    mpQuery = mpQuery.lt('matches.date', seasonRange.end);
  }

  const { data: matchPoints, error: matchPointsError } = await mpQuery;

  if (matchPointsError) {
    console.error('[prices] Failed to load player_match_points', matchPointsError);
    process.exitCode = 1;
    return;
  }

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
    const fppg =
      games >= MIN_GAMES ? (agg?.total ?? 0) / games : games > 0 ? (agg?.total ?? 0) / games : 0;

    computed[fantasyPosition].push({
      ...(raw as PlayerRow),
      fantasyPosition,
      fppg,
      fantasyGames: agg?.games ?? 0,
      fantasyTotal: agg?.total ?? 0,
    });
  }

  const updates: { id: string; price_computed: number; price_final: number }[] = [];
  const replacementByPos: Partial<Record<FantasyPosition, number>> = {};

  (['A', 'D'] satisfies FantasyPosition[]).forEach((fantasyPosition) => {
    const group = computed[fantasyPosition];
    if (!group.length) return;

    group.sort((a, b) => b.fppg - a.fppg);
    const replacementIdx = Math.min(REPLACEMENT_INDEX[fantasyPosition], group.length - 1);
    const replacementFppg = group[replacementIdx]?.fppg ?? 0;
    replacementByPos[fantasyPosition] = replacementFppg;

    // Compute VORP relative to replacement and then rank by VORP.
    group.forEach((player) => {
      player.vorp = Math.max(player.fppg - replacementFppg, 0);
    });

    group.sort((a, b) => (b.vorp ?? 0) - (a.vorp ?? 0));
    const [minPrice, maxPrice] = PRICE_RANGE[fantasyPosition];

    group.forEach((player, index) => {
      const p = group.length > 1 ? index / (group.length - 1) : 0;
      const inv = 1 - p;
      const curved = Math.pow(inv, 0.8);
      const priceRaw = minPrice + curved * (maxPrice - minPrice);
      let adjusted = priceRaw;
      if (fantasyPosition === 'V') {
        adjusted *= 1.03;
      }
      const clamped = Math.min(maxPrice, Math.max(minPrice, adjusted));
      const computedPrice = Math.round(clamped * 2) / 2; // nearest 0.5
      const finalPrice = player.price_manual ?? computedPrice;

      player.finalPrice = finalPrice;

      updates.push({
        id: player.id,
        price_computed: computedPrice,
        price_final: finalPrice,
      });
    });
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

  console.log(`[prices] Processed ${updates.length} players for rank-based VORP pricing`);
  console.log(
    `[prices] Replacement FPPG -> A: ${replacementByPos.A?.toFixed(2) ?? 'n/a'}, D: ${
      replacementByPos.D?.toFixed(2) ?? 'n/a'
    }, V: ${replacementByPos.V?.toFixed(2) ?? 'n/a'}`,
  );

  for (const row of updates) {
    const { error: updateError } = await supabase
      .from('players')
      .update({ price_computed: row.price_computed, price_final: row.price_final })
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
    console.log(
      `[prices] ${fantasyPosition} count=${group.length} top fppg=${group[0]?.fppg.toFixed(
        2,
      )} replacement=${replacementByPos[fantasyPosition]?.toFixed(2) ?? 'n/a'} price range ${min}-${max}`,
    );
  });

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
