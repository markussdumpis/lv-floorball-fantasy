import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { diagLog } from '../lib/diagnostics';
import { forceLocalSignOut } from '../lib/supabaseRest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLanguage, getCurrentAppLanguage, syncLanguageFromProfile } from '../i18n';

WebBrowser.maybeCompleteAuthSession();
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configError: string | null;
  signInWithEmail: (email: string, password: string) => Promise<Session | null>;
  signUpWithEmail: (
    email: string,
    password: string,
    nickname?: string,
    language?: AppLanguage,
  ) => Promise<Session | null>;
  signInWithGoogle: () => Promise<Session | null>;
  setNickname: (nickname: string) => Promise<string>;
  setNicknameForUser: (userId: string, nickname: string) => Promise<string>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}

type Props = { children: ReactNode };

function isInvalidSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  return (
    normalized.includes('jwt') ||
    normalized.includes('unauthorized') ||
    normalized.includes('invalid') ||
    normalized.includes('user from sub claim in jwt does not exist') ||
    normalized.includes('user not found')
  );
}

export function AuthProvider({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const lastProfileEnsuredFor = useRef<string | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const generateNickname = () => `User_${Math.floor(Math.random() * 900000 + 100000)}`;
  const normalizePreferredNickname = (value: unknown): string | null => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    if (raw.length < 3 || raw.length > 20) return null;
    if (!/^[A-Za-z0-9_]+$/.test(raw)) return null;
    return raw;
  };

  useEffect(() => {
    const registerForPushNotifications = async () => {
      if (!Constants.isDevice) {
        console.log('[push] push token unavailable on simulator');
        return;
      }

      const permissions = await Notifications.getPermissionsAsync();
      let finalStatus = permissions.status;
      if (finalStatus !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        finalStatus = requested.status;
      }

      if (finalStatus !== 'granted') {
        console.log('[push] permission not granted');
        return;
      }

      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (projectId) {
          await Notifications.getExpoPushTokenAsync({ projectId });
        } else {
          await Notifications.getExpoPushTokenAsync();
        }
      } catch (error) {
        console.log('[push] push token unavailable on simulator');
      }
    };

    void registerForPushNotifications();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setConfigError(
        'Supabase environment variables are missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
      );
      setLoading(false);
      return;
    }

    try {
      setSupabase(getSupabaseClient());
    } catch (error: any) {
      setConfigError(error?.message ?? 'Failed to initialise Supabase client.');
      setLoading(false);
    }
  }, []);

  const ensureProfile = async (userId: string, client?: SupabaseClient) => {
    const supabaseClient = client ?? supabase;
    if (!supabaseClient) return;
    if (lastProfileEnsuredFor.current === userId) return;
    const { error } = await supabaseClient
      .from('profiles')
      .upsert({ id: userId }, { onConflict: 'id' });
    if (error) {
      console.warn('Failed to upsert profile', error);
      return;
    }
    lastProfileEnsuredFor.current = userId;
  };

  const persistNicknameForUser = async (userId: string, nickname: string, client?: SupabaseClient) => {
    const supabaseClient = client ?? supabase;
    if (!supabaseClient || !userId) return;
    const safe = nickname.trim();
    if (!safe) return;
    const { error: rpcErr } = await supabaseClient.rpc('update_nickname', { new_nickname: safe });
    if (!rpcErr) return;
    const fallbackAllowed =
      rpcErr.code === '42883' ||
      String(rpcErr.message ?? '').toLowerCase().includes('update_nickname');
    if (!fallbackAllowed) throw rpcErr;
    const { error: upsertErr } = await supabaseClient
      .from('profiles')
      .upsert({ id: userId, nickname: safe }, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;
  };

  const ensureNicknamePresent = async (
    userId: string,
    client?: SupabaseClient,
    preferredNickname?: string | null,
  ) => {
    const supabaseClient = client ?? supabase;
    if (!supabaseClient || !userId) return;
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('nickname')
        .eq('id', userId)
        .single();
      if (error) {
        console.warn('Failed to read nickname', error);
      }
      const current = data?.nickname;
      if (current && String(current).trim()) return;
    } catch (readErr) {
      console.warn('Nickname read failed', readErr);
    }

    const preferred = normalizePreferredNickname(preferredNickname);
    const fallback = preferred ?? generateNickname();
    try {
      await persistNicknameForUser(userId, fallback, supabaseClient);
      diagLog('nickname_backfill', { userId });
    } catch (upErr) {
      console.warn('Failed to set fallback nickname', upErr);
    }
  };

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setConfigError(error.message);
          diagLog('auth_session_fail', { message: error.message });
        }
        let initialSession = data.session ?? null;
        if (initialSession?.access_token) {
          try {
            const { data: currentUser, error: currentUserError } = await supabase.auth.getUser(initialSession.access_token);
            if (currentUserError || !currentUser?.user) {
              if (isInvalidSessionError(currentUserError)) {
                await forceLocalSignOut();
                initialSession = null;
              }
            }
          } catch (sessionErr) {
            if (isInvalidSessionError(sessionErr)) {
              await forceLocalSignOut();
              initialSession = null;
            }
          }
        }
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        if (initialSession?.user) {
          await ensureProfile(initialSession.user.id, supabase);
          await syncLanguageFromProfile(initialSession.user.id);
          const preferredFromMeta = normalizePreferredNickname(initialSession.user.user_metadata?.nickname);
          await ensureNicknamePresent(initialSession.user.id, supabase, preferredFromMeta);
          const createdAt = initialSession.user.created_at ?? null;
          if (createdAt) {
            await AsyncStorage.setItem('userCreatedAt', createdAt);
          }
        }
        diagLog('auth_session_loaded', {
          hasSession: !!initialSession,
          userId: initialSession?.user?.id ?? null,
        });
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        await ensureProfile(newSession.user.id, supabase);
        await syncLanguageFromProfile(newSession.user.id);
        const preferredFromMeta = normalizePreferredNickname(newSession.user.user_metadata?.nickname);
        await ensureNicknamePresent(newSession.user.id, supabase, preferredFromMeta);
        const createdAt = newSession.user.created_at ?? null;
        if (createdAt) {
          await AsyncStorage.setItem('userCreatedAt', createdAt);
        }
      } else {
        lastProfileEnsuredFor.current = null;
      }
      if (!loading) return;
      setLoading(false);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithEmail = async (email: string, password: string) => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session ?? null;
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    nickname?: string,
    language?: AppLanguage,
  ) => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const preferred = normalizePreferredNickname(nickname);
    const selectedLanguage = language ?? getCurrentAppLanguage();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          ...(preferred ? { nickname: preferred } : {}),
          language: selectedLanguage,
        },
      },
    });
    if (error) throw error;
    const userId = data.session?.user?.id ?? data.user?.id ?? null;
    if (userId) {
      await ensureProfile(userId, supabase);
      const { error: languageErr } = await supabase
        .from('profiles')
        .upsert({ id: userId, language: selectedLanguage }, { onConflict: 'id' });
      if (languageErr) {
        console.warn('Failed to persist signup language', languageErr);
      }
      if (preferred) {
        try {
          await persistNicknameForUser(userId, preferred, supabase);
        } catch (e) {
          console.warn('Failed to persist signup nickname immediately', e);
        }
      }
    }
    return data.session ?? null;
  };

  const setNickname = async (nickname: string) => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const uid = data.session?.user?.id ?? session?.user?.id ?? null;
    if (!uid) throw new Error('No signed-in user to set nickname.');
    const safe = nickname.trim();
    if (!safe) throw new Error('Nickname cannot be empty.');
    await ensureProfile(uid, supabase);
    const persistNickname = async () => {
      const { error: rpcErr } = await supabase.rpc('update_nickname', { new_nickname: safe });
      if (!rpcErr) return;

      // Backward compatibility: environments without RPC/cooldown migration yet.
      const fallbackAllowed =
        rpcErr.code === '42883' ||
        String(rpcErr.message ?? '').toLowerCase().includes('update_nickname');
      if (!fallbackAllowed) {
        throw rpcErr;
      }

      const { error: upsertErr } = await supabase
        .from('profiles')
        .upsert({ id: uid, nickname: safe }, { onConflict: 'id' });
      if (upsertErr) throw upsertErr;
    };
    await persistNickname();
    const { data: upData, error: upErr } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', uid)
      .single();
    if (upErr) throw upErr;
    diagLog('nickname_set', { userId: uid });
    return upData?.nickname ?? safe;
  };

  const setNicknameForUser = async (userId: string, nickname: string) => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const safe = nickname.trim();
    if (!safe) throw new Error('Nickname cannot be empty.');
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;
    const currentUid = sessionData.session?.user?.id ?? session?.user?.id ?? null;
    if (currentUid && currentUid !== userId) {
      throw new Error('Nickname update user mismatch.');
    }
    // ensure profile row exists before updating nickname
    await ensureProfile(userId, supabase);
    const { error: rpcErr } = await supabase.rpc('update_nickname', { new_nickname: safe });
    if (rpcErr) {
      const fallbackAllowed =
        rpcErr.code === '42883' ||
        String(rpcErr.message ?? '').toLowerCase().includes('update_nickname');
      if (!fallbackAllowed) throw rpcErr;

      const { error: upsertErr } = await supabase
        .from('profiles')
        .upsert({ id: userId, nickname: safe }, { onConflict: 'id' });
      if (upsertErr) throw upsertErr;
    }
    const { data, error: upErr } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', userId)
      .single();
    if (upErr) throw upErr;
    diagLog('nickname_set', { userId });
    return data?.nickname ?? safe;
  };

  const signInWithGoogle = async () => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const redirectTo = Linking.createURL('auth/callback');
    if (__DEV__) console.log('[oauth] starting google');
    if (__DEV__) console.log('[oauth] redirectTo', redirectTo);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('No OAuth URL returned from Supabase.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    const resultUrl = 'url' in result ? result.url : null;
    const redactedResultUrl = resultUrl ? redactTokens(resultUrl) : null;
    if (__DEV__) console.log('[oauth] webbrowser result', { type: result.type, url: redactedResultUrl });
    if (result.type !== 'success' || !resultUrl) {
      throw new Error('Google sign-in was cancelled.');
    }

    const redactedUrl = redactTokens(resultUrl);
    const urlObj = new URL(resultUrl);
    const authCode = urlObj.searchParams.get('code');
    const hasCode = !!authCode;
    const hasError = !!(urlObj.searchParams.get('error') || urlObj.searchParams.get('error_description'));
    diagLog('oauth_callback_received', { url: redactedUrl, hasCode, hasError });
    if (__DEV__) console.log('[oauth] callback parsed', { url: redactedUrl, hasCode, hasError });

    if (!hasCode) {
      // Fallback: some providers may return tokens in the fragment instead of a code.
      const fragmentParams = new URLSearchParams(urlObj.hash.replace(/^#/, ''));
      const accessToken = fragmentParams.get('access_token');
      const refreshToken = fragmentParams.get('refresh_token') || fragmentParams.get('provider_refresh_token');
      if (accessToken && refreshToken) {
        diagLog('oauth_fragment_tokens', { hasAccess: true, hasRefresh: true });
        if (__DEV__) console.log('[oauth] fragment tokens present (redacted)');
        const { data: sessionData, error: setErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setErr) throw setErr;
        if (sessionData?.session?.user) {
          await ensureProfile(sessionData.session.user.id, supabase);
        }
        return sessionData.session ?? null;
      }
      diagLog('oauth_pkce_missing_code', { url: redactedUrl });
      throw new Error("Google sign-in didn't complete. Try again.");
    }

    diagLog('oauth_pkce_exchange', { hasCode, hasError });
    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
      authCode!,
    );
    if (exchangeError) {
      const raw = String(exchangeError.message ?? '').toLowerCase();
      if (raw.includes('invalid flow state') || raw.includes('no valid flow state')) {
        throw new Error('Google sign-in expired. Please try again.');
      }
      throw exchangeError;
    }

    if (exchangeData.session?.user) {
      await ensureProfile(exchangeData.session.user.id, supabase);
    }
    return exchangeData.session ?? null;
  };

  const signOut = async () => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    await forceLocalSignOut();
    const timeout = new Promise(resolve => setTimeout(resolve, 3_000, 'timeout'));
    try {
      await Promise.race([supabase.auth.signOut(), timeout]);
    } catch {
      // ignore signOut errors/timeouts; proceed to clear local state
    }
    setSession(null);
    setUser(null);
    lastProfileEnsuredFor.current = null;
  };

  const redactTokens = (input: string) => {
    let out = input;
    const patterns = ['access_token', 'refresh_token', 'id_token'];
    patterns.forEach(key => {
      const regex = new RegExp(`${key}=([^&]+)`, 'gi');
      out = out.replace(regex, `${key}=[REDACTED]`);
    });
    return out;
  };

  const value: AuthContextValue = {
    session,
    user,
    loading,
    configError,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    setNickname,
    setNicknameForUser,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
