import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { SEASON_BUDGET_CREDITS } from '../constants/fantasyRules';
import { usePlayers } from './usePlayers';

export type SquadSlotKey = 'U1' | 'U2' | 'U3' | 'U4' | 'A1' | 'A2' | 'V1' | 'F1';
export type SquadSlot = { slot_key: SquadSlotKey; player_id: string | null };
export type SquadState = {
  slots: SquadSlot[];
  captainId: string | null;
  budgetTotal: number;
  transfersLeft: number;
  season: string;
  playerDetails: Record<string, {
    id: string;
    name: string | null;
    position: string | null;
    team: string | null;
    price_final: number | null;
    price: number | null;
    points_total?: number | null;
    points?: number | null;
    joined_at?: string | null;
    left_at?: string | null;
  }>;
  teamPoints: number;
};

const SLOT_KEYS: SquadSlotKey[] = ['U1', 'U2', 'U3', 'U4', 'A1', 'A2', 'V1', 'F1'];
const DEFAULT_SEASON = '2025/2026';
const STORAGE_KEY = `squad-cache-${DEFAULT_SEASON}`;
const SLOT_POS: Record<SquadSlotKey, 'U' | 'A' | 'V' | 'FLEX'> = {
  U1: 'U',
  U2: 'U',
  U3: 'U',
  U4: 'U',
  A1: 'A',
  A2: 'A',
  V1: 'V',
  F1: 'FLEX',
};

type SquadSnapshot = {
  slots: SquadSlot[];
  captainId: string | null;
  budgetTotal: number;
  transfersLeft: number;
  season: string;
  playerDetails: SquadState['playerDetails'];
};

export function useSquad() {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [state, setState] = useState<SquadState>({
    slots: SLOT_KEYS.map(slot_key => ({ slot_key, player_id: null })),
    captainId: null,
    budgetTotal: SEASON_BUDGET_CREDITS,
    transfersLeft: 3,
    season: DEFAULT_SEASON,
    playerDetails: {},
    teamPoints: 0,
  });
  const [savedSnapshot, setSavedSnapshot] = useState<SquadSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: players } = usePlayers({ sort: 'price_desc', pageSize: 200 });
  const playerMap = useMemo(() => {
    const m = new Map<string, (typeof players)[number]>();
    players.forEach(p => m.set(p.id, p));
    return m;
  }, [players]);

  const supabase = getSupabaseClient();

  const selectedPlayers = useMemo(() => {
    return state.slots
      .map(slot => {
        if (!slot.player_id) return null;
        const detail = state.playerDetails[slot.player_id] as any;
        if (detail) return detail;
        return players.find(p => p.id === slot.player_id) ?? null;
      })
      .filter(Boolean);
  }, [players, state.playerDetails, state.slots]);

  const positionToGroup = (pos?: string | null): 'U' | 'A' | 'V' => {
    if (!pos) return 'U';
    const normalized = pos.toUpperCase();
    if (normalized === 'U') return 'U';
    if (normalized === 'A' || normalized === 'D') return 'A';
    if (normalized === 'V' || normalized === 'G') return 'V';
    return 'U';
  };

  const getOrCreateFantasyTeam = useCallback(async (): Promise<string | null> => {
    if (!isSupabaseConfigured()) return null;
    const { data: userResp, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userResp.user) return null;
    const userId = userResp.user.id;

    const { data: existingTeam, error: teamErr } = await supabase
      .from('fantasy_teams')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (teamErr && teamErr.code !== 'PGRST116') throw teamErr;
    if (existingTeam?.id) return existingTeam.id;

    const { data: inserted, error: insertErr } = await supabase
      .from('fantasy_teams')
      .insert({
        user_id: userId,
        budget: state.budgetTotal,
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;
    return inserted.id;
  }, [state.budgetTotal, supabase]);

  const persistCache = useCallback(async (snapshot: SquadSnapshot) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn('[useSquad] Failed to cache squad locally', err);
    }
  }, []);

  const loadFromCache = useCallback(async (): Promise<SquadSnapshot | null> => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SquadSnapshot>;
      return {
        slots: parsed.slots ?? SLOT_KEYS.map(slot_key => ({ slot_key, player_id: null })),
        captainId: parsed.captainId ?? null,
        budgetTotal: parsed.budgetTotal ?? SEASON_BUDGET_CREDITS,
        transfersLeft: parsed.transfersLeft ?? 3,
        season: parsed.season ?? DEFAULT_SEASON,
        playerDetails: parsed.playerDetails ?? {},
      };
    } catch (err) {
      console.warn('[useSquad] Failed to parse cached squad', err);
      return null;
    }
  }, []);

  const loadSquad = useCallback(async (options?: { overrideTransfersLeft?: number }) => {
    setLoading(true);
    setError(null);
    try {
      const cached = await loadFromCache();
      if (cached) {
        setState(cached);
        setSavedSnapshot(cached);
      }

      if (!isSupabaseConfigured()) {
        if (!cached) {
          setError('Supabase not configured');
        }
        return;
      }

      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) {
        if (!cached) {
          setError('Not signed in');
        }
        return;
      }
      const userId = userResp.user.id;

      const { data: teamRow, error: teamErr } = await supabase
        .from('fantasy_teams')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (teamErr && teamErr.code !== 'PGRST116') throw teamErr;
      if (!teamRow?.id) {
        const empty: SquadSnapshot = {
          slots: SLOT_KEYS.map(slot_key => ({ slot_key, player_id: null })),
          captainId: null,
          budgetTotal: SEASON_BUDGET_CREDITS,
          transfersLeft: state.transfersLeft,
          season: DEFAULT_SEASON,
          playerDetails: {},
        };
        setState(empty);
        setSavedSnapshot(empty);
        persistCache(empty);
        return;
      }

      setTeamId(teamRow.id);

      const { data: playerRows, error: playersErr } = await supabase
        .from('fantasy_team_players')
        .select(
          `
          player_id,
          is_captain,
          joined_at,
          left_at,
          players (
            id,
            name,
            position,
            team,
            price,
            price_final,
            points_total,
            points
          )
        `
        )
        .eq('fantasy_team_id', teamRow.id)
        .is('left_at', null);
      if (playersErr && playersErr.code !== 'PGRST116') throw playersErr;

      const mapped = (playerRows ?? []).map(row => ({
        id: row.player_id as string | null,
        isCaptain: Boolean(row.is_captain),
        group: positionToGroup((row as any).players?.position),
        detail: row.players
          ? {
              ...row.players,
              joined_at: row.joined_at ?? null,
              left_at: row.left_at ?? null,
            }
          : null,
      }));

      const available = [...mapped];
      const mergedSlots: SquadSlot[] = SLOT_KEYS.map(slot_key => {
        const desired = SLOT_POS[slot_key];
        let idx = available.findIndex(p => p.id && p.group === desired);
        if (idx === -1 && desired === 'FLEX') {
          idx = available.findIndex(p => p.id);
        }
        if (idx === -1 && desired !== 'FLEX') {
          idx = available.findIndex(p => p.id);
        }
        const chosen = idx >= 0 ? available.splice(idx, 1)[0] : null;
        return { slot_key, player_id: chosen?.id ?? null };
      });

      const captainRow = mapped.find(p => p.isCaptain);
      const detailMap: SquadState['playerDetails'] = {};
      mapped.forEach(p => {
        if (p.id) detailMap[p.id] = p.detail ?? detailMap[p.id] ?? { id: p.id, name: null, position: null, team: null, price: null, price_final: null };
      });
      const snapshot: SquadSnapshot = {
        slots: mergedSlots,
        captainId: captainRow?.id ?? null,
        budgetTotal: SEASON_BUDGET_CREDITS,
        transfersLeft: options?.overrideTransfersLeft ?? state.transfersLeft,
        season: DEFAULT_SEASON,
        playerDetails: detailMap,
        teamPoints: cached?.teamPoints ?? 0,
      };
      try {
        const { data: pointsRow } = await supabase
          .from('user_team_points_view')
          .select('total_points')
          .eq('fantasy_team_id', teamRow.id)
          .maybeSingle();
        if (pointsRow && typeof pointsRow.total_points === 'number') {
          snapshot.teamPoints = pointsRow.total_points;
        }
      } catch {
        // ignore errors
      }
      setState(snapshot);
      setSavedSnapshot(snapshot);
      persistCache(snapshot);
    } catch (e: any) {
      console.error('[useSquad] load error', e);
      setError(e?.message ?? 'Failed to load squad');
    } finally {
      setLoading(false);
    }
  }, [loadFromCache, persistCache, supabase, state.transfersLeft]);

  const updateSlot = useCallback((slot_key: SquadSlotKey, player_id: string | null) => {
    setState(prev => {
      const slots = prev.slots.map(s => (s.slot_key === slot_key ? { ...s, player_id } : s));
      return { ...prev, slots };
    });
  }, []);

  const setCaptain = useCallback((playerId: string | null) => {
    setState(prev => ({ ...prev, captainId: playerId }));
  }, []);

  const chooseCaptain = useCallback(
    async (playerId: string) => {
      if (!isSupabaseConfigured()) {
        return { ok: false, error: 'Supabase not configured' };
      }
      const team = teamId ?? (await getOrCreateFantasyTeam());
      if (!team) {
        return { ok: false, error: 'No fantasy team' };
      }
      try {
        const { error: rpcErr, data } = await supabase.rpc('set_captain', { p_team_id: team, p_player_id: playerId });
        if (rpcErr) {
          const detail = (rpcErr as any)?.details ?? rpcErr?.message ?? '';
          if (String(detail).includes('CAPTAIN_COOLDOWN')) {
            return { ok: false, error: detail };
          }
          return { ok: false, error: rpcErr.message ?? 'Failed to set captain' };
        }

        setCaptain(playerId);
        const nextSnapshot: SquadSnapshot = {
          ...state,
          captainId: playerId,
        };
        setSavedSnapshot(nextSnapshot);
        await persistCache(nextSnapshot);
        return { ok: true };
      } catch (e: any) {
        console.error('[useSquad] chooseCaptain error', e);
        return { ok: false, error: e?.message ?? 'Failed to set captain' };
      }
    },
    [getOrCreateFantasyTeam, persistCache, setCaptain, state, supabase, teamId]
  );

  const saveSquad = useCallback(async () => {
    const fail = (message: string) => {
      setError(message);
      Alert.alert('Save failed', message);
      return { ok: false, error: message };
    };
    const existingTransfers = savedSnapshot?.transfersLeft ?? state.transfersLeft;
    const transfersUsed = SLOT_KEYS.reduce((count, key) => {
      const prevId = savedSnapshot?.slots.find(s => s.slot_key === key)?.player_id;
      const nextId = state.slots.find(s => s.slot_key === key)?.player_id;
      if (prevId && nextId && prevId !== nextId) return count + 1;
      return count;
    }, 0);
    if (existingTransfers - transfersUsed < 0) {
      setError('No transfers left to save these changes.');
      Alert.alert('No transfers left', 'You do not have enough transfers to save these changes.');
      return { ok: false, error: 'Not enough transfers' };
    }
    const nextTransfersLeft = existingTransfers - transfersUsed;

    setSaving(true);
    const snapshot: SquadSnapshot = {
      slots: state.slots,
      captainId: state.captainId,
      budgetTotal: state.budgetTotal,
      transfersLeft: nextTransfersLeft,
      season: state.season,
      playerDetails: state.playerDetails,
      teamPoints: state.teamPoints,
    };
    try {
      if (isSupabaseConfigured()) {
        const team = await getOrCreateFantasyTeam();
        if (!team) {
          return fail('Unable to load fantasy team for this account.');
        }
        setTeamId(team);

        const captainId = state.captainId;
        if (!captainId) {
          return fail('Choose a captain before saving.');
        }

        const newIds = state.slots.map(s => s.player_id).filter(Boolean) as string[];

        // Fetch current active rows
        const { data: activeRows, error: activeErr } = await supabase
          .from('fantasy_team_players')
          .select('player_id')
          .eq('fantasy_team_id', team)
          .is('left_at', null);
        if (activeErr) {
          return fail(activeErr.message ?? 'Failed to load current squad');
        }
        const activeIds = (activeRows ?? []).map(r => r.player_id);

        // Close memberships not in the new squad
        const toClose = activeIds.filter(id => !newIds.includes(id));
        if (toClose.length) {
          const { error: closeErr } = await supabase
            .from('fantasy_team_players')
            .update({ left_at: new Date().toISOString(), is_captain: false, captain_to: new Date().toISOString() })
            .eq('fantasy_team_id', team)
            .in('player_id', toClose)
            .is('left_at', null);
          if (closeErr) {
            return fail(closeErr.message ?? 'Failed to close removed players');
          }
        }

        // Add new memberships for players not already active
        const toInsert = newIds.filter(id => !activeIds.includes(id));
        if (toInsert.length) {
          const { error: insertErr } = await supabase.from('fantasy_team_players').insert(
            toInsert.map(id => ({
              fantasy_team_id: team,
              player_id: id,
              is_captain: false,
              joined_at: new Date().toISOString(),
              left_at: null,
            }))
          );
          if (insertErr) {
            return fail(insertErr.message ?? 'Failed to add new players');
          }
        }

        // Ensure captain via RPC (handles cooldown)
        const { error: captainErr } = await supabase.rpc('set_captain', { p_team_id: team, p_player_id: captainId });
        if (captainErr) {
          const detail = (captainErr as any)?.details ?? captainErr?.message ?? '';
          return fail(detail || 'Failed to set captain');
        }

        // Refresh points after successful transfer window updates
        try {
          await loadSquad({ overrideTransfersLeft: nextTransfersLeft });
        } catch (loadErr: any) {
          console.warn('[useSquad] refresh after save failed', loadErr);
        }
        return { ok: true };
      }
      // If Supabase is not configured, just update local state/cache
      setState(prev => ({ ...prev, transfersLeft: nextTransfersLeft }));
      setSavedSnapshot(snapshot);
      await persistCache(snapshot);
      return { ok: true };
    } catch (e: any) {
      console.error('[useSquad] save error', e);
      setError(e?.message ?? 'Failed to save squad');
      return { ok: false, error: e?.message ?? 'Failed to save squad' };
    } finally {
      setSaving(false);
    }
  }, [getOrCreateFantasyTeam, loadSquad, persistCache, savedSnapshot, state, supabase]);

  const totalCost = useMemo(() => {
    let sum = 0;
    state.slots.forEach(s => {
      if (s.player_id) {
        const p = playerMap.get(s.player_id);
        const price =
          typeof p?.price_final === 'number' && !Number.isNaN(p.price_final)
            ? p.price_final
            : typeof p?.price === 'number' && !Number.isNaN(p.price)
            ? p.price
            : 0;
        sum += price;
      }
    });
    return sum;
  }, [playerMap, state.slots]);

  const remainingBudget = state.budgetTotal - totalCost;
  const pendingTransfersUsed = useMemo(() => {
    if (!savedSnapshot) return 0;
    return SLOT_KEYS.reduce((count, key) => {
      const prevId = savedSnapshot.slots.find(s => s.slot_key === key)?.player_id;
      const nextId = state.slots.find(s => s.slot_key === key)?.player_id;
      if (prevId && nextId && prevId !== nextId) return count + 1;
      return count;
    }, 0);
  }, [savedSnapshot, state.slots]);

  const resetUnsavedChanges = useCallback(() => {
    if (savedSnapshot) {
      setState(savedSnapshot);
    }
  }, [savedSnapshot]);

  return {
    state,
    setState,
    savedSnapshot,
    teamId,
    loading,
    saving,
    error,
    loadSquad,
    saveSquad,
    updateSlot,
    setCaptain,
    chooseCaptain,
    resetUnsavedChanges,
    totalCost,
    remainingBudget,
    players,
    pendingTransfersUsed,
    selectedPlayers,
  };
}
