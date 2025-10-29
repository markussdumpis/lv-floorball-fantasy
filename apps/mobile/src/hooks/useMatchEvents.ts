import { useCallback, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

type MatchEvent = {
  id: string;
  match_id: string;
  player_id: string;
  event_type: string;
  minute: number | null;
  created_at: string;
};

type SubscriptionStatus = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * Placeholder hook for realtime match events.
 *
 * Phase 4 TODOs:
 * - Implement Supabase Realtime subscription with exponential backoff + jitter retry strategy.
 * - Debounce UI updates (500ms) when events burst in.
 * - Provide pagination (20-event chunks) when loading historical events.
 * - Emit telemetry for connection lifecycle, errors, and retry attempts.
 */
export function useMatchEvents() {
  const [status, setStatus] = useState<SubscriptionStatus>('idle');
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const subscribe = useCallback((matchId: string) => {
    // Phase 4: Establish realtime channel `match_events:match_id=eq.{matchId}` and hydrate initial events.
    setStatus(matchId ? 'connecting' : 'idle');
    setEvents([]);
    channelRef.current = null;
  }, []);

  const retry = useCallback(() => {
    // Phase 4: Trigger exponential backoff retry and surface status updates to UI.
    setStatus('connecting');
  }, []);

  return {
    subscribe,
    status,
    events,
    retry,
    // Phase 4: add helpers for manual unsubscribe, telemetry hooks, pagination cursor, etc.
  };
}
