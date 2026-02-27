import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../providers/AuthProvider';
import { getSupabaseClient } from '../lib/supabaseClient';

const SQUAD_ONBOARDING_CACHE_KEY = 'onboarding_squad_completed';
const autoShownForSession = new Set<string>();

type FinishAction = 'skip' | 'done';

type UseSquadCoachMarksOptions = {
  autoShow?: boolean;
};

export function useSquadCoachMarks(options: UseSquadCoachMarksOptions = {}) {
  const { autoShow = true } = options;
  const { user, loading: authLoading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readLocalDone = useCallback(async () => {
    if (!user?.id) return false;
    const raw = await AsyncStorage.getItem(SQUAD_ONBOARDING_CACHE_KEY);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { userId?: string; completed?: boolean } | null;
      return parsed?.userId === user.id && parsed.completed === true;
    } catch {
      return false;
    }
  }, [user?.id]);

  const writeLocalDone = useCallback(async () => {
    if (!user?.id) return;
    await AsyncStorage.setItem(
      SQUAD_ONBOARDING_CACHE_KEY,
      JSON.stringify({ userId: user.id, completed: true }),
    );
  }, [user?.id]);

  const loadStatus = useCallback(async () => {
    if (!user?.id) {
      setCompleted(false);
      setChecking(false);
      return;
    }

    setChecking(true);
    let localDone = false;
    try {
      localDone = await readLocalDone();
      if (localDone && mountedRef.current) {
        setCompleted(true);
      }

      const supabase = getSupabaseClient();
      await supabase.from('profiles').upsert({ id: user.id }, { onConflict: 'id' });
      const { data, error } = await supabase
        .from('profiles')
        .select('onboarding_squad_completed,onboarding_squad_done')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;

      const remoteDone = Boolean(data?.onboarding_squad_completed ?? data?.onboarding_squad_done);
      if (!mountedRef.current) return;
      setCompleted(localDone || remoteDone);

      if (remoteDone && !localDone) {
        await writeLocalDone();
      }
    } catch {
      if (!mountedRef.current) return;
      setCompleted(localDone);
    } finally {
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  }, [readLocalDone, user?.id, writeLocalDone]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!autoShow || authLoading || checking || !user?.id || completed) return;
    if (autoShownForSession.has(user.id)) return;
    autoShownForSession.add(user.id);
    setVisible(true);
  }, [authLoading, autoShow, checking, completed, user?.id]);

  const markComplete = useCallback(async () => {
    if (!user?.id) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_squad_completed: true, onboarding_squad_done: true })
      .eq('id', user.id);
    if (error) throw error;
  }, [user?.id]);

  const openManual = useCallback(() => {
    setVisible(true);
  }, []);

  const finish = useCallback(
    async (_payload: { action: FinishAction }) => {
      if (mountedRef.current) {
        setVisible(false);
      }
      if (completed) return;

      setSubmitting(true);
      try {
        await Promise.race([
          markComplete(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SQUAD_ONBOARDING_SAVE_TIMEOUT')), 8_000)),
        ]);
      } catch {
        // fall back to local cache to avoid repeated prompts while offline/errors.
      } finally {
        await writeLocalDone().catch(() => {});
        if (mountedRef.current) {
          setCompleted(true);
          setSubmitting(false);
        }
      }
    },
    [completed, markComplete, writeLocalDone],
  );

  return {
    visible,
    checking,
    submitting,
    completed,
    openManual,
    finish,
    reloadStatus: loadStatus,
  };
}
