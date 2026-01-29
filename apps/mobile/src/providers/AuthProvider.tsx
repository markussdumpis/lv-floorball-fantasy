import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { forceLocalSignOut } from '../lib/supabaseRest';

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configError: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
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
        }
        const initialSession = data.session ?? null;
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        if (initialSession?.user) {
          await ensureProfile(initialSession.user.id, supabase);
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        await ensureProfile(newSession.user.id, supabase);
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

  const signInWithGoogle = async () => {
    if (!supabase) throw new Error(configError ?? 'Supabase not configured.');
    const redirectTo = AuthSession.makeRedirectUri({
      scheme: Constants.expoConfig?.scheme ?? 'lvfloorball',
      path: 'auth/callback',
      // When testing in Expo Go, add https://auth.expo.io/@<your-username>/lv-floorball-fantasy
      // to Supabase Auth > Redirect URLs. For dev clients, also add exp+lvfloorball://auth/callback.
    });

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
    if (result.type !== 'success' || !result.url) {
      throw new Error('Google sign-in was cancelled.');
    }

    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
      result.url
    );
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

  const value: AuthContextValue = {
    session,
    user,
    loading,
    configError,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
