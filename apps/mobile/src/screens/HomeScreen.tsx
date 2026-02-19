import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  useWindowDimensions,
  Animated,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useUpcomingMatches } from '../hooks/useUpcomingMatches';
import { COLORS } from '../theme/colors';
import dayjs from 'dayjs';
import { SCORING_RULES } from '../config/scoring';
import { GAME_RULES } from '../constants/rules';
import { AppBackground } from '../components/AppBackground';
import { useLeaderboard } from '../hooks/useLeaderboard';

const S = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32 };
const LOGO_URL =
  'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/Fantassy%20App%20Logo.png';
const TEAM_LOGOS: Record<string, string> = {
  BAU: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/BAU-logo.png',
  IRL: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/IRL-logo.png',
  KEK: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/KEK-logo.png',
  LEK: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/LEK-logo.png',
  LVD: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/LVD-logo.png',
  RUB: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/RUB-logo.png',
  SAC: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/SAC-logo.png',
  TAL: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/TAL-logo.png',
  ULB: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/ULB-logo.png',
  VAL: 'https://uokqnotvnfoqbxdpwbxg.supabase.co/storage/v1/object/public/public-assets/VAL-logo.png',
};

const PALETTE = {
  cardSurface: 'rgba(255,255,255,0.04)',
  cardBorder: 'rgba(255,255,255,0.08)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.65)',
  textTertiary: 'rgba(255,255,255,0.45)',
  primaryRed: COLORS.latvianMaroon,
  accentRed: COLORS.latvianMaroonMuted,
  primaryBlue: '#5DBBFF',
  pointsOffWhite: '#E6EDF3',
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { matches, loading: matchesLoading, error: matchesError } = useUpcomingMatches();
  const { width } = useWindowDimensions();
  const CONTENT_PADDING = S.md; // matches ScrollView horizontal padding
  const CARD_SHELL_PADDING = S.xs; // padding around matches card
  const AVAILABLE_WIDTH = width - 2 * (CONTENT_PADDING + CARD_SHELL_PADDING);
  const CARD_WIDTH = Math.min(332, AVAILABLE_WIDTH - 8); // trim a few px to keep full card visible inside shell
  const EDGE = Math.max(0, (AVAILABLE_WIDTH - CARD_WIDTH) / 2);
  const ITEM_SPACING = 14;
  const SNAP = CARD_WIDTH + ITEM_SPACING;
  const { rows: leaderboardRows, loading: leaderboardLoading, error: leaderboardError } = useLeaderboard(50);
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'MISSING';
  const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseAnonStatus = supabaseAnon ? 'OK' : 'MISSING';

  const [showRules, setShowRules] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const rootScrollRef = useRef<ScrollView | null>(null);
  const watermarkAnim = useRef(new Animated.Value(0)).current;
  const contentHeightRef = useRef(0);
  const viewHeightRef = useRef(0);

  useEffect(() => {
    console.log('[home] mounted');
  }, []);

  useFocusEffect(
    useCallback(() => {
      rootScrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  const getDisplayName = (row: { nickname: string | null; user_id: string }) => {
    if (row.nickname && row.nickname.trim()) return row.nickname.trim();
    const uid = row.user_id ?? '';
    if (uid.length <= 9) return uid || 'Unknown';
    return `${uid.slice(0, 4)}…${uid.slice(-5)}`;
  };

  const formatPoints = (pts: number | null | undefined) => {
    if (pts === null || pts === undefined) return '0';
    const num = Number(pts);
    if (Number.isNaN(num)) return '0';
    return num.toFixed(0);
  };

  useEffect(() => {
    const shouldShow = isAtBottom && !showRules;
    Animated.timing(watermarkAnim, {
      toValue: shouldShow ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isAtBottom, showRules, watermarkAnim]);

  const handleScroll = (event: any) => {
    const y = event.nativeEvent.contentOffset.y;
    const height = viewHeightRef.current || event.nativeEvent.layoutMeasurement.height;
    const contentHeight = contentHeightRef.current || event.nativeEvent.contentSize.height;
    const atBottom = y + height >= contentHeight - 80;
    setIsAtBottom(prev => (prev === atBottom ? prev : atBottom));
  };

  return (
    <AppBackground>
      <View style={styles.screen}>
        <ScrollView
          ref={rootScrollRef}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + S.sm }]}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_, ch) => {
            contentHeightRef.current = ch;
          }}
          onLayout={e => {
            viewHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          <View style={styles.header}>
            <Image source={{ uri: LOGO_URL }} style={styles.headerLogo} />
            <View style={styles.headerButtonRow}>
              <Pressable
              style={({ pressed }) => [
                styles.headerActionButton,
                styles.headerActionPrimary,
                styles.headerAction3d,
                pressed && styles.headerActionPressed,
                pressed && { transform: [{ translateY: 1.5 }, { scale: 0.98 }] },
              ]}
                onPress={() => router.push('/squad')}
                android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: false }}
              >
                <Text style={styles.headerActionPrimaryText}>My Team</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.headerActionButton,
                  styles.headerActionLocked,
                  styles.headerAction3d,
                  pressed && styles.headerActionPressed,
                  pressed && { transform: [{ translateY: 1.5 }, { scale: 0.98 }] },
                ]}
                disabled
              >
                <Text style={styles.headerActionLockedText}>Draft mode</Text>
                <Text style={styles.headerActionLockedSub}>Coming soon</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.card, styles.matchesCardShell]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, styles.matchesTitle]}>Upcoming matches</Text>
              <Pressable hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.7 }} onPress={() => router.push('/fixtures')}>
                <Text style={styles.cardHint}>See all</Text>
              </Pressable>
            </View>

          {matchesLoading ? (
            <FlatList
              data={Array.from({ length: 3 })}
              keyExtractor={(_, idx) => `skeleton-${idx}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.matchesList,
                { alignItems: 'center', paddingHorizontal: EDGE },
              ]}
              ItemSeparatorComponent={() => <View style={{ width: ITEM_SPACING }} />}
              snapToInterval={SNAP}
              decelerationRate="fast"
              snapToAlignment="center"
              disableIntervalMomentum
              pagingEnabled
              bounces={false}
              renderItem={({ index }) => (
                <MatchSkeletonCard index={index} cardWidth={CARD_WIDTH} cardHeight={126} />
              )}
              getItemLayout={(_, index) => ({
                length: SNAP,
                offset: SNAP * index,
                index,
              })}
            />
          ) : matches.length === 0 ? (
            <Text style={styles.emptyText}>No upcoming matches</Text>
          ) : (
            <FlatList
              data={matches}
              keyExtractor={item => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.matchesList,
                { alignItems: 'center', paddingHorizontal: EDGE },
              ]}
              ItemSeparatorComponent={() => <View style={{ width: ITEM_SPACING }} />}
              renderItem={({ item }) => (
                <MatchTile match={item} cardWidth={CARD_WIDTH} cardHeight={126} />
              )}
              snapToAlignment="center"
              snapToInterval={SNAP}
              decelerationRate="fast"
              pagingEnabled
              getItemLayout={(_, index) => ({
                length: SNAP,
                offset: SNAP * index,
                index,
              })}
              disableIntervalMomentum
              bounces={false}
            />
          )}

        </View>

        <Pressable
          style={({ pressed }) => [
            styles.card,
            styles.leaderboardCard,
            pressed && { opacity: 0.9 },
          ]}
          onPress={() => setShowLeaderboardModal(true)}
        >
          <Text style={styles.cardTitle}>Leaderboard</Text>
          <View style={styles.list}>
            {leaderboardLoading ? (
              <Text style={styles.emptyText}>Loading leaderboard…</Text>
            ) : leaderboardError ? (
              <Text style={styles.errorText} numberOfLines={2} selectable>
                error={leaderboardError}
              </Text>
            ) : leaderboardRows.length === 0 ? (
              <Text style={styles.emptyText}>No leaderboard yet — be the first</Text>
            ) : (
              leaderboardRows.slice(0, 3).map((row, index) => (
                <Pressable
                  key={row.user_id}
                  style={({ pressed }) => [
                    styles.leaderboardRow,
                    pressed && { opacity: 0.7, transform: [{ translateY: 1 }] },
                  ]}
                  onPress={() => {
                    setShowLeaderboardModal(true);
                    router.push(`/profile/${row.user_id}`);
                  }}
                >
                  <View style={styles.leaderboardNameBlock}>
                    <View style={styles.leaderboardBadge}>
                      <Text style={styles.leaderboardBadgeText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.leaderboardName}>{getDisplayName(row)}</Text>
                  </View>
                  <Text style={styles.leaderboardPoints}>
                    {(() => {
                      const points = Number(row.total_points ?? 0);
                      if (__DEV__) console.log('[leaderboard] row', row.user_id, 'total_points typeof', typeof row.total_points, 'points', points);
                      return `${points.toFixed(0)} pts`;
                    })()}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </Pressable>

        <View style={{ height: 40 }} />

        <Pressable
          onPress={() => setShowRules(prev => !prev)}
          style={({ pressed }) => [
            styles.card,
            styles.rulesToggle,
            pressed && { transform: [{ translateY: 1 }] },
          ]}
        >
          <View style={styles.rulesHeader}>
            <Text style={styles.cardTitle}>Rules & Points</Text>
            <Text style={styles.cardHint}>{showRules ? 'Hide' : 'Show'}</Text>
          </View>
          {showRules ? (
            <View style={styles.rulesBody}>
              <View style={styles.rulesSection}>
                <Text style={styles.rulesSectionTitle}>Rules</Text>
                {GAME_RULES.map(row => (
                  <View key={`rules-${row.label}`} style={styles.rulesRow}>
                    <Text style={styles.rulesRowLabel}>{row.label}</Text>
                    <Text style={styles.rulesRowValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
              {SCORING_RULES.map(section => (
                <View key={section.title} style={styles.rulesSection}>
                  <Text style={styles.rulesSectionTitle}>{section.title}</Text>
                  {section.rows.map(row => (
                    <View key={`${section.title}-${row.label}`} style={styles.rulesRow}>
                      <Text style={styles.rulesRowLabel}>{row.label}</Text>
                      <Text style={styles.rulesRowValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              ))}
              </View>
            ) : null}
        </Pressable>
          <Animated.Image
            source={{ uri: LOGO_URL }}
            style={[
              styles.watermark,
              {
                opacity: watermarkAnim,
                transform: [
                  {
                    scale: watermarkAnim.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.05] }),
                  },
                ],
                bottom: Math.max(18, insets.bottom + 10),
              },
            ]}
            pointerEvents="none"
          />
        </ScrollView>
      </View>
      <Modal
        visible={showLeaderboardModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowLeaderboardModal(false);
          router.push('/(tabs)');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.cardTitle}>Leaderboard</Text>
              <Pressable
                onPress={() => {
                  setShowLeaderboardModal(false);
                  router.push('/(tabs)');
                }}
                hitSlop={10}
              >
                <Text style={styles.cardHint}>Close</Text>
              </Pressable>
            </View>
            <ScrollView>
              <View style={styles.list}>
                {(leaderboardRows.length ? leaderboardRows : []).map((row, index) => (
                  <View key={row.user_id || `lb-${index}`} style={styles.leaderboardRow}>
                    <View style={styles.leaderboardNameBlock}>
                      <View style={styles.leaderboardBadge}>
                        <Text style={styles.leaderboardBadgeText}>{index + 1}</Text>
                      </View>
                      <Text style={styles.leaderboardName}>{getDisplayName(row)}</Text>
                    </View>
                    <Text style={styles.leaderboardPoints}>
                      {(() => {
                        const points = Number(row.total_points ?? 0);
                        if (__DEV__) console.log('[leaderboard-modal] row', row.user_id, 'typeof', typeof row.total_points, 'points', points);
                        return `${points.toFixed(0)} pts`;
                      })()}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AppBackground>
  );
}

function MatchTile({
  match,
  cardWidth,
  cardHeight,
}: {
  match: ReturnType<typeof useUpcomingMatches>['matches'][number];
  cardWidth: number;
  cardHeight: number;
}) {
  const date = dayjs(match.date);
  const homeCodeRaw = match.home?.code || 'HOME';
  const awayCodeRaw = match.away?.code || 'AWAY';
  const homeCode = getShortCode(homeCodeRaw);
  const awayCode = getShortCode(awayCodeRaw);
  const homeLogo = match.home?.logo_url || TEAM_LOGOS[homeCode as keyof typeof TEAM_LOGOS];
  const awayLogo = match.away?.logo_url || TEAM_LOGOS[awayCode as keyof typeof TEAM_LOGOS];

  return (
    <View style={[styles.matchCard, { width: cardWidth, height: cardHeight }]}>
      <View style={styles.matchRow}>
        <View style={styles.teamColLeft}>
          <Image source={{ uri: homeLogo || '' }} style={styles.teamLogo} resizeMode="contain" />
        </View>

        <View style={styles.centerCol}>
          <View style={styles.codesRow}>
            <Text style={styles.teamCode}>{homeCode}</Text>
            <Text style={styles.matchVs}>vs</Text>
            <Text style={styles.teamCode}>{awayCode}</Text>
          </View>
          <Text style={styles.matchTime}>{date.format('HH:mm')}</Text>
          <Text style={styles.matchDate}>{date.format('ddd, MMM D').toUpperCase()}</Text>
        </View>

        <View style={styles.teamColRight}>
          <Image source={{ uri: awayLogo || '' }} style={styles.teamLogo} resizeMode="contain" />
        </View>
      </View>
    </View>
  );
}

function MatchSkeletonCard({
  index,
  cardWidth,
  cardHeight,
}: {
  index: number;
  cardWidth: number;
  cardHeight: number;
}) {
  return (
    <View
      style={[
        styles.matchCard,
        styles.matchCardSkeleton,
        { marginLeft: index === 0 ? 0 : 10, width: cardWidth, height: cardHeight },
      ]}
    >
      <View style={[styles.skeletonLine, { width: 80 }]} />
      <View style={[styles.skeletonLine, { width: 60 }]} />
      <View style={[styles.skeletonLine, { width: 100 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingVertical: S.md,
    paddingHorizontal: S.md,
    paddingBottom: 150,
    gap: S.sm,
  },
  header: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
    marginBottom: 6,
    gap: S.sm,
  },
  headerLogo: {
    width: '93%',
    height: 140,
    resizeMode: 'contain',
    alignSelf: 'center',
    marginBottom: S.sm,
  },
  headerButtonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: S.md,
    marginTop: 8,
    marginBottom: 4,
  },
  headerActionButton: {
    flex: 1,
    height: 54,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionPrimary: {
    backgroundColor: PALETTE.primaryRed,
  },
  headerActionSecondary: {
    backgroundColor: COLORS.accent,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  headerActionLocked: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: PALETTE.cardBorder,
  },
  headerAction3d: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 94, 0.28)',
  },
  headerActionPressed: {
    transform: [{ translateY: 1.5 }],
    shadowOpacity: 0.14,
    elevation: 1,
  },
  headerActionPrimaryText: {
    color: PALETTE.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.05,
  },
  headerActionSecondaryText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.05,
  },
  headerActionLockedText: {
    color: PALETTE.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.05,
  },
  headerActionLockedSub: {
    color: PALETTE.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
    marginTop: 2,
  },
  card: {
    backgroundColor: PALETTE.cardSurface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: PALETTE.cardBorder,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 7,
  },
  matchesCardShell: {
    padding: S.xs,
    marginTop: S.xs,
  },
  leaderboardCard: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: PALETTE.cardSurface,
    borderWidth: 1,
    borderColor: PALETTE.cardBorder,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: PALETTE.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  cardHint: {
    color: PALETTE.textSecondary,
    fontSize: 12,
  },
  matchesTitle: {
    fontSize: 17,
  },
  matchesList: {
    gap: 4,
  },
  matchCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: PALETTE.cardSurface,
    borderWidth: 1,
    borderColor: PALETTE.cardBorder,
    overflow: 'hidden',
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  teamColLeft: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamColRight: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLogo: {
    width: 48,
    height: 48,
  },
  centerCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  matchCardSkeleton: {
    justifyContent: 'center',
    gap: 10,
  },
  matchTeamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    alignSelf: 'stretch',
    paddingHorizontal: 16,
  },
  teamCode: {
    color: PALETTE.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },
  matchVs: {
    color: PALETTE.textTertiary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  matchTime: {
    marginTop: 10,
    fontSize: 21,
    fontWeight: '800',
    color: PALETTE.primaryBlue,
    textAlign: 'center',
  },
  matchDate: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.textSecondary,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rulesToggle: {
    gap: 10,
    backgroundColor: COLORS.accent,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  rulesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rulesBody: {
    gap: 12,
  },
  rulesPoints: {
    gap: 4,
    marginTop: 4,
  },
  rulesSection: {
    gap: 6,
  },
  rulesSectionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  rulesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  rulesRowLabel: {
    color: COLORS.muted,
    fontSize: 13,
    flex: 1,
  },
  rulesRowValue: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  watermark: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
    height: 48,
    width: 220,
    opacity: 0.2,
    resizeMode: 'contain',
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 13,
  },
  errorText: {
    color: COLORS.accent2,
    fontSize: 12,
  },
  debugText: {
    color: COLORS.muted,
    fontSize: 11,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 8,
    backgroundColor: COLORS.card,
  },
  list: {
    gap: 6,
  },
  listItem: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: PALETTE.cardBorder,
  },
  leaderboardNameBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  leaderboardBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: PALETTE.accentRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardBadgeText: {
    color: PALETTE.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  leaderboardName: {
    color: PALETTE.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  leaderboardPoints: {
    color: PALETTE.pointsOffWhite,
    fontSize: 15,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: 'rgba(20,24,35,0.96)',
    padding: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '96%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
});
function getShortCode(code: string | null) {
  const map: Record<string, string> = {
    BAUSKA: 'BAU',
    FBK_VALMIERA: 'VAL',
    RUBENE: 'RUB',
    FKI: 'IRL',
    KEKAVARBB: 'KEK',
    LEKRINGS: 'LEK',
    LIELVARDEUNIHOC: 'LVD',
    MASTERS_ULBROKALU: 'ULB',
    FBK_SAC: 'SAC',
    TALSU_NSSKRAUZERS: 'TAL',
  };
  if (!code) return 'TEAM';
  return map[code] || code.slice(0, 3).toUpperCase();
}
