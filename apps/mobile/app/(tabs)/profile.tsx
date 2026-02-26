import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { AppBackground } from '../../src/components/AppBackground';
import { getSupabaseClient } from '../../src/lib/supabaseClient';
import { fetchJson, getAccessTokenFromStorage } from '../../src/lib/supabaseRest';
import { useAuth } from '../../src/providers/AuthProvider';
import { COLORS } from '../../src/theme/colors';
import { OnboardingModal } from '../../src/components/onboarding/OnboardingModal';
import { useOnboarding } from '../../src/hooks/useOnboarding';

const SEASON = '2025-26';
const SUPPORT_EMAIL = 'lvfloorballfantasy@gmail.com';
const DELETE_CONFIRM_TEXT = 'DELETE';
const NICKNAME_COOLDOWN_DAYS = 30;
const LEGAL_DOCS = {
  privacy: {
    title: 'Privacy Policy',
    url: 'https://markussdumpis.github.io/lv-floorball-fantasy/privacy.html',
  },
  terms: {
    title: 'Terms of Service',
    url: 'https://markussdumpis.github.io/lv-floorball-fantasy/terms.html',
  },
} as const;

type SettingsRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value?: string;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
  showDivider?: boolean;
  onPress?: () => void;
};

type StatTileProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  hint?: string;
};

type ProfileHeaderProps = {
  initials: string;
  displayName: string;
  email: string;
  seasonLabel: string;
};

type DeleteAccountResponse = {
  success?: boolean;
};

function isTimeoutLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message === 'DELETE_ACCOUNT_TIMEOUT' ||
    message === 'TIMEOUT' ||
    message.includes('AbortError') ||
    message.includes('aborted')
  );
}

async function withHardTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutCode: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default function Profile() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [seasonPoints, setSeasonPoints] = useState<number | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [gameweeksPlayed, setGameweeksPlayed] = useState<number | null>(null);
  const [bestRank, setBestRank] = useState<number | null>(null);
  const [pointsLoading, setPointsLoading] = useState(true);
  const [versionTapCount, setVersionTapCount] = useState(0);
  const [nickname, setNickname] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [editNicknameVisible, setEditNicknameVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteAttempted, setDeleteAttempted] = useState(false);
  const [nicknameSavedAt, setNicknameSavedAt] = useState<number | null>(null);
  const [nicknameUpdatedAt, setNicknameUpdatedAt] = useState<string | null>(null);
  const [legalDocKey, setLegalDocKey] = useState<keyof typeof LEGAL_DOCS | null>(null);
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [forcingLogout, setForcingLogout] = useState(false);
  const {
    visible: onboardingVisible,
    openManual: openOnboardingManual,
    finishOnboarding,
    submitting: onboardingSubmitting,
  } = useOnboarding({ autoShow: false });
  const scrollRef = useRef<ScrollView | null>(null);
  const legalVisibleRef = useRef(false);
  const legalErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performanceLoading = loading;

  const displayName = useMemo(() => {
    if (nickname && nickname.trim()) return nickname.trim();
    const email = user?.email ?? '';
    const nick = email.split('@')[0];
    return nick || email || 'Guest';
  }, [user?.email, nickname]);

  useEffect(() => {
    if (!__DEV__) return;
    console.log('[PROFILE_STATE]', {
      userId: user?.id ?? null,
      email: user?.email ?? null,
      nickname: nickname ?? null,
      displayName,
    });
  }, [displayName, nickname, user?.email, user?.id]);

  const nicknameCooldownDaysRemaining = useMemo(() => {
    if (!nicknameUpdatedAt) return 0;
    const lastChangedAt = Date.parse(nicknameUpdatedAt);
    if (!Number.isFinite(lastChangedAt)) return 0;
    const cooldownEndsAt = lastChangedAt + NICKNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const remainingMs = cooldownEndsAt - Date.now();
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  }, [nicknameUpdatedAt]);

  const initials = useMemo(() => {
    const name = displayName.trim();
    if (!name) return '—';
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [displayName]);

  const handleSignOutConfirmed = async () => {
    setError(null);
    setSigningOut(true);
    try {
      await signOut();
    } catch (e: any) {
      setError(e.message ?? 'Sign out failed.');
    } finally {
      setSigningOut(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: handleSignOutConfirmed },
    ]);
  };

  const resetProfileState = () => {
    setNickname(null);
    setNicknameInput('');
    setSeasonPoints(null);
    setRank(null);
    setGameweeksPlayed(0);
    setBestRank(null);
    setEditNicknameVisible(false);
    setNicknameSavedAt(null);
    setLegalDocKey(null);
    setLegalLoading(false);
    setLegalError(null);
    setError(null);
  };

  const handleDeleteAccountConfirmed = async () => {
    setError(null);
    setDeletingData(true);
    try {
      const supabase = getSupabaseClient();
      let accessToken: string | null = null;
      try {
        accessToken = await withHardTimeout(
          getAccessTokenFromStorage(),
          3_000,
          'DELETE_ACCOUNT_STORAGE_TOKEN_TIMEOUT',
        );
      } catch {
        accessToken = null;
      }
      if (!accessToken) {
        const { data: sessionData } = await withHardTimeout(
          supabase.auth.getSession(),
          10_000,
          'DELETE_ACCOUNT_SESSION_TIMEOUT',
        );
        accessToken = sessionData?.session?.access_token ?? null;
      }
      if (!accessToken) {
        Alert.alert('Delete account failed', 'Your session expired. Please sign in again.');
        return false;
      }

      // Delete in background using captured token; do not block UI logout.
      const deleteInBackground = async () => {
        try {
          const response = await withHardTimeout(
            fetchJson<DeleteAccountResponse>('/functions/v1/delete-account', {
              requireAuth: false,
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}` },
              body: {},
              timeoutMs: 20_000,
              label: 'delete-account',
            }),
            22_000,
            'DELETE_ACCOUNT_TIMEOUT',
          );
          if (!response?.data?.success && __DEV__) {
            console.log('[delete-account] unexpected response', response?.data ?? null);
          }
        } catch (err: any) {
          // best effort: user is already logged out locally
          if (__DEV__) {
            console.log('[delete-account] background delete failed', err?.message ?? String(err));
          }
        }
      };
      void deleteInBackground();

      resetProfileState();
      // Logout immediately without waiting on remote calls.
      try {
        await withHardTimeout(signOut(), 2_500, 'SIGNOUT_TIMEOUT');
      } catch {
        // continue to login route regardless
      }
      router.replace('/(auth)/login');
      return true;
    } catch (e: any) {
      if (isTimeoutLikeError(e)) {
        Alert.alert('Delete account failed', 'Session check timed out. Please try again.');
      } else {
        Alert.alert('Delete account failed', e?.message ?? 'Unable to delete account right now.');
      }
      return false;
    } finally {
      setDeletingData(false);
    }
  };

  const forceLogoutToLogin = useCallback(async () => {
    if (forcingLogout) return;
    setForcingLogout(true);
    try {
      await signOut();
    } catch {
      // best-effort logout
    } finally {
      router.replace('/(auth)/login');
      setForcingLogout(false);
    }
  }, [forcingLogout, router, signOut]);

  const closeDeleteConfirmModal = useCallback(() => {
    if (deletingData) return;
    setDeleteConfirmVisible(false);
    setDeleteConfirmInput('');
    setDeleteAttempted(false);
  }, [deletingData]);

  const handleDeleteAccount = () => {
    setDeleteConfirmInput('');
    setDeleteAttempted(false);
    setDeleteConfirmVisible(true);
  };

  const handleDeleteAccountFromModal = async () => {
    setDeleteAttempted(true);
    if (deleteConfirmInput !== DELETE_CONFIRM_TEXT) return;
    const success = await handleDeleteAccountConfirmed();
    if (!success) return;
    setDeleteConfirmVisible(false);
    setDeleteConfirmInput('');
    setDeleteAttempted(false);
  };

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/(auth)/login');
    }
  }, [loading, user, router]);

  const loadProfileNickname = useCallback(async () => {
    if (!user?.id) return;
    try {
      let row: { nickname: string | null; nickname_updated_at?: string | null } | null = null;
      try {
        const response = await fetchJson<{ nickname: string | null; nickname_updated_at: string | null }[]>(
          '/rest/v1/profiles',
          {
            requireAuth: true,
            query: { id: `eq.${user.id}`, select: 'nickname,nickname_updated_at', limit: 1 },
            timeoutMs: 8000,
            label: 'profile-nickname',
          },
        );
        row = Array.isArray(response.data) ? response.data[0] ?? null : null;
      } catch (e: any) {
        const message = String(e?.message ?? '');
        // Backward compatibility while DB migration is not yet applied.
        if (message.includes('nickname_updated_at does not exist')) {
          const fallback = await fetchJson<{ nickname: string | null }[]>('/rest/v1/profiles', {
            requireAuth: true,
            query: { id: `eq.${user.id}`, select: 'nickname', limit: 1 },
            timeoutMs: 8000,
            label: 'profile-nickname-fallback',
          });
          const fallbackRow = Array.isArray(fallback.data) ? fallback.data[0] ?? null : null;
          row = fallbackRow ? { nickname: fallbackRow.nickname, nickname_updated_at: null } : null;
        } else {
          throw e;
        }
      }
      if (!row) {
        if (__DEV__) {
          console.log('[PROFILE] nickname row missing', { userId: user.id });
        }
        await forceLogoutToLogin();
        return;
      }
      if (__DEV__) {
        console.log('[PROFILE] nickname loaded', { userId: user.id, nickname: row.nickname ?? null });
      }
      setNicknameUpdatedAt(row.nickname_updated_at ?? null);
      setNickname(row?.nickname ?? null);
      setNicknameInput(row?.nickname ?? '');
    } catch (e: any) {
      const message = e?.message ?? '';
      const status = e?.status;
      if (__DEV__) {
        console.log('[PROFILE] nickname load failed', {
          userId: user.id,
          status: status ?? null,
          message: String(message),
        });
      }
      if (status === 401 || /401/.test(String(message))) {
        await forceLogoutToLogin();
        return;
      }
    }
  }, [forceLogoutToLogin, user?.id]);

  useEffect(() => {
    void loadProfileNickname();
  }, [loadProfileNickname]);

  useEffect(() => {
    const loadPerformanceStats = async () => {
      if (!user?.id) {
        setSeasonPoints(null);
        setRank(null);
        setGameweeksPlayed(0);
        setBestRank(null);
        setPointsLoading(false);
        return;
      }
      setPointsLoading(true);
      try {
        const leaderboardRes = await fetchJson<{ user_id: string; total_points: number | string | null }[]>(
          '/rest/v1/leaderboard',
          {
            requireAuth: true,
            query: {
              select: 'user_id,total_points',
              season: `eq.${SEASON}`,
              order: 'total_points.desc',
              limit: 2000,
            },
            timeoutMs: 12000,
          },
        );

        const rows = Array.isArray(leaderboardRes.data) ? leaderboardRes.data : [];
        const sortedRows = [...rows].sort(
          (a, b) => toFiniteNumber(b.total_points) - toFiniteNumber(a.total_points),
        );
        const userIndex = sortedRows.findIndex(row => row.user_id === user.id);
        const userRow = userIndex >= 0 ? sortedRows[userIndex] : null;
        const points = userRow ? toFiniteNumber(userRow.total_points) : 0;
        const currentRank = userIndex >= 0 ? userIndex + 1 : null;

        const [gameweeksRes, profileRes] = await Promise.all([
          fetchJson<{ gameweeks_played: number | null }[]>(
            '/rest/v1/user_gameweeks_played_view',
            {
              requireAuth: true,
              query: {
                select: 'gameweeks_played',
                user_id: `eq.${user.id}`,
                limit: 1,
              },
              timeoutMs: 12000,
            },
          ),
          fetchJson<{ best_rank: number | null }[]>(
            '/rest/v1/profiles',
            {
              requireAuth: true,
              query: {
                select: 'best_rank',
                id: `eq.${user.id}`,
                limit: 1,
              },
              timeoutMs: 12000,
            },
          ),
        ]);
        const gameweeksRow = Array.isArray(gameweeksRes.data) ? gameweeksRes.data[0] : null;
        const profileRow = Array.isArray(profileRes.data) ? profileRes.data[0] : null;
        const playedWeeksRaw = Number(gameweeksRow?.gameweeks_played ?? 0);
        const playedWeeks = Number.isFinite(playedWeeksRaw) ? Math.max(0, Math.trunc(playedWeeksRaw)) : 0;
        const bestRankRaw = Number(profileRow?.best_rank ?? NaN);
        const persistedBestRank = Number.isFinite(bestRankRaw) ? Math.max(1, Math.trunc(bestRankRaw)) : null;

        setSeasonPoints(points);
        setRank(currentRank);
        setBestRank(persistedBestRank ?? currentRank);
        setGameweeksPlayed(playedWeeks);
      } catch {
        setSeasonPoints(null);
        setRank(null);
        setGameweeksPlayed(0);
        setBestRank(null);
      } finally {
        setPointsLoading(false);
      }
    };
    loadPerformanceStats();
  }, [user?.id]);

  useEffect(() => {
    if (!nicknameSavedAt) return;
    const timeout = setTimeout(() => setNicknameSavedAt(null), 1800);
    return () => clearTimeout(timeout);
  }, [nicknameSavedAt]);

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      void loadProfileNickname();
    }, [loadProfileNickname]),
  );

  const appVersion = useMemo(() => {
    const v = Constants.expoConfig?.version ?? 'dev';
    const build = Constants.expoConfig?.runtimeVersion ?? Constants.expoConfig?.extra?.buildNumber;
    return build ? `${v} (${build})` : v;
  }, []);
  const supportMailto = useMemo(
    () =>
      buildSupportMailto({
        userEmail: user?.email,
        platform: Platform.OS,
        osVersion: Platform.Version,
      }),
    [user?.email],
  );
  const activeLegalDoc = legalDocKey ? LEGAL_DOCS[legalDocKey] : null;

  useEffect(() => {
    legalVisibleRef.current = Boolean(activeLegalDoc);
    return () => {
      legalVisibleRef.current = false;
    };
  }, [activeLegalDoc]);

  useEffect(() => {
    return () => {
      if (legalErrorTimeoutRef.current) {
        clearTimeout(legalErrorTimeoutRef.current);
        legalErrorTimeoutRef.current = null;
      }
    };
  }, []);

  const openLegalDoc = (docKey: keyof typeof LEGAL_DOCS) => {
    if (legalErrorTimeoutRef.current) {
      clearTimeout(legalErrorTimeoutRef.current);
      legalErrorTimeoutRef.current = null;
    }
    setLegalDocKey(docKey);
    setLegalLoading(true);
    setLegalError(null);
  };

  const closeLegalDoc = () => {
    if (legalErrorTimeoutRef.current) {
      clearTimeout(legalErrorTimeoutRef.current);
      legalErrorTimeoutRef.current = null;
    }
    legalVisibleRef.current = false;
    setLegalDocKey(null);
    setLegalLoading(false);
    setLegalError(null);
  };

  const handleLegalLoadStart = () => {
    if (!legalVisibleRef.current) return;
    setLegalLoading(true);
    setLegalError(null);
  };

  const handleLegalLoadEnd = () => {
    if (!legalVisibleRef.current) return;
    setLegalLoading(false);
  };

  const handleLegalError = (event: any) => {
    if (!legalVisibleRef.current) return;
    if (legalErrorTimeoutRef.current) {
      clearTimeout(legalErrorTimeoutRef.current);
      legalErrorTimeoutRef.current = null;
    }
    setLegalLoading(false);
    legalErrorTimeoutRef.current = setTimeout(() => {
      if (!legalVisibleRef.current) return;
      setLegalError(event.nativeEvent.description || 'Failed to load this page.');
    }, 220);
  };

  const openLegalInBrowser = useCallback(async () => {
    if (!activeLegalDoc) return;
    try {
      await Linking.openURL(activeLegalDoc.url);
    } catch {
      Alert.alert('Unable to open browser', 'Please try again later.');
    }
  }, [activeLegalDoc]);

  const handleSupportPress = useCallback(async () => {
    try {
      const fallbackMailto = `mailto:${SUPPORT_EMAIL}`;
      const urlsToTry = [supportMailto, fallbackMailto];

      for (const url of urlsToTry) {
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) continue;
        await Linking.openURL(url);
        return;
      }

      Alert.alert(
        'No email app available',
        `Please set up an email app on this device, or email us at ${SUPPORT_EMAIL}.`,
      );
    } catch {
      Alert.alert(
        'Unable to open email app',
        `Please email us at ${SUPPORT_EMAIL} and include details about your issue.`,
      );
    }
  }, [supportMailto]);

  const handleVersionTap = () => {
    const next = versionTapCount + 1;
    setVersionTapCount(next);
    if (next >= 7) {
      setVersionTapCount(0);
      router.push('/diagnostics');
    }
    setTimeout(() => setVersionTapCount(0), 4000);
  };

  const saveNickname = async () => {
    const trimmed = nicknameInput.trim();
    if (!trimmed) {
      setError('Nickname cannot be empty.');
      return;
    }
    if (trimmed.length < 3 || trimmed.length > 20) {
      setError('Nickname must be 3-20 characters.');
      return;
    }
    if (nicknameCooldownDaysRemaining > 0) {
      setError(`You can change your nickname again in ${nicknameCooldownDaysRemaining} days.`);
      return;
    }

    setError(null);
    setNicknameSaving(true);
    try {
      await fetchJson('/rest/v1/rpc/update_nickname', {
        requireAuth: true,
        method: 'POST',
        body: { new_nickname: trimmed },
        timeoutMs: 8000,
      });
      setNickname(trimmed);
      setNicknameInput(trimmed);
      setNicknameUpdatedAt(new Date().toISOString());
      setNicknameSavedAt(Date.now());
      setEditNicknameVisible(false);
    } catch (e: any) {
      const message = String(e?.message ?? '');
      if (message.includes('NICKNAME_COOLDOWN')) {
        const cooldownMatch = message.match(/NICKNAME_COOLDOWN:(\d+)/);
        const remainingDays = cooldownMatch ? Number(cooldownMatch[1]) : nicknameCooldownDaysRemaining;
        const safeDays = Number.isFinite(remainingDays) && remainingDays > 0 ? remainingDays : 1;
        setError(`You can change your nickname again in ${safeDays} days.`);
      } else if (
        message.includes('update_nickname') ||
        message.includes('nickname_updated_at does not exist')
      ) {
        setError('Database update pending. Please run the latest Supabase migration.');
      } else {
        setError(e?.message ?? 'Failed to save nickname.');
      }
    } finally {
      setNicknameSaving(false);
    }
  };

  if (loading) {
    return (
      <AppBackground variant="home">
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.accent2} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground variant="home">
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces
        >
          <Text style={styles.screenTitle}>Profile</Text>

          <ProfileHeader
            initials={initials}
            displayName={displayName}
            email={user?.email ?? '—'}
            seasonLabel="Season 2025/2026"
          />

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Performance snapshot</Text>
            <View style={styles.grid}>
              <StatTile
                icon="trophy-outline"
                label="Total points"
                value={formatStatValue(
                  performanceLoading || pointsLoading,
                  '—',
                  seasonPoints == null ? '—' : formatPoints(seasonPoints),
                )}
                hint="Current season"
              />
              <StatTile
                icon="stats-chart-outline"
                label="Place"
                value={formatStatValue(performanceLoading || pointsLoading, 'Unranked', rank ? `#${rank}` : 'Unranked')}
                hint="League ranking"
              />
              <StatTile
                icon="calendar-clear-outline"
                label="Gameweeks played"
                value={
                  performanceLoading || pointsLoading
                    ? '—'
                    : formatStatValue(false, '0', (gameweeksPlayed ?? 0).toString())
                }
                hint="Distinct submitted weeks"
              />
              <StatTile
                icon="flash-outline"
                label="Best rank"
                value={
                  performanceLoading || pointsLoading
                    ? '—'
                    : bestRank
                    ? `#${bestRank}`
                    : '—'
                }
                hint="Lowest rank achieved"
              />
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <View style={styles.settingsCard}>
              <SettingsRow
                icon="create-outline"
                title="Change Nickname"
                value={
                  nicknameCooldownDaysRemaining > 0
                    ? `Available in ${nicknameCooldownDaysRemaining} days`
                    : nicknameSavedAt
                    ? 'Saved'
                    : displayName
                }
                disabled={nicknameCooldownDaysRemaining > 0}
                onPress={() => {
                  if (nicknameCooldownDaysRemaining > 0) return;
                  setError(null);
                  setEditNicknameVisible(true);
                }}
              />
              <SettingsRow
                icon="person-circle-outline"
                title="Manage account"
                onPress={() => {
                  router.push('/account-security');
                }}
              />
              <SettingsRow
                icon="information-circle-outline"
                title="How it works"
                onPress={openOnboardingManual}
              />
              <SettingsRow
                icon="shield-checkmark-outline"
                title="Privacy Policy"
                onPress={() => openLegalDoc('privacy')}
              />
              <SettingsRow
                icon="document-text-outline"
                title="Terms of Service"
                onPress={() => openLegalDoc('terms')}
              />
              <SettingsRow
                icon="help-buoy-outline"
                title="Support"
                onPress={() => {
                  void handleSupportPress();
                }}
              />
              <SettingsRow
                icon="log-out-outline"
                title="Sign out"
                destructive
                disabled={deletingData}
                loading={signingOut}
                showDivider
                onPress={handleSignOut}
              />
              <SettingsRow
                icon="trash-outline"
                title="Delete account"
                destructive
                disabled={deletingData}
                loading={deletingData}
                showDivider={false}
                onPress={handleDeleteAccount}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <Pressable style={styles.footer} onPress={handleVersionTap}>
            <Text style={styles.versionText}>App version {appVersion}</Text>
            <Text style={styles.versionHint}>Tap 7x for diagnostics</Text>
          </Pressable>
        </ScrollView>

        <Modal
          animationType="slide"
          transparent
          visible={editNicknameVisible}
          onRequestClose={() => setEditNicknameVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditNicknameVisible(false)} />
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Edit nickname</Text>
              <Text style={styles.sheetSubtitle}>Choose how your name appears in leaderboards.</Text>
              <TextInput
                style={styles.sheetInput}
                placeholder="Enter nickname"
                placeholderTextColor={COLORS.muted2}
                value={nicknameInput}
                onChangeText={setNicknameInput}
                editable={!nicknameSaving}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
              />
              <View style={styles.sheetActions}>
                <Pressable
                  style={({ pressed }) => [styles.sheetBtn, styles.cancelBtn, pressed && styles.pressed]}
                  onPress={() => setEditNicknameVisible(false)}
                  disabled={nicknameSaving}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.sheetBtn,
                    styles.saveBtn,
                    (pressed || nicknameSaving) && styles.pressed,
                  ]}
                  onPress={saveNickname}
                  disabled={nicknameSaving}
                >
                  {nicknameSaving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          animationType="slide"
          transparent
          visible={deleteConfirmVisible}
          onRequestClose={closeDeleteConfirmModal}
        >
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeDeleteConfirmModal} disabled={deletingData} />
            <View style={[styles.sheet, styles.deleteSheet]}>
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, styles.deleteSheetTitle]}>Delete Account</Text>
              <Text style={[styles.sheetSubtitle, styles.deleteSheetSubtitle]}>
                This will permanently delete your account and data. This action cannot be undone.
              </Text>
              <View
                style={[
                  styles.deleteInputWrap,
                  deleteConfirmInput === DELETE_CONFIRM_TEXT && styles.deleteInputWrapValid,
                ]}
              >
                <TextInput
                  style={styles.deleteInput}
                  placeholder="Type DELETE to confirm"
                  placeholderTextColor={COLORS.muted2}
                  value={deleteConfirmInput}
                  onChangeText={value => {
                    setDeleteConfirmInput(value);
                    if (value === DELETE_CONFIRM_TEXT) {
                      setDeleteAttempted(false);
                    }
                  }}
                  editable={!deletingData}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    setDeleteAttempted(true);
                  }}
                />
                {deleteConfirmInput === DELETE_CONFIRM_TEXT ? (
                  <Ionicons name="checkmark-circle" size={18} color="rgba(52, 211, 153, 0.95)" />
                ) : null}
              </View>
              {deleteAttempted && deleteConfirmInput !== DELETE_CONFIRM_TEXT ? (
                <Text style={styles.deleteHelperText}>Type DELETE exactly to enable account deletion.</Text>
              ) : null}
              <View style={styles.deleteActions}>
                <Pressable
                  style={({ pressed }) => [styles.deleteCloseBtn, pressed && styles.pressed]}
                  onPress={closeDeleteConfirmModal}
                  disabled={deletingData}
                >
                  <Text style={styles.deleteCloseBtnText}>Close</Text>
                </Pressable>
                <Pressable
                  accessibilityState={{ disabled: deleteConfirmInput !== DELETE_CONFIRM_TEXT || deletingData }}
                  style={({ pressed }) => [
                    styles.sheetBtn,
                    styles.deleteBtn,
                    (deleteConfirmInput !== DELETE_CONFIRM_TEXT || deletingData) && styles.deleteBtnDisabled,
                    pressed && deleteConfirmInput === DELETE_CONFIRM_TEXT && !deletingData && styles.pressed,
                  ]}
                  onPress={() => {
                    void handleDeleteAccountFromModal();
                  }}
                  disabled={deleteConfirmInput !== DELETE_CONFIRM_TEXT || deletingData}
                >
                  {deletingData ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.deleteBtnText}>Delete account</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <OnboardingModal
          visible={onboardingVisible}
          onFinish={finishOnboarding}
          submitting={onboardingSubmitting}
        />

        <Modal
          animationType="fade"
          visible={Boolean(activeLegalDoc)}
          presentationStyle="fullScreen"
          hardwareAccelerated
          onRequestClose={closeLegalDoc}
        >
          <View style={styles.legalPlainBg}>
            <View style={styles.legalRoot}>
              <View style={[styles.legalHeader, { paddingTop: Math.max(insets.top, 10) }]}>
                <Pressable
                  style={({ pressed }) => [styles.legalHeaderBtn, pressed && styles.pressed]}
                  onPress={closeLegalDoc}
                >
                  <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                  <Text style={styles.legalHeaderBtnText}>Back</Text>
                </Pressable>
                <Text numberOfLines={1} style={styles.legalHeaderTitle}>
                  {activeLegalDoc?.title ?? ''}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.legalCloseBtn, pressed && styles.pressed]}
                  onPress={closeLegalDoc}
                >
                  <Ionicons name="close" size={20} color={COLORS.text} />
                </Pressable>
              </View>

              <View style={[styles.legalBody, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                {activeLegalDoc && !legalError ? (
                  <View style={styles.webViewWrap}>
                    <WebView
                      source={{ uri: activeLegalDoc.url }}
                      onLoadStart={handleLegalLoadStart}
                      onLoadEnd={handleLegalLoadEnd}
                      onError={handleLegalError}
                      startInLoadingState
                    />
                    {legalLoading ? (
                      <View style={styles.webLoaderOverlay}>
                        <ActivityIndicator size="large" color={COLORS.accent2} />
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.legalFallback}>
                    <Ionicons name="warning-outline" size={40} color="rgba(255,255,255,0.85)" />
                    <Text style={styles.legalFallbackTitle}>Could not load this page</Text>
                    <Text style={styles.legalFallbackText}>
                      {legalError ?? 'Please open this document in your browser.'}
                    </Text>
                    <Pressable
                      style={({ pressed }) => [styles.legalBrowserBtn, pressed && styles.pressed]}
                      onPress={openLegalInBrowser}
                    >
                      <Text style={styles.legalBrowserBtnText}>Open in browser</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </AppBackground>
  );
}

function formatStatValue(loading: boolean, emptyValue: string | number, display: string | number) {
  if (loading) return '—';
  if (display === undefined || display === null || display === '—') return String(emptyValue);
  return String(display);
}

function toFiniteNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPoints(value: number) {
  return toFiniteNumber(value).toFixed(1);
}

function buildSupportMailto({
  userEmail,
  platform,
  osVersion,
}: {
  userEmail?: string | null;
  platform: string;
  osVersion: string | number;
}) {
  const appVersion = Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? 'unknown';
  const iosBuild = Constants.expoConfig?.ios?.buildNumber;
  const androidBuild = Constants.expoConfig?.android?.versionCode;
  const buildNumber =
    (platform === 'ios'
      ? iosBuild
      : platform === 'android'
      ? typeof androidBuild === 'number'
        ? String(androidBuild)
        : androidBuild
      : null) ??
    Constants.nativeBuildVersion ??
    Constants.expoConfig?.extra?.buildNumber ??
    'unknown';
  const platformLabel = platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : platform;
  const lines = [
    'Hi Support,',
    '',
    'Please describe your issue here:',
    '',
    '---',
    'Debug info:',
    userEmail ? `User email: ${userEmail}` : null,
    `App version: ${appVersion}`,
    `Build number: ${buildNumber}`,
    `Platform: ${platformLabel} ${String(osVersion ?? 'unknown')}`,
  ].filter(Boolean);

  const subject = encodeURIComponent('Floorball Fantasy – Support');
  const body = encodeURIComponent(lines.join('\n'));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

// Manual test note:
// tap Delete account -> modal opens -> typing wrong text keeps button disabled ->
// typing DELETE enables button -> Cancel closes modal and clears input.

function ProfileHeader({ initials, displayName, email, seasonLabel }: ProfileHeaderProps) {
  return (
    <View style={styles.profileHeader}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>

      <View style={styles.headerMain}>
        <Text numberOfLines={1} style={styles.displayName}>
          {displayName}
        </Text>
        <Text numberOfLines={1} style={styles.emailText}>
          {email}
        </Text>
        <View style={styles.seasonPill}>
          <Text style={styles.seasonText}>{seasonLabel}</Text>
        </View>
      </View>
    </View>
  );
}

function StatTile({ icon, label, value, hint }: StatTileProps) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        <Ionicons name={icon} size={14} color="rgba(255,255,255,0.36)" />
      </View>
      <Text numberOfLines={1} style={styles.statValue}>
        {value}
      </Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

function SettingsRow({ icon, title, value, destructive, disabled, loading, showDivider = true, onPress }: SettingsRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.settingsRow,
        !showDivider && styles.settingsRowLast,
        disabled && styles.rowDisabled,
        pressed && !disabled && styles.rowPressed,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.rowIconWrap, destructive && styles.destructiveIconWrap]}>
          <Ionicons
            name={icon}
            size={17}
            color={destructive ? 'rgba(244, 114, 114, 0.9)' : 'rgba(255,255,255,0.74)'}
          />
        </View>
        <Text style={[styles.rowTitle, destructive && styles.destructiveText]}>{title}</Text>
      </View>

      <View style={styles.rowRight}>
        {loading ? <ActivityIndicator size="small" color={COLORS.muted} /> : null}
        {!loading && value ? (
          <Text numberOfLines={1} style={[styles.rowValue, destructive && styles.destructiveText]}>
            {value}
          </Text>
        ) : null}
        {!loading && !disabled && !destructive ? (
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
  },
  screenTitle: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 14,
  },
  profileHeader: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(11,24,53,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    shadowColor: COLORS.accent2,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  avatarText: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    color: COLORS.text,
    fontSize: 23,
    fontWeight: '800',
  },
  emailText: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.62)',
    fontSize: 13,
  },
  seasonPill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
  },
  seasonText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  sectionBlock: {
    marginTop: 20,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  statTile: {
    width: '48.5%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
  },
  statValue: {
    color: COLORS.accent2,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: 0.2,
  },
  statHint: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    marginTop: 2,
  },
  settingsCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    overflow: 'hidden',
  },
  settingsRow: {
    minHeight: 54,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  settingsRowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowDisabled: {
    opacity: 0.72,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  rowIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveIconWrap: {
    backgroundColor: 'rgba(239,68,68,0.13)',
  },
  rowTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '52%',
  },
  rowValue: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
  },
  destructiveText: {
    color: 'rgba(244, 114, 114, 0.88)',
  },
  error: {
    color: '#FCA5A5',
    fontSize: 13,
    marginTop: 10,
  },
  footer: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
  },
  versionText: {
    color: 'rgba(255,255,255,0.36)',
    fontSize: 12,
    fontWeight: '600',
  },
  versionHint: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 11,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    backgroundColor: '#0B1933',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: 12,
  },
  sheetTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  sheetInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  sheetBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cancelBtnText: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: COLORS.accent2,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  deleteSheet: {
    paddingTop: 12,
    paddingBottom: 28,
    gap: 10,
    marginBottom: 14,
  },
  deleteSheetTitle: {
    fontSize: 22,
    letterSpacing: 0.2,
  },
  deleteSheetSubtitle: {
    fontSize: 15,
    marginTop: 2,
    marginBottom: 8,
    lineHeight: 22,
  },
  deleteInputWrap: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteInputWrapValid: {
    borderColor: 'rgba(52, 211, 153, 0.85)',
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
  },
  deleteInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 16,
    paddingVertical: 12,
  },
  deleteHelperText: {
    marginTop: -2,
    color: 'rgba(252, 165, 165, 0.95)',
    fontSize: 12,
    lineHeight: 16,
  },
  deleteActions: {
    marginTop: 10,
    marginBottom: 14,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteCloseBtn: {
    width: 84,
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCloseBtnText: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  deleteBtn: {
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
    minHeight: 50,
    flex: 1,
  },
  deleteBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  deleteBtnDisabled: {
    backgroundColor: 'rgba(120, 40, 40, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pressed: {
    opacity: 0.8,
  },
  legalRoot: {
    flex: 1,
  },
  legalPlainBg: {
    flex: 1,
    backgroundColor: '#06152A',
  },
  legalHeader: {
    minHeight: 60,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(8, 20, 42, 0.65)',
  },
  legalHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
    paddingRight: 6,
    minWidth: 64,
  },
  legalHeaderBtnText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  legalHeaderTitle: {
    flex: 1,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  legalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  legalBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  webViewWrap: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#FFFFFF',
  },
  webLoaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,18,34,0.25)',
  },
  legalFallback: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  legalFallbackTitle: {
    marginTop: 12,
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  legalFallbackText: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    textAlign: 'center',
  },
  legalBrowserBtn: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: COLORS.accent2,
  },
  legalBrowserBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
