import React, { useEffect, useRef, useState } from 'react';
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { matches, loading: matchesLoading, error: matchesError } = useUpcomingMatches();
  const { width } = useWindowDimensions();
  const CARD_WIDTH = Math.min(340, width - 64);
  const EDGE = Math.max(0, (width - CARD_WIDTH) / 2);
  const ITEM_SPACING = 14;
  const SNAP = CARD_WIDTH + ITEM_SPACING;
  const { rows: leaderboardRows, loading: leaderboardLoading, error: leaderboardError } = useLeaderboard(50);
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'MISSING';
  const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseAnonStatus = supabaseAnon ? 'OK' : 'MISSING';

  const [showRules, setShowRules] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const watermarkAnim = useRef(new Animated.Value(0)).current;
  const contentHeightRef = useRef(0);
  const viewHeightRef = useRef(0);

  useEffect(() => {
    console.log('[home] mounted');
  }, []);

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
        <View style={[styles.header, { paddingTop: insets.top + S.xs }]}>
          <Image source={{ uri: LOGO_URL }} style={styles.headerLogo} />
          <View style={styles.headerButtonRow}>
            <Pressable
            style={({ pressed }) => [
              styles.headerActionButton,
              styles.headerActionPrimary,
              styles.headerAction3d,
              pressed && styles.headerActionPressed,
            ]}
              onPress={() => router.push('/squad')}
              android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: false }}
            >
              <Text style={styles.headerActionPrimaryText}>Build Team</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.headerActionButton,
                styles.headerActionSecondary,
                styles.headerAction3d,
                pressed && styles.headerActionPressed,
              ]}
              onPress={() => router.push('/draft')}
              android_ripple={{ color: 'rgba(255,255,255,0.08)', borderless: false }}
            >
              <Text style={styles.headerActionSecondaryText}>Draft mode</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
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
          <View style={[styles.card, styles.matchesCardShell]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, styles.matchesTitle]}>Upcoming matches</Text>
              <TouchableOpacity activeOpacity={0.6} onPress={() => router.push('/fixtures')}>
                <Text style={styles.cardHint}>See all</Text>
              </TouchableOpacity>
            </View>

          {matchesLoading ? (
            <FlatList
              data={Array.from({ length: 3 })}
              keyExtractor={(_, idx) => `skeleton-${idx}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.matchesList,
                { paddingHorizontal: EDGE, alignItems: 'center' },
              ]}
              ItemSeparatorComponent={() => <View style={{ width: ITEM_SPACING }} />}
              snapToInterval={SNAP}
              decelerationRate="fast"
              snapToAlignment="start"
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
                { paddingHorizontal: EDGE, alignItems: 'center' },
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

          {__DEV__ && (
            <Text
              style={matchesError ? styles.errorText : styles.debugText}
              numberOfLines={2}
              selectable
            >
              {matchesLoading
                ? 'loading…'
                : matchesError
                ? `error=${matchesError}`
                : `matches=${matches.length}`}
            </Text>
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
                    {formatPoints(row.total_points)} pts
                  </Text>
                </Pressable>
              ))
            )}
          </View>
          {__DEV__ && (
            <>
              <Text
                style={leaderboardError ? styles.errorText : styles.debugText}
                numberOfLines={2}
                selectable
              >
                {leaderboardLoading
                  ? 'loading…'
                  : leaderboardError
                  ? `error=${leaderboardError}`
                  : `leaderboard=${leaderboardRows.length}`}
              </Text>
              <Text style={styles.debugText} numberOfLines={2} selectable>
                supabaseUrl={supabaseUrl || 'MISSING'} | anonKey={supabaseAnonStatus}
              </Text>
            </>
          )}
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
        onRequestClose={() => setShowLeaderboardModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.cardTitle}>Leaderboard</Text>
              <Pressable onPress={() => setShowLeaderboardModal(false)} hitSlop={10}>
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
                      {formatPoints(row.total_points)} pts
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
    paddingVertical: S.sm,
    paddingHorizontal: S.md,
    paddingBottom: 140,
    gap: S.sm,
  },
  header: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingBottom: S.xs,
    marginBottom: 2,
    gap: S.xs,
  },
  headerLogo: {
    width: '100%',
    height: 150,
    resizeMode: 'contain',
    alignSelf: 'center',
    marginBottom: S.xs,
  },
  headerButtonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: S.md,
    marginTop: 6,
    marginBottom: 6,
  },
  headerActionButton: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionPrimary: {
    backgroundColor: COLORS.accent,
  },
  headerActionSecondary: {
    backgroundColor: COLORS.accent,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  headerAction3d: {
    shadowColor: COLORS.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 94, 0.35)',
  },
  headerActionPressed: {
    transform: [{ translateY: 1.5 }],
    shadowOpacity: 0.14,
    elevation: 1,
  },
  headerActionPrimaryText: {
    color: '#ffffff',
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
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  matchesCardShell: {
    padding: S.xs,
    marginTop: S.xs,
  },
  leaderboardCard: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardHint: {
    color: COLORS.muted,
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    color: 'white',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },
  matchVs: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  matchTime: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: '800',
    color: 'rgba(120,200,255,1)',
    textAlign: 'center',
  },
  matchDate: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.65)',
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
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: COLORS.card2,
  },
  leaderboardNameBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  leaderboardBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  leaderboardName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  leaderboardPoints: {
    color: '#ffffff',
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
