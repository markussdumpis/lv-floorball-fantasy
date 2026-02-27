import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../providers/AuthProvider';
import { getSupabaseClient } from '../lib/supabaseClient';
import { ONBOARDING_ALWAYS_SHOW } from '../constants/onboarding';

const autoShownForSession = new Set<string>();
const ONBOARDING_CACHE_KEY = 'onboarding_main_completed';

type UseOnboardingOptions = {
  autoShow?: boolean;
};

export function useOnboarding(options: UseOnboardingOptions = {}) {
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

  const loadOnboardingStatus = useCallback(async () => {
    if (!user?.id) {
      setCompleted(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const cached = await AsyncStorage.getItem(ONBOARDING_CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as { userId?: string; completed?: boolean } | null;
          if (parsed?.userId === user.id && parsed.completed === true && mountedRef.current) {
            setCompleted(true);
            setChecking(false);
          }
        } catch {
          // ignore bad cache
        }
      }

      const supabase = getSupabaseClient();
      await supabase.from('profiles').upsert({ id: user.id }, { onConflict: 'id' });
      const { data, error } = await supabase
        .from('profiles')
        .select('onboarding_main_completed,onboarding_completed')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!mountedRef.current) return;
      const isCompleted = Boolean(data?.onboarding_main_completed ?? data?.onboarding_completed);
      setCompleted(isCompleted);
      await AsyncStorage.setItem(
        ONBOARDING_CACHE_KEY,
        JSON.stringify({ userId: user.id, completed: isCompleted }),
      );
    } catch {
      if (!mountedRef.current) return;
      // If schema isn't migrated yet, skip auto prompt.
      setCompleted(true);
    } finally {
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    void loadOnboardingStatus();
  }, [loadOnboardingStatus]);

  useEffect(() => {
    if (!autoShow || authLoading || checking || !user?.id) return;
    const forceShow = __DEV__ && ONBOARDING_ALWAYS_SHOW;
    if (!forceShow && completed) return;
    if (autoShownForSession.has(user.id)) return;
    autoShownForSession.add(user.id);
    setVisible(true);
  }, [authLoading, autoShow, checking, completed, user?.id]);

  const completeOnboarding = useCallback(async () => {
    if (!user?.id) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('profiles')
      .update({
        onboarding_main_completed: true,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq('id', user.id);
    if (error) throw error;
    await AsyncStorage.setItem(
      ONBOARDING_CACHE_KEY,
      JSON.stringify({ userId: user.id, completed: true }),
    );
    if (mountedRef.current) {
      setCompleted(true);
    }
  }, [user?.id]);

  const openManual = useCallback(() => {
    setVisible(true);
  }, []);

  const closeOnboarding = useCallback(() => {
    setVisible(false);
  }, []);

  const finishOnboarding = useCallback(
    async (_payload: { action: 'skip' | 'done' }) => {
      // Close instantly to avoid indefinite loading spinners on slow networks.
      if (mountedRef.current) {
        setVisible(false);
      }
      setSubmitting(true);
      try {
        await Promise.race([
          completeOnboarding(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('ONBOARDING_SAVE_TIMEOUT')), 8_000)),
        ]);
      } catch (err: any) {
        if (__DEV__) {
          console.log('[onboarding] complete failed', err?.message ?? String(err ?? ''));
        }
      } finally {
        if (mountedRef.current) {
          setSubmitting(false);
        }
      }
    },
    [completeOnboarding],
  );

  return {
    visible,
    checking,
    submitting,
    completed,
    openManual,
    closeOnboarding,
    finishOnboarding,
    reloadOnboardingStatus: loadOnboardingStatus,
  };
}
