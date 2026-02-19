import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchJson, getStoredSession, isOfflineError } from '../lib/supabaseRest';
import { diagLog, recordCoreWrite } from '../lib/diagnostics';
import { SEASON_BUDGET_CREDITS } from '../constants/fantasyRules';
import { usePlayers } from './usePlayers';
import { useRef, useEffect } from 'react';

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
  captainNextChangeAt?: string | null;
  teamPoints: number;
  createdAt?: string | null;
  lastTransferGrantAt?: string | null;
};

const SLOT_KEYS: SquadSlotKey[] = ['U1', 'U2', 'U3', 'U4', 'A1', 'A2', 'V1', 'F1'];
const DEFAULT_TRANSFERS = 3; // enforce fixed transfers allowance per user/gameweek
const TRANSFER_CAP = 10;
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
  createdAt?: string | null;
  lastTransferGrantAt?: string | null;
  captainNextChangeAt?: string | null;
};

export function useSquad() {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [state, setState] = useState<SquadState>({
    slots: SLOT_KEYS.map(slot_key => ({ slot_key, player_id: null })),
    captainId: null,
    budgetTotal: SEASON_BUDGET_CREDITS,
    transfersLeft: DEFAULT_TRANSFERS,
    season: DEFAULT_SEASON,
    playerDetails: {},
    teamPoints: 0,
    createdAt: null,
    lastTransferGrantAt: null,
    captainNextChangeAt: null,
  });
  const [savedSnapshot, setSavedSnapshot] = useState<SquadSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offlineNotifiedAt = useRef<number>(0);

  const { data: players, loading: playersLoading, error: playersError } = usePlayers({ sort: 'price_desc', pageSize: 400 });
  const playerMap = useMemo(() => {
    const m = new Map<string, (typeof players)[number]>();
    players.forEach(p => m.set(p.id, p));
    return m;
  }, [players]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reconcileTransfers = useCallback(
    (transfersLeft: number, createdAt: string | null | undefined, lastGrant: string | null | undefined) => {
      const createdMs = createdAt ? Date.parse(createdAt) : Date.now();
      const lastGrantMs = lastGrant ? Date.parse(lastGrant) : createdMs;
      const now = Date.now();
      const periods = Math.floor((now - lastGrantMs) / (30 * 24 * 60 * 60 * 1000));
      let next = transfersLeft;
      let nextLastGrant = lastGrantMs;
      if (periods > 0) {
        next = Math.min(TRANSFER_CAP, transfersLeft + periods);
        nextLastGrant = lastGrantMs + periods * 30 * 24 * 60 * 60 * 1000;
      }
      if (__DEV__) {
        console.log('[squad] reconcile transfers', { before: transfersLeft, after: next, periods, createdAt, lastGrant });
      }
      return { transfersLeft: next, lastGrantAt: new Date(nextLastGrant).toISOString() };
    },
    []
  );

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

  const fetchLatestTeamId = useCallback(async (userId: string): Promise<string | null> => {
    const { data } = await fetchJson<{ id: string }[]>('/rest/v1/fantasy_teams', {
      requireAuth: true,
      query: {
        select: 'id',
        user_id: `eq.${userId}`,
        order: 'created_at.desc',
        limit: 1,
      },
    });
    const latestId = Array.isArray(data) && data[0]?.id ? data[0].id : null;
    console.log('[squad] latest team lookup', { userId, teamId: latestId });
    return latestId;
  }, []);

  const getOrCreateFantasyTeam = useCallback(async (): Promise<string | null> => {
    const { token, userId } = await getStoredSession();
    if (!token || !userId) return null;

    try {
      const existing = await fetchLatestTeamId(userId);
      if (existing) return existing;

      const { data, headers } = await fetchJson<any>(
        '/rest/v1/fantasy_teams?select=id,user_id,name,created_at',
        {
        requireAuth: true,
        method: 'POST',
        body: {
          user_id: userId,
        },
        timeoutMs: 12_000,
        }
      );
      console.log('[squad] create team response', { body: data });

      // Body may be array, object, or empty
      const fromBody = Array.isArray(data)
        ? data[0]?.id
        : data && typeof data === 'object'
        ? (data as any).id
        : null;
      if (fromBody) return fromBody;

      const parseUuid = (value: string | null) => {
        if (!value) return null;
        const m = value.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/);
        return m ? m[0] : null;
      };

      const locHeader = headers.get('content-location') ?? headers.get('location') ?? null;
      const fromHeader = parseUuid(locHeader);
      if (fromHeader) return fromHeader;

      console.warn('[squad] create team returned no body; falling back to latest team lookup');
      return await fetchLatestTeamId(userId);
    } catch (err) {
      console.warn('[squad] create team failed', err);
      return null;
    }
  }, [fetchLatestTeamId]);

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
        transfersLeft: parsed.transfersLeft ?? DEFAULT_TRANSFERS,
        season: parsed.season ?? DEFAULT_SEASON,
        playerDetails: parsed.playerDetails ?? {},
        createdAt: parsed.createdAt ?? null,
        lastTransferGrantAt: parsed.lastTransferGrantAt ?? null,
        captainNextChangeAt: parsed.captainNextChangeAt ?? null,
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
      console.log('[squad] start load');
      const cached = await loadFromCache();
      if (cached) {
        setState(cached);
        setSavedSnapshot(cached);
      }

      const { token, userId } = await getStoredSession();
      if (!token || !userId) {
        setError('Please sign in');
        return;
      }
      console.log('[squad] storage auth ok', { hasToken: !!token, userId });

      const { data: teamRows } = await fetchJson<{ id: string; transfers_left?: number; created_at?: string; last_transfer_grant_at?: string }[]>(
        '/rest/v1/fantasy_teams',
        {
        requireAuth: true,
        query: {
          select: 'id,transfers_left,created_at,last_transfer_grant_at',
          user_id: `eq.${userId}`,
          order: 'created_at.desc',
          limit: 1,
        },
        timeoutMs: 12_000,
        }
      );
      const teamRow = Array.isArray(teamRows) ? teamRows[0] : null;
      if (!teamRow?.id) {
        const empty: SquadSnapshot = {
          slots: SLOT_KEYS.map(slot_key => ({ slot_key, player_id: null })),
          captainId: null,
          budgetTotal: SEASON_BUDGET_CREDITS,
          transfersLeft: DEFAULT_TRANSFERS,
          season: DEFAULT_SEASON,
          playerDetails: {},
          createdAt: new Date().toISOString(),
          lastTransferGrantAt: new Date().toISOString(),
          captainNextChangeAt: null,
        };
        setState(empty);
        setSavedSnapshot(empty);
        persistCache(empty);
        return;
      }

      setTeamId(teamRow.id);
      const baseTransfers = teamRow.transfers_left ?? DEFAULT_TRANSFERS;
      const { transfersLeft: reconciledTransfers, lastGrantAt } = reconcileTransfers(
        baseTransfers,
        teamRow.created_at ?? null,
        teamRow.last_transfer_grant_at ?? null
      );
      if (__DEV__) {
        console.log('[squad] transfers before/after reconcile', { baseTransfers, reconciledTransfers });
      }
      if (reconciledTransfers !== baseTransfers || teamRow.last_transfer_grant_at !== lastGrantAt) {
        try {
          await fetchJson('/rest/v1/fantasy_teams?id=eq.' + teamRow.id, {
            requireAuth: true,
            method: 'PATCH',
            body: { transfers_left: reconciledTransfers, last_transfer_grant_at: lastGrantAt },
            timeoutMs: 10_000,
          });
        } catch (err) {
          console.warn('[squad] failed to persist reconciled transfers', err);
        }
      }

      const { data: playerRows } = await fetchJson<any[]>(
        '/rest/v1/fantasy_team_players',
        {
          requireAuth: true,
          query: {
            select:
              'player_id,is_captain,joined_at,left_at,players(id,name,position,team,price,price_final,points_total,points)',
            fantasy_team_id: `eq.${teamRow.id}`,
            left_at: 'is.null',
          },
          timeoutMs: 12_000,
        }
      );

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
      // captain cooldown
      let captainNextChangeAt: string | null = null;
      try {
        const { data: periods } = await fetchJson<{ starts_at: string; ends_at: string | null }[]>(
          '/rest/v1/fantasy_team_captain_periods',
          {
            requireAuth: true,
            query: {
              select: 'starts_at,ends_at',
              fantasy_team_id: `eq.${teamRow.id}`,
              ends_at: 'is.null',
              order: 'starts_at.desc',
              limit: 1,
            },
            timeoutMs: 10_000,
          }
        );
        const active = Array.isArray(periods) ? periods[0] : null;
        if (active?.starts_at) {
          const next = new Date(active.starts_at);
          next.setDate(next.getDate() + 30);
          captainNextChangeAt = next.toISOString();
        }
      } catch (err) {
        console.warn('[squad] captain cooldown fetch failed', err);
      }
      const snapshot: SquadSnapshot = {
        slots: mergedSlots,
        captainId: captainRow?.id ?? null,
        budgetTotal: SEASON_BUDGET_CREDITS,
        transfersLeft: options?.overrideTransfersLeft ?? reconciledTransfers,
        season: DEFAULT_SEASON,
        playerDetails: detailMap,
        teamPoints: cached?.teamPoints ?? 0,
        createdAt: teamRow.created_at ?? null,
        lastTransferGrantAt: lastGrantAt ?? teamRow.last_transfer_grant_at ?? null,
        captainNextChangeAt,
      };
      if (__DEV__) {
        console.log('[squad] transfersLeft raw snapshot', {
          source: 'loadSquad',
          value: snapshot.transfersLeft,
          override: options?.overrideTransfersLeft,
        });
      }
      try {
        const { data: pointsRows } = await fetchJson<{ total_points: number }[]>(
          '/rest/v1/user_team_points_view',
          {
            requireAuth: true,
            query: {
              select: 'total_points',
              fantasy_team_id: `eq.${teamRow.id}`,
              limit: 1,
            },
            timeoutMs: 12_000,
          }
        );
        const pointsRow = Array.isArray(pointsRows) ? pointsRows[0] : null;
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
      if (isOfflineError(e)) {
        const now = Date.now();
        if (now - offlineNotifiedAt.current > 10_000) {
          diagLog('offline_detected', { source: 'loadSquad' });
          offlineNotifiedAt.current = now;
        }
        setError("You're offline. Reconnect and try again.");
      } else {
        setError(e?.message ?? 'Failed to load squad');
      }
    } finally {
      setLoading(false);
    }
  }, [loadFromCache, persistCache, state.transfersLeft]);

  const updateSlot = useCallback((slot_key: SquadSlotKey, player_id: string | null) => {
    setState(prev => {
      const slots = prev.slots.map(s => {
        if (s.slot_key === slot_key) {
          return { ...s, player_id };
        }
        // ensure a player cannot be selected in multiple slots
        if (player_id && s.player_id === player_id) {
          return { ...s, player_id: null };
        }
        return s;
      });
      return { ...prev, slots };
    });
  }, []);

  const setCaptain = useCallback((playerId: string | null) => {
    setState(prev => ({ ...prev, captainId: playerId }));
  }, []);

  const chooseCaptain = useCallback(
    async (playerId: string) => {
      const { token, userId } = await getStoredSession();
      if (!token || !userId) return { ok: false, error: 'Not signed in' };

      const ensureTeamId = async (): Promise<string | null> => {
        if (teamId) return teamId;
        return fetchLatestTeamId(userId);
      };

      const team = await ensureTeamId();
      if (!team) {
        return { ok: false, error: 'No fantasy team loaded' };
      }
      setTeamId(team);
      diagLog('captain_save_start', { team, playerId });

      try {
        const { data: rosterRows } = await fetchJson<{ player_id: string; is_captain: boolean }[]>(
          '/rest/v1/fantasy_team_players',
          {
            requireAuth: true,
            query: {
              select: 'player_id,is_captain',
              fantasy_team_id: `eq.${team}`,
              left_at: 'is.null',
            },
            timeoutMs: 12_000,
          }
        );
        let roster = rosterRows ?? [];

        const selectedIds = stateRef.current.slots.map(s => s.player_id).filter(Boolean) as string[];
        if (!selectedIds.length) {
          return { ok: false, error: 'Add players to your squad before choosing a captain.' };
        }

        // If roster is empty (e.g., user has not saved yet), seed it with current selection
        if (!roster.length) {
          const payload = selectedIds.map(id => ({
            fantasy_team_id: team,
            player_id: id,
            is_captain: false,
            joined_at: new Date().toISOString(),
            left_at: null,
          }));
          console.log(`[captain] seeding roster rows=${payload.length} team=${team}`);
          try {
            await fetchJson('/rest/v1/fantasy_team_players?select=fantasy_team_id,player_id,joined_at,left_at,is_captain', {
              requireAuth: true,
              method: 'POST',
              body: payload,
              timeoutMs: 12_000,
            });
            roster = payload.map(p => ({ player_id: p.player_id, is_captain: false }));
          } catch (seedErr: any) {
            console.error('[captain] seed roster failed', seedErr);
            return { ok: false, error: seedErr?.message ?? 'Failed to add squad players before setting captain.' };
          }
        }
        const currentCaptain = roster.find(r => r.is_captain)?.player_id ?? stateRef.current.captainId;
        if (currentCaptain === playerId) {
          setCaptain(playerId);
          return { ok: true };
        }
        const rosterHasPlayer = roster.some(r => r.player_id === playerId);
        const selectionHasPlayer = selectedIds.includes(playerId);
        if (!rosterHasPlayer && selectionHasPlayer) {
          // add the missing player row just-in-time
          try {
            await fetchJson('/rest/v1/fantasy_team_players?select=fantasy_team_id,player_id,joined_at,left_at,is_captain', {
              requireAuth: true,
              method: 'POST',
              body: [{
                fantasy_team_id: team,
                player_id: playerId,
                is_captain: false,
                joined_at: new Date().toISOString(),
                left_at: null,
              }],
              timeoutMs: 12_000,
            });
            roster.push({ player_id: playerId, is_captain: false });
          } catch (addErr: any) {
            console.error('[captain] add missing player failed', addErr);
            return { ok: false, error: addErr?.message ?? 'Failed to sync squad before setting captain.' };
          }
        } else if (!rosterHasPlayer && !selectionHasPlayer) {
          return { ok: false, error: 'Selected player is not in your current roster.' };
        }

          console.log(`[captain] selecting player_id=${playerId} team_id=${team}`);
          await fetchJson('/rest/v1/rpc/set_captain', {
            requireAuth: true,
            method: 'POST',
            body: { p_team_id: team, p_player_id: playerId },
            timeoutMs: 12_000,
          });
          console.log(`[captain] rpc status=ok team_id=${team}`);

          setCaptain(playerId); // optimistic
          await loadSquad();
          await recordCoreWrite('captain_save');
          diagLog('captain_save_success', { team, playerId });

          const rosterCount = stateRef.current.slots.filter(s => s.player_id).length;
          console.log(`[captain] roster count=${rosterCount}`);
          if (rosterCount === 0) {
            console.warn(
            '[captain] roster empty after captain change — likely left_at was updated; check fantasy_team_players rows.'
          );
          setError('Roster empty after captain change — likely left_at was updated; check fantasy_team_players rows.');
        }
        return { ok: true };
      } catch (e: any) {
        console.error('[useSquad] chooseCaptain error', e);
        const message = e?.message ?? 'Failed to set captain';
        const friendly =
          message.includes('once every 30 days') || message.includes('once every 30')
            ? 'You can change captain once every 30 days. Please try later.'
            : message;
        diagLog('captain_save_fail', { message: friendly });
        return { ok: false, error: friendly };
      }
    },
    [fetchLatestTeamId, loadSquad, setCaptain, teamId]
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
    if (__DEV__) {
      console.log('[squad] save transfers delta', { existingTransfers, transfersUsed, nextTransfersLeft });
    }

    setSaving(true);
    const snapshot: SquadSnapshot = {
      slots: state.slots,
      captainId: state.captainId,
      budgetTotal: state.budgetTotal,
      transfersLeft: nextTransfersLeft,
      season: state.season,
      playerDetails: state.playerDetails,
      teamPoints: state.teamPoints,
      createdAt: state.createdAt ?? new Date().toISOString(),
      lastTransferGrantAt: new Date().toISOString(),
    };
    try {
      const team = await getOrCreateFantasyTeam();
      if (!team) {
        return fail('Unable to load fantasy team for this account.');
      }
      setTeamId(team);
      diagLog('squad_save_start', { team });

      const newIds = state.slots.map(s => s.player_id).filter(Boolean) as string[];
      const desiredCaptainId: string | null =
        state.captainId && newIds.includes(state.captainId) ? state.captainId : null;

      // Fetch current active rows
      const { data: activeRows } = await fetchJson<{ player_id: string; is_captain: boolean }[]>(
        '/rest/v1/fantasy_team_players',
        {
          requireAuth: true,
          query: {
            select: 'player_id,is_captain',
            fantasy_team_id: `eq.${team}`,
            left_at: 'is.null',
          },
          timeoutMs: 12_000,
        }
      );
      const activeIds = (activeRows ?? []).map(r => r.player_id);
      const currentCaptainId = (activeRows ?? []).find(r => r.is_captain)?.player_id ?? null;
      const toClose = activeIds.filter(id => !newIds.includes(id));
      const toInsert = newIds.filter(id => !activeIds.includes(id));
      const didChange =
        transfersUsed > 0 ||
        toClose.length > 0 ||
        toInsert.length > 0 ||
        (desiredCaptainId && desiredCaptainId !== currentCaptainId);

      // If nothing changed, bail early without consuming transfer
      if (!didChange) {
        diagLog('squad_save_noop', { team });
        return { ok: true, needsCaptain: false };
      }

      // Consume transfer atomically (server will also grant accrued transfers)
      try {
        const { data: consumeRows } = await fetchJson<{ transfers_left?: number }[]>(
          '/rest/v1/rpc/consume_transfer',
          {
            requireAuth: true,
            method: 'POST',
            body: { p_team_id: team }, // function expects p_team_id
            timeoutMs: 10_000,
          }
        );
        const consumedLeft = Array.isArray(consumeRows) ? consumeRows[0]?.transfers_left : undefined;
        snapshot.transfersLeft = consumedLeft ?? nextTransfersLeft;
        if (__DEV__) console.log('[squad] consume_transfer ok', { consumedLeft });
      } catch (consumeErr: any) {
        const msg = consumeErr?.message ?? '';
        if (msg.includes('NO_TRANSFERS_LEFT')) {
          Alert.alert('No transfers left', 'You get +1 transfer every 30 days.');
          return fail('No transfers left');
        }
        console.error('[squad] consume_transfer failed', consumeErr);
        return fail('Could not consume a transfer. Try again.');
      }

      if (toClose.length) {
        await fetchJson('/rest/v1/fantasy_team_players', {
          requireAuth: true,
          method: 'PATCH',
          query: {
            fantasy_team_id: `eq.${team}`,
            player_id: `in.(${toClose.join(',')})`,
            left_at: 'is.null',
          },
          body: {
            left_at: new Date().toISOString(),
            is_captain: false,
            captain_to: new Date().toISOString(),
          },
          timeoutMs: 12_000,
        });
      }

      if (toInsert.length) {
        const rosterPayload = toInsert.map(id => ({
          fantasy_team_id: team,
          player_id: id,
          is_captain: false,
          joined_at: new Date().toISOString(),
          left_at: null,
        }));
        console.log(`[squad] roster insert`, { count: rosterPayload.length, fantasy_team_id: team });
        try {
          await fetchJson('/rest/v1/fantasy_team_players?select=fantasy_team_id,player_id,joined_at,left_at,is_captain', {
            requireAuth: true,
            method: 'POST',
            body: rosterPayload,
            timeoutMs: 12_000,
          });
          diagLog('squad_save_roster_insert_ok', { inserted: rosterPayload.length, team });
        } catch (e: any) {
          diagLog('squad_save_roster_insert_fail', { message: e?.message });
          return fail(e?.message ?? 'Failed to save roster players');
        }
      }

      // Ensure captain via RPC (handles cooldown)
      if (desiredCaptainId && desiredCaptainId !== currentCaptainId) {
        try {
          await fetchJson('/rest/v1/rpc/set_captain', {
            requireAuth: true,
            method: 'POST',
            body: { p_team_id: team, p_player_id: desiredCaptainId },
            timeoutMs: 12_000,
          });
        } catch (e: any) {
          const detail = e?.message ?? '';
          diagLog('squad_save_captain_fail', { message: detail });
          return fail(detail || 'Failed to set captain');
        }
        snapshot.captainId = desiredCaptainId;
        setCaptain(desiredCaptainId);
      }

      // Persist transfers atomically with team row
      try {
        const { data: updatedTeam } = await fetchJson<
          { transfers_left?: number | null; last_transfer_grant_at?: string | null }[]
        >('/rest/v1/fantasy_teams?id=eq.' + team, {
          requireAuth: true,
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: {
            transfers_left: nextTransfersLeft,
            last_transfer_grant_at: new Date().toISOString(),
          },
          timeoutMs: 10_000,
        });
        const patchedTransfers = Array.isArray(updatedTeam) ? updatedTeam[0]?.transfers_left : nextTransfersLeft;
        snapshot.transfersLeft = patchedTransfers ?? nextTransfersLeft;
        snapshot.lastTransferGrantAt = Array.isArray(updatedTeam)
          ? updatedTeam[0]?.last_transfer_grant_at ?? snapshot.lastTransferGrantAt
          : snapshot.lastTransferGrantAt;
      } catch (patchErr) {
        console.warn('[squad] failed to persist transfers_left', patchErr);
        return fail('Could not update transfers. Try again.');
      }

      setState(snapshot);
      setSavedSnapshot(snapshot);
      await persistCache(snapshot);
      await recordCoreWrite('squad_save');
      diagLog('squad_save_success', { team });
      return { ok: true, needsCaptain: !desiredCaptainId };
    } catch (e: any) {
      diagLog('squad_save_fail', { message: e?.message });
      setError(e?.message ?? 'Failed to save squad');
      return { ok: false, error: e?.message ?? 'Failed to save squad' };
    } finally {
      setSaving(false);
    }
  }, [getOrCreateFantasyTeam, loadSquad, persistCache, savedSnapshot, state]);

  const totalCost = useMemo(() => {
    const priceFor = (playerId: string | null) => {
      if (!playerId) return 0;
      const detail = state.playerDetails[playerId];
      const player = detail ?? playerMap.get(playerId);
      const price =
        typeof player?.price_final === 'number' && !Number.isNaN(player.price_final)
          ? player.price_final
          : typeof player?.price === 'number' && !Number.isNaN(player.price)
          ? player.price
          : 0;
      return price;
    };

    return state.slots.reduce((sum, slot) => sum + priceFor(slot.player_id), 0);
  }, [playerMap, state.playerDetails, state.slots]);

  const remainingBudget = SEASON_BUDGET_CREDITS - totalCost;
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
    playersLoading,
    playersError,
    pendingTransfersUsed,
    selectedPlayers,
  };
}
