import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';

export async function signUp(email: string, password: string) {
  const supabase = getSupabaseClient();
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email: string, password: string) {
  const supabase = getSupabaseClient();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const supabase = getSupabaseClient();
  return supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Failed to get session', error);
    return null;
  }
  return data.session ?? null;
}
