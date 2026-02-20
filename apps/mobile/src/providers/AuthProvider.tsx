import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { diagLog } from '../lib/diagnostics';
import { forceLocalSignOut } from '../lib/supabaseRest';
import AsyncStorage from '@react-native-async-storage/async-storage';

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configError: string | null;
  signInWithEmail: (email: string, password: string) => Promise<Session | null>;
  signUpWithEmail: (email: string, password: string) => Promise<Session | null>;
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

export function AuthProvider({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const lastProfileEnsuredFor = useRef<string | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const generateNickname = () => `User_${Math.floor(Math.random() * 900000 + 100000)}`;

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

  const ensureNicknamePresent = async (userId: string, client?: SupabaseClient) => {
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

    const fallback = generateNickname();
    const { error: upErr } = await supabaseClient
      .from('profiles')
      .upsert({ id: userId, nickname: fallback }, { onConflict: 'id' });
    if (upErr) {
      console.warn('Failed to set fallback nickname', upErr);
    } else {
      diagLog('nickname_backfill', { userId });
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
        const initialSession = data.session ?? null;
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        if (initialSession?.user) {
          await ensureProfile(initialSession.user.id, supabase);
          await ensureNicknamePresent(initialSession.user.id, supabase);
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
        await ensureNicknamePresent(newSession.user.id, supabase);
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

  const signUpWithEmail = async (email: string, password: string) => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (data.session?.user) {
      await ensureProfile(data.session.user.id, supabase);
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
    const { data: upData, error: upErr } = await supabase
      .from('profiles')
      .upsert({ id: uid, nickname: safe }, { onConflict: 'id' })
      .select('nickname')
      .single();
    if (upErr) throw upErr;
    diagLog('nickname_set', { userId: uid });
    return upData?.nickname ?? safe;
  };

  const setNicknameForUser = async (userId: string, nickname: string) => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const safe = nickname.trim();
    if (!safe) throw new Error('Nickname cannot be empty.');
    // ensure profile row exists before updating nickname
    await ensureProfile(userId, supabase);
    const { data, error: upErr } = await supabase
      .from('profiles')
      .upsert({ id: userId, nickname: safe }, { onConflict: 'id' })
      .select('nickname')
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
    const hasCode = !!urlObj.searchParams.get('code');
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
    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(resultUrl);
    if (exchangeError) throw exchangeError;

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
