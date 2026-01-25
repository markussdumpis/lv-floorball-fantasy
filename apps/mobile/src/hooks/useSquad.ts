import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { SEASON_BUDGET_CREDITS } from '../constants/fantasyRules';
import { usePlayers } from './usePlayers';

export type SquadSlotKey = 'U1' | 'U2' | 'U3' | 'U4' | 'A1' | 'A2' | 'V1' | 'F1';
export type SquadSlot = { slot_key: SquadSlotKey; player_id: string | null };
export type SquadState = {
  slots: SquadSlot[];
  budgetTotal: number;
  transfersLeft: number;
  season: string;
};

const SLOT_KEYS: SquadSlotKey[] = ['U1', 'U2', 'U3', 'U4', 'A1', 'A2', 'V1', 'F1'];
const DEFAULT_SEASON = '2025/2026';

export function useSquad() {
  const [squadId, setSquadId] = useState<string | null>(null);
  const [state, setState] = useState<SquadState>({
    slots: SLOT_KEYS.map(slot_key => ({ slot_key, player_id: null })),
    budgetTotal: SEASON_BUDGET_CREDITS,
    transfersLeft: 3,
    season: DEFAULT_SEASON,
  });
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

  const loadSquad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured()) {
        setError('Supabase not configured');
        return;
      }
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) {
        setError('Not signed in');
        return;
      }
      const userId = userResp.user.id;
      const { data: squad, error: squadErr } = await supabase
        .from('user_squads')
        .select('*')
        .eq('user_id', userId)
        .eq('season', DEFAULT_SEASON)
        .maybeSingle();
      let squadRow = squad;
      if (squadErr && squadErr.code !== 'PGRST116') throw squadErr;
      if (!squadRow) {
        const { data: inserted, error: insertErr } = await supabase
          .from('user_squads')
          .insert({ user_id: userId, season: DEFAULT_SEASON })
          .select('*')
          .single();
        if (insertErr) throw insertErr;
        squadRow = inserted;
        const slotRows = SLOT_KEYS.map(slot_key => ({ squad_id: inserted.id, slot_key, player_id: null }));
        await supabase.from('user_squad_slots').insert(slotRows);
      }
      setSquadId(squadRow.id);
      const budgetTotal = SEASON_BUDGET_CREDITS;
      setState(prev => ({
        ...prev,
        budgetTotal,
        transfersLeft: squadRow.transfers_left ?? 3,
        season: squadRow.season ?? DEFAULT_SEASON,
      }));

      const { data: slots, error: slotsErr } = await supabase
        .from('user_squad_slots')
        .select('slot_key, player_id')
        .eq('squad_id', squadRow.id);
      if (slotsErr) throw slotsErr;
      const missingSlotKeys = SLOT_KEYS.filter(k => !(slots ?? []).some(s => s.slot_key === k));
      if (missingSlotKeys.length > 0) {
        const insertRows = missingSlotKeys.map(slot_key => ({
          squad_id: squadRow.id,
          slot_key,
          player_id: null,
        }));
        await supabase.from('user_squad_slots').insert(insertRows);
        if (slots) {
          slots.push(...insertRows);
        }
      }
      const mergedSlots: SquadSlot[] = SLOT_KEYS.map(slot_key => {
        const row = slots?.find(s => s.slot_key === slot_key);
        return { slot_key, player_id: row?.player_id ?? null };
      });
      setState(prev => ({ ...prev, slots: mergedSlots }));
    } catch (e: any) {
      console.error('[useSquad] load error', e);
      setError(e?.message ?? 'Failed to load squad');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const updateSlot = useCallback(
    (slot_key: SquadSlotKey, player_id: string | null, useTransfer: boolean) => {
      setState(prev => {
        const slots = prev.slots.map(s => (s.slot_key === slot_key ? { ...s, player_id } : s));
        const transfersLeft = useTransfer ? Math.max(prev.transfersLeft - 1, 0) : prev.transfersLeft;
        return { ...prev, slots, transfersLeft };
      });
    },
    []
  );

  const saveSquad = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase not configured');
      return;
    }
    if (!squadId) {
      Alert.alert('No squad', 'Load squad before saving');
      return;
    }
    setSaving(true);
    try {
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) {
        setError('Not signed in');
        return;
      }
      const { transfersLeft, slots } = state;
      await supabase.from('user_squads').update({ transfers_left: transfersLeft }).eq('id', squadId);
      const rows = slots.map(s => ({ slot_key: s.slot_key, player_id: s.player_id }));
      for (const r of rows) {
        await supabase
          .from('user_squad_slots')
          .upsert({ squad_id: squadId, slot_key: r.slot_key, player_id: r.player_id }, { onConflict: 'squad_id,slot_key' });
      }
    } catch (e: any) {
      console.error('[useSquad] save error', e);
      setError(e?.message ?? 'Failed to save squad');
    } finally {
      setSaving(false);
    }
  }, [squadId, state, supabase]);

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

  return {
    state,
    setState,
    squadId,
    loading,
    saving,
    error,
    loadSquad,
    saveSquad,
    updateSlot,
    totalCost,
    remainingBudget,
    players,
  };
}
