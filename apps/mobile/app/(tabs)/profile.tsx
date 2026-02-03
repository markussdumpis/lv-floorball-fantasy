import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../src/providers/AuthProvider';
import { COLORS } from '../../src/theme/colors';
import { fetchJson } from '../../src/lib/supabaseRest';

export default function Profile() {
  const { user, loading, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [seasonPoints, setSeasonPoints] = useState<number | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);

  const performanceLoading = loading;
  const season = '2025-26';

  const displayName = useMemo(() => {
    const email = user?.email ?? '';
    const nick = email.split('@')[0];
    return nick || email || 'Guest';
  }, [user?.email]);

  const initials = useMemo(() => {
    const name = displayName.trim();
    if (!name) return '—';
    const parts = name.split(/[\\s._-]+/).filter(Boolean);
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

  useEffect(() => {
    const loadPoints = async () => {
      if (!user?.id) return;
      setPointsLoading(true);
      try {
        const { data } = await fetchJson<{ total_points: number }[]>('/rest/v1/leaderboard', {
          requireAuth: true,
          query: {
            select: 'total_points',
            user_id: `eq.${user.id}`,
            season: `eq.${season}`,
            limit: 1,
          },
          timeoutMs: 12000,
        });
        const row = Array.isArray(data) ? data[0] : null;
        const pts = row?.total_points != null ? Number(row.total_points) : 0;
        setSeasonPoints(Number.isFinite(pts) ? pts : 0);

        // fetch rank by ordering leaderboard
        const { data: rankRows } = await fetchJson<{ user_id: string; total_points: number }[]>('/rest/v1/leaderboard', {
          requireAuth: true,
          query: {
            select: 'user_id,total_points',
            season: `eq.${season}`,
            order: 'total_points.desc',
            limit: 2000,
          },
          timeoutMs: 12000,
        });
        if (Array.isArray(rankRows)) {
          const idx = rankRows.findIndex(r => r.user_id === user.id);
          setRank(idx >= 0 ? idx + 1 : null);
        } else {
          setRank(null);
        }
      } catch (err) {
        console.warn('[profile] failed to load season points', err);
        setSeasonPoints(0);
        setRank(null);
      } finally {
        setPointsLoading(false);
      }
    };
    loadPoints();
  }, [user?.id]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Identity */}
      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.heroText}>
          <Text style={styles.nick}>{displayName}</Text>
          <Text style={styles.email}>{user?.email ?? '—'}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Season 2025/2026</Text>
          </View>
        </View>
      </View>

      {/* Performance snapshot */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Performance snapshot</Text>
        <View style={styles.grid}>
          <StatCard label="Total points" value={formatStatValue(performanceLoading || pointsLoading, 0, (seasonPoints ?? 0).toString())} />
          <StatCard label="Place" value={formatStatValue(performanceLoading || pointsLoading, 'Unranked', rank ? `#${rank}` : 'Unranked')} />
          <StatCard label="Gameweeks played" value={formatStatValue(performanceLoading || pointsLoading, 0, '0')} />
          <StatCard label="Best rank" value={formatStatValue(performanceLoading, 'Not yet ranked', 'Not yet ranked')} />
        </View>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions</Text>
        <ActionRow label="Manage account" value={user?.email ?? '—'} disabled />
        <ActionRow label="Support" value="Coming soon" disabled />
        <TouchableOpacity
          style={[styles.actionRow, styles.logoutRow, signingOut && styles.buttonDisabled]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          <Text style={styles.actionLabel}>Sign out</Text>
          {signingOut ? <ActivityIndicator color={COLORS.muted} /> : <Text style={styles.actionValue}>Confirm</Text>}
        </TouchableOpacity>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

function formatStatValue(loading: boolean, emptyValue: string | number, display: string | number) {
  if (loading) return 'Loading…';
  if (display === undefined || display === null || display === '—') return String(emptyValue);
  return String(display);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function ActionRow({
  label,
  value,
  disabled,
}: {
  label: string;
  value: string;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.actionRow, disabled && styles.actionRowDisabled]}>
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.actionValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card2,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#111A33',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  heroText: {
    flex: 1,
  },
  nick: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  email: {
    color: COLORS.muted,
    fontSize: 14,
    marginBottom: 10,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#112042',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  badgeText: {
    color: COLORS.muted,
    fontSize: 12,
    letterSpacing: 0.3,
    fontWeight: '600',
  },
  section: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    backgroundColor: '#0D1833',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  statLabel: {
    color: COLORS.muted2,
    fontSize: 14,
    marginBottom: 8,
  },
  statValue: {
    color: COLORS.accent2,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  actionRowDisabled: {
    opacity: 0.6,
  },
  actionLabel: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  actionValue: {
    color: COLORS.muted,
    fontSize: 14,
  },
  logoutRow: {
    borderBottomWidth: 0,
    paddingVertical: 14,
  },
  error: {
    color: '#EF4444',
    fontSize: 14,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
