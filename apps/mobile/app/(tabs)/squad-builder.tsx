import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  TextInput,
  Modal,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  GestureResponderEvent,
  useWindowDimensions,
  Animated,
  Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useSquad, SquadSlotKey } from '../../src/hooks/useSquad';
import { AppBackground } from '../../src/components/AppBackground';
import { SEASON_BUDGET_CREDITS } from '../../src/constants/fantasyRules';
import type { Player } from '../../src/types/Player';
import { formatTeamCode } from '../../src/utils/fantasy';
import { fetchLockedPlayersToday, isOfflineError } from '../../src/lib/supabaseRest';
import { diagLog } from '../../src/lib/diagnostics';
import { COLORS } from '../../src/theme/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { SquadShirtSlot } from '../../src/components/SquadShirtSlot';

type SlotGroup = 'U' | 'A' | 'V' | 'FLEX';

const SLOT_ORDER: SquadSlotKey[] = ['U1', 'U2', 'U3', 'U4', 'A1', 'A2', 'V1', 'F1'];
const SLOT_POS: Record<SquadSlotKey, SlotGroup> = {
  U1: 'U',
  U2: 'U',
  U3: 'U',
  U4: 'U',
  A1: 'A',
  A2: 'A',
  V1: 'V',
  F1: 'FLEX',
};

// Explicit row order for 3–2–2–1 layout
  const formationRows: SquadSlotKey[][] = [
    ['U1', 'U2', 'U3'],
    ['U4', 'F1'],
    ['A1', 'A2'],
    ['V1'],
  ];

type Props = {
  showClose?: boolean;
};

const positionToGroup = (pos?: string | null): SlotGroup => {
  if (!pos) return 'U';
  const normalized = pos.toUpperCase();
  if (normalized === 'U') return 'U';
  if (normalized === 'A') return 'A';
  if (normalized === 'D') return 'A';
  if (normalized === 'V' || normalized === 'G') return 'V';
  return 'U';
};

export default function SquadBuilder({ showClose = true }: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const router = useRouter();
  const {
    state,
    savedSnapshot,
    loadSquad,
    updateSlot,
    saveSquad,
    remainingBudget,
    players,
    playersLoading,
    playersError,
    chooseCaptain,
    resetUnsavedChanges,
    pendingTransfersUsed,
    saving,
    loading,
    error,
    selectedPlayers,
  } = useSquad();
  const [pickContext, setPickContext] = useState<{
    slot: SquadSlotKey;
    slotIndex: number;
    allowedPositions: ('U' | 'A' | 'V')[];
    mode: 'swap' | 'initial';
  } | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SquadSlotKey | null>(null);
  const [captainPickerVisible, setCaptainPickerVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(true);
  const [pickerSearch, setPickerSearch] = useState('');
  const [filteredEligible, setFilteredEligible] = useState<Player[]>([]);
  const [lockedPlayers, setLockedPlayers] = useState<Set<string>>(new Set());
  const [lockWarning, setLockWarning] = useState<string | null>(null);
  const [lockErrorShown, setLockErrorShown] = useState(false);
  const lockOfflineNotifiedAt = useRef<number>(0);
  const rootScrollRef = useRef<ScrollView | null>(null);
  const formationAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadSquad();
  }, [loadSquad]);

  useFocusEffect(
    useCallback(() => {
      loadSquad();
    }, [loadSquad])
  );

  useEffect(() => {
    if (!savedSnapshot) return;
    const needsBuild = savedSnapshot.slots.some(s => !s.player_id);
    setIsEditing(needsBuild);
  }, [savedSnapshot]);

  useEffect(() => {
    if (loading) return;
    formationAnim.setValue(0);
    Animated.timing(formationAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [loading, formationAnim]);

  const refreshLocks = useCallback(async () => {
    try {
      const set = await fetchLockedPlayersToday();
      setLockedPlayers(set);
      setLockWarning(null);
      setLockErrorShown(false);
      lockOfflineNotifiedAt.current = 0;
    } catch (err) {
      console.warn('[locks] fetch failed', err);
      if (isOfflineError(err)) {
        const now = Date.now();
        if (now - lockOfflineNotifiedAt.current > 10_000) {
          diagLog('offline_detected', { source: 'refreshLocks' });
          lockOfflineNotifiedAt.current = now;
        }
        setLockWarning(null);
        setLockErrorShown(true);
        return;
      }
      setLockWarning("Couldn't verify locks—try again.");
      if (!lockErrorShown) {
        Alert.alert('Notice', "Couldn't verify locks—try again.");
        setLockErrorShown(true);
      }
    }
  }, [lockErrorShown]);

  useEffect(() => {
    refreshLocks();
  }, [refreshLocks]);

  useFocusEffect(
    useCallback(() => {
      refreshLocks();
    }, [refreshLocks])
  );

  useFocusEffect(
    useCallback(() => {
      rootScrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  const transfersRemainingRaw = useMemo(() => {
    const base = savedSnapshot?.transfersLeft ?? state.transfersLeft;
    return base - pendingTransfersUsed;
  }, [pendingTransfersUsed, savedSnapshot, state.transfersLeft]);
  const transfersRemainingDisplay = Math.max(transfersRemainingRaw, 0);
  const displayTransfers = Math.min(transfersRemainingDisplay ?? 3, 3); // clamp for safety; source of truth is server/default 3
  if (__DEV__) {
    console.log('[squad-ui] transfersRemainingRaw', { value: transfersRemainingRaw, source: 'state/snapshot' });
  }

  const neededText = useMemo(() => {
    const counts = { U: 0, A: 0, V: 0, FLEX: 0 };
    state.slots.forEach(s => {
      if (s.player_id) {
        counts[SLOT_POS[s.slot_key]] += 1;
      }
    });
    const needU = 4 - counts.U;
    const needA = 2 - counts.A;
    const needV = 1 - counts.V;
    const needFlex = 1 - counts.FLEX;
    return {
      U: Math.max(needU, 0),
      A: Math.max(needA, 0),
      V: Math.max(needV, 0),
      F: Math.max(needFlex, 0),
    };
  }, [state.slots]);

  const eligiblePlayers = useMemo(() => {
    if (!pickContext) return [];
    const allowed = pickContext.allowedPositions;
    return players.filter(p => allowed.includes(positionToGroup(p.position)));
  }, [pickContext, players]);

  useEffect(() => {
    if (!pickerVisible) {
      setPickerSearch('');
      setFilteredEligible(eligiblePlayers);
      return;
    }
    setFilteredEligible(eligiblePlayers);
  }, [pickerVisible, eligiblePlayers]);

  useEffect(() => {
    const q = pickerSearch.trim().toLowerCase();
    const timer = setTimeout(() => {
      if (!q) {
        setFilteredEligible(eligiblePlayers);
        return;
      }
      setFilteredEligible(
        eligiblePlayers.filter(p => {
          const name = (p.name || '').toLowerCase();
          const parts = name.split(/\s+/);
          const last = parts[parts.length - 1] || '';
          return name.includes(q) || last.includes(q);
        }),
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [pickerSearch, eligiblePlayers]);

  const orbSize = useMemo(() => {
    // Fit 4 rows without scrolling: derive from both width and available height.
    const widthBased = screenWidth * 0.23;
    const verticalAllowance = Math.max(
      360,
      screenHeight - insets.top - insets.bottom - 340
    ); // leave room for header/buttons
    const perRow = (verticalAllowance - 3 * 12) / 4;
    const heightBased = Math.max(78, perRow);
    const clamped = Math.max(82, Math.min(108, Math.min(widthBased, heightBased)));
    return clamped;
  }, [screenHeight, screenWidth, insets.bottom, insets.top]);

  const handleSelectPlayer = useCallback(
    (playerId: string) => {
      if (!activeSlot || !isEditing) return;
      if (lockedPlayers.has(playerId)) {
        Alert.alert('Locked', 'Locked: this player has a match today.');
        return;
      }
      const alreadyUsedSlot = state.slots.find(s => s.player_id === playerId);
      if (alreadyUsedSlot && alreadyUsedSlot.slot_key !== activeSlot) {
        Alert.alert('Player already selected', 'Choose a different player for this slot.');
        return;
      }
      const prevPlayer = state.slots.find(s => s.slot_key === activeSlot)?.player_id;
      const wouldUseTransfer = Boolean(prevPlayer && prevPlayer !== playerId);
      if (wouldUseTransfer && transfersRemainingRaw <= 0) {
        Alert.alert('No transfers left', 'You have no transfers left to change this player.');
        return;
      }
      updateSlot(activeSlot, playerId);
      setPickerVisible(false);
      setActiveSlot(null);
      setPickContext(null);
    },
    [activeSlot, isEditing, state.slots, transfersRemainingRaw, updateSlot]
  );

  const formatCircleName = (fullName: string | null | undefined) => {
    if (!fullName) return 'Player';
    const tokens = fullName
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean);
    const letterTokens = tokens.filter(t => /[A-Za-zĀ-žÀ-ÖØ-öø-ÿ]/.test(t));
    if (letterTokens.length === 0) return 'Player';
    if (letterTokens.length === 1) return letterTokens[0];
    const first = letterTokens[0];
    const last = letterTokens[letterTokens.length - 1];
    const lastInitial = (last.replace(/[^A-Za-zĀ-žÀ-ÖØ-öø-ÿ]/g, '').charAt(0) || '').toUpperCase();
    return lastInitial ? `${first}.${lastInitial}` : first;
  };

  const renderSlot = (slot: SquadSlotKey, size: number) => {
    const filled = state.slots.find(s => s.slot_key === slot);
    const player =
      filled?.player_id
        ? (state.playerDetails[filled.player_id] as unknown as Player) ?? players.find(p => p.id === filled.player_id) ?? null
        : null;
    const playerPrice =
      typeof player?.price_final === 'number' && !Number.isNaN(player.price_final)
        ? player.price_final
        : typeof player?.price === 'number' && !Number.isNaN(player.price)
        ? player.price
        : null;
    const isCaptain = player?.id && state.captainId === player.id;
    const isLocked = player?.id ? lockedPlayers.has(player.id) : false;
    const teamCode = formatTeamCode(player?.team ?? '');
    const clubCode = teamCode ? teamCode.toUpperCase() : '--';
    const priceText = playerPrice !== null ? playerPrice.toFixed(1) : '--';
    const positionLabel =
      slot === 'F1'
        ? 'FLEX'
        : player?.position?.toUpperCase() ?? SLOT_POS[slot];
    return (
      <SquadShirtSlot
        key={slot}
        size={size}
        name={player?.name ?? 'Player'}
        team={clubCode}
        position={positionLabel}
        price={priceText}
        isCaptain={isCaptain}
        isLocked={isLocked}
        isEmpty={!player}
        onPress={(e: GestureResponderEvent) => {
          e.stopPropagation();
          if (player && !isEditing) {
            router.push({
              pathname: '/player-points/[playerId]',
              params: {
                playerId: player.id,
                name: player.name ?? '',
                position: player.position ?? '',
              },
            });
            return;
          }
          if (!isEditing) return;
          if (isLocked) {
            Alert.alert('Locked', 'Locked: this player has a match today.');
            return;
          }
          if (transfersRemainingRaw <= 0 && filled?.player_id) {
            Alert.alert('No transfers left', 'You have no transfers left to change this player.');
            return;
          }
          const slotIndex = SLOT_ORDER.indexOf(slot);
          const slotPos = SLOT_POS[slot];
          const allowedPositions: ('U' | 'A' | 'V')[] = slotPos === 'FLEX' ? ['U', 'A', 'V'] : [slotPos];
          const hasCompleteSaved = savedSnapshot?.slots.every(s => s.player_id) ?? false;
          const mode: 'swap' | 'initial' = hasCompleteSaved ? 'swap' : 'initial';
          setActiveSlot(slot);
          setPickContext({ slot, slotIndex, allowedPositions, mode });
          setPickerVisible(true);
        }}
      />
    );
  };

  const canSave = useMemo(() => {
    const filledCount = state.slots.filter(s => s.player_id).length;
    const withinBudget = remainingBudget >= 0;
    const isComplete = filledCount === SLOT_ORDER.length;
    const hasTransfers = transfersRemainingRaw >= 0;
    return isEditing && isComplete && withinBudget && hasTransfers;
  }, [isEditing, remainingBudget, state.slots, transfersRemainingRaw]);

  const saveLabel = useMemo(() => {
    const filledCount = state.slots.filter(s => s.player_id).length;
    if (!isEditing) return 'Locked — tap Change players';
    if (filledCount !== SLOT_ORDER.length) return 'Complete squad to save';
    if (remainingBudget < 0) return `Over budget by ${Math.abs(remainingBudget).toFixed(1)}k`;
    if (transfersRemainingRaw < 0) return 'No transfers left';
    return pendingTransfersUsed > 0 ? 'Save changes' : 'Save squad';
  }, [isEditing, pendingTransfersUsed, remainingBudget, state.slots, transfersRemainingRaw]);

  const handleSave = useCallback(async () => {
    if (!isEditing) return;
    if (remainingBudget < 0) {
      Alert.alert(
        'Over budget',
        `Adjust your picks to fit within ${SEASON_BUDGET_CREDITS.toFixed(1)}k credits.`
      );
      return;
    }
    const filledCount = state.slots.filter(s => s.player_id).length;
    if (filledCount !== SLOT_ORDER.length) {
      Alert.alert('Incomplete squad', 'Add players to all slots before saving.');
      return;
    }
    if (transfersRemainingRaw < 0) {
      Alert.alert('No transfers left', 'You do not have enough transfers to save these changes.');
      return;
    }
    const result = await saveSquad();
    if (result?.ok) {
      await loadSquad();
      setIsEditing(false);
      if (result.needsCaptain) {
        Alert.alert('Saved', 'Squad saved. Pick a captain to finalize.');
        setCaptainPickerVisible(true);
      } else {
        Alert.alert('Saved', 'Squad saved.');
      }
    } else if (result?.error) {
      Alert.alert('Save failed', result.error);
    }
  }, [isEditing, loadSquad, remainingBudget, saveSquad, state.slots, transfersRemainingRaw]);

  const handleChangePlayers = useCallback(() => {
    const availableTransfers = savedSnapshot?.transfersLeft ?? state.transfersLeft;
    if (availableTransfers <= 0) {
      Alert.alert('No transfers left', 'You cannot replace players without transfers. Captain can still be updated.');
    }
    if (!isEditing) {
      resetUnsavedChanges();
    }
    setIsEditing(true);
  }, [isEditing, resetUnsavedChanges, savedSnapshot, state.transfersLeft]);

  const handleCancelChanges = useCallback(() => {
    resetUnsavedChanges();
    setIsEditing(false);
    setPickerVisible(false);
  }, [resetUnsavedChanges]);

  const captainOptions = useMemo(() => {
    return selectedPlayers as Player[];
  }, [selectedPlayers]);

  const captainDaysLeft = useMemo(() => {
    if (!state.captainNextChangeAt) return 0;
    const diff = new Date(state.captainNextChangeAt).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return Math.max(0, days);
  }, [state.captainNextChangeAt]);
  const canChangeCaptain = captainDaysLeft === 0;

  const teamTotalPoints = useMemo(() => {
    return state.teamPoints ?? 0;
  }, [state.teamPoints]);

  return (
    <AppBackground variant="home">
      <ScrollView
        ref={rootScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.screen,
          {
            paddingTop: insets.top + 6,
            paddingBottom: Math.max(28, insets.bottom + 16),
          },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled
        bounces
        decelerationRate="normal"
        scrollEventThrottle={16}
      >
        <View style={styles.topRow}>
          <Text style={styles.title}>Choose your team</Text>
          {showClose && (
            <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
              <Text style={styles.link}>Close</Text>
            </TouchableOpacity>
          )}
        </View>

        {lockWarning ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{lockWarning}</Text>
            <TouchableOpacity onPress={refreshLocks}>
              <Text style={styles.bannerLink}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Loading squad…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.loading}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable style={styles.fieldCard} onPress={() => router.push('/my-points')}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(46,56,78,0.78)', 'rgba(18,24,38,0.8)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFillObject, styles.fieldGradient]}
          />
          <SquadBackdrop />
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldTitle}>Squad</Text>
            <View style={styles.pointsWrap}>
              <Text style={styles.pointsLabel}>Points</Text>
              <Text style={styles.pointsValue}>{teamTotalPoints ?? 0}</Text>
            </View>
        </View>

        <Animated.View
          style={[
            styles.formationGrid,
            {
              opacity: formationAnim,
              transform: [
                {
                  translateY: formationAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [4, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {formationRows.map((row, idx) => (
            <View
              key={`row-${idx}`}
              style={
                idx === 0
                  ? styles.rowTriple
                  : idx === 1
                  ? styles.rowDouble
                  : idx === 2
                  ? styles.rowSplit
                  : styles.rowSingle
              }
            >
              {row.map(key => renderSlot(key, orbSize))}
            </View>
          ))}
        </Animated.View>
        </Pressable>

    <View style={styles.actionRow}>
      <TouchableOpacity style={[styles.primaryButton, styles.actionButton]} onPress={handleChangePlayers} activeOpacity={0.88}>
        <Text style={styles.primaryText}>Change players</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.captainButton,
          styles.actionButton,
          !captainOptions.length && styles.secondaryDisabled,
        ]}
        disabled={!captainOptions.length}
        onPress={() => {
          if (!captainOptions.length) {
            Alert.alert('No players selected', 'Add players before choosing a captain.');
            return;
          }
          if (!canChangeCaptain) {
            Alert.alert('Captain change', `You can change your captain in ${captainDaysLeft} day${captainDaysLeft === 1 ? '' : 's'}.`);
            return;
          }
          setCaptainPickerVisible(true);
        }}
        activeOpacity={0.82}
      >
        <Text style={styles.primaryText}>Choose captain</Text>
      </TouchableOpacity>
    </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Budget remaining</Text>
            <Text style={styles.infoValue}>
              {remainingBudget.toFixed(1)}k{' '}
              <Text style={styles.infoMuted}>/ {SEASON_BUDGET_CREDITS.toFixed(1)}k</Text>
            </Text>
          </View>
          <View style={styles.needBlock}>
            <Text style={styles.infoLabel}>Need</Text>
            <View style={styles.needChips}>
              {(['U', 'A', 'V', 'F'] as const).map(key => {
                const value = neededText[key];
                const active = value > 0;
                return (
                  <View
                    key={key}
                    style={[
                      styles.needChip,
                      active && styles.needChipActive,
                    ]}
                  >
                    <Text style={[styles.needChipText, active && styles.needChipTextActive]}>
                      {key} {value}
                    </Text>
                  </View>
                );
              })}
            </View>
            {neededText.U === 0 && neededText.A === 0 && neededText.V === 0 && neededText.F === 0 ? (
              <Text style={styles.needHelper}>All positions filled</Text>
            ) : null}
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Transfers left</Text>
            <Text style={styles.infoValue}>
              {displayTransfers}
              {pendingTransfersUsed > 0 ? (
                <Text style={styles.infoMuted}> (using {pendingTransfersUsed})</Text>
              ) : null}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, (!canSave || !isEditing || saving) && styles.saveButtonDisabled]}
          disabled={!canSave || !isEditing || saving}
          onPress={handleSave}
        >
          <Text style={styles.saveText}>{saveLabel}</Text>
        </TouchableOpacity>

        {isEditing ? (
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancelChanges}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}

        <Modal
          visible={pickerVisible}
          animationType="slide"
          transparent
          onRequestClose={() => {
            setPickerVisible(false);
            setActiveSlot(null);
            setPickContext(null);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Pick player</Text>
                <TouchableOpacity
                  onPress={() => {
                    setPickerVisible(false);
                    setActiveSlot(null);
                    setPickContext(null);
                  }}
                  hitSlop={10}
                >
                  <Text style={styles.link}>Close</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.searchRow}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  placeholder="Search players…"
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  style={styles.searchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                  selectionColor="rgba(255,255,255,0.7)"
                />
              </View>
              <FlatList
                data={filteredEligible}
                keyExtractor={item => item.id}
                renderItem={({ item }) => {
                  const isLocked = lockedPlayers.has(item.id);
                  return (
                    <TouchableOpacity
                      style={[styles.playerRow, isLocked && styles.playerRowLocked]}
                      onPress={() => handleSelectPlayer(item.id)}
                      disabled={isLocked}
                    >
                      <View>
                        <Text style={styles.playerName}>{item.name}</Text>
                        <Text style={styles.playerMeta}>
                          {item.team} · {item.position} ·{' '}
                          {((item.price_final ?? item.price)?.toFixed(1) ?? '--') + 'k'}
                        </Text>
                        {isLocked ? <Text style={styles.lockedLabel}>Locked today</Text> : null}
                      </View>
                      <Text style={styles.playerPrice}>
                        {((item.price_final ?? item.price)?.toFixed(1) ?? '--') + 'k'}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 16 }}
              />
            </View>
          </View>
        </Modal>

        <Modal
          visible={captainPickerVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setCaptainPickerVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Choose captain</Text>
                <TouchableOpacity onPress={() => setCaptainPickerVisible(false)} hitSlop={10}>
                  <Text style={styles.link}>Close</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={captainOptions}
                keyExtractor={item => item.id}
                renderItem={({ item }) => {
                  const isLocked = lockedPlayers.has(item.id);
                  return (
                    <TouchableOpacity
                      style={[styles.playerRow, isLocked && styles.playerRowLocked]}
                      disabled={isLocked}
                      onPress={() => {
                        if (isLocked) {
                          Alert.alert('Locked', 'Locked: this player has a match today.');
                          return;
                        }
                        chooseCaptain(item.id).then(result => {
                          if (!result?.ok && result?.error) {
                            Alert.alert('Captain change blocked', result.error);
                          }
                          if (result?.ok) {
                            setCaptainPickerVisible(false);
                            loadSquad();
                          }
                        });
                      }}
                    >
                      <View>
                        <Text style={styles.playerName}>{item.name}</Text>
                        <Text style={styles.playerMeta}>
                          {item.team} · {item.position}
                        </Text>
                        {isLocked ? <Text style={styles.lockedLabel}>Locked today</Text> : null}
                      </View>
                      <Text style={styles.playerPrice}>
                        {((item.price_final ?? item.price)?.toFixed(1) ?? '--') + 'k'}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                contentContainerStyle={{ paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
              />
            </View>
          </View>
        </Modal>
      </ScrollView>
    </AppBackground>
  );
}

const SquadBackdrop = () => (
  <BlurView intensity={12} tint="dark" style={styles.canvasBlur} pointerEvents="none">
    <View style={styles.canvas} pointerEvents="none">
      <View style={styles.canvasTopArcGlow} />
      <View style={styles.canvasTopArc} />
      <View style={styles.canvasCenterLine} />
      <View style={styles.canvasBottomBox}>
        <View style={styles.canvasGoal} />
      </View>
      <View style={[styles.canvasCorner, styles.canvasCornerLeft]}>
        <View style={styles.canvasCornerH} />
        <View style={styles.canvasCornerV} />
      </View>
      <View style={[styles.canvasCorner, styles.canvasCornerRight]}>
        <View style={styles.canvasCornerH} />
        <View style={styles.canvasCornerV} />
      </View>
    </View>
  </BlurView>
);

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    padding: 12,
    gap: 12,
  },
  slotWrap: {
    alignItems: 'center',
    gap: 10,
  },
  slotWrapAbs: {
    position: 'absolute',
    alignItems: 'center',
  },
  loading: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: '#F87171',
    fontSize: 14,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  primaryButton: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.latvianMaroon,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  secondaryText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryDisabled: {
    opacity: 0.55,
  },
  actionButton: {
    flex: 1,
  },
  captainButton: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.latvianMaroon,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  captainHelper: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
  },
  bannerText: {
    color: '#e5e7eb',
    flex: 1,
    marginRight: 8,
  },
  bannerLink: {
    color: '#93c5fd',
    fontWeight: '700',
  },
  link: {
    color: '#93C5FD',
    fontSize: 14,
    fontWeight: '700',
  },
  fieldCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(12,16,26,0.7)',
    padding: 14,
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    overflow: 'hidden',
    paddingBottom: 14,
    position: 'relative',
  },
  fieldGradient: {
    opacity: 0.94,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  fieldTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
  },
  fieldSub: {
    color: 'rgba(226,232,240,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  pointsWrap: {
    alignItems: 'flex-end',
    gap: 2,
  },
  pointsLabel: {
    color: 'rgba(226,232,240,0.55)',
    fontSize: 10.5,
    fontWeight: '600',
  },
  pointsValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    textShadowColor: 'rgba(0, 255, 255, 0.38)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  formationGrid: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    gap: 14,
  },
  canvasBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  canvas: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasTopArc: {
    position: 'absolute',
    top: -140,
    width: 320,
    height: 320,
    borderRadius: 160,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    opacity: 0.6,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    zIndex: -1,
  },
  canvasTopArcGlow: {
    position: 'absolute',
    top: -140,
    width: 320,
    height: 320,
    borderRadius: 160,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    opacity: 0.6,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    zIndex: -1,
  },
  canvasCenterLine: {
    position: 'absolute',
    top: 50,
    left: '4%',
    right: '4%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    opacity: 0.7,
    shadowColor: '#ffffff',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  canvasBottomBox: {
    position: 'absolute',
    bottom: 18,
    width: 230,
    height: 120,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    opacity: 0.7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 16,
    shadowColor: '#ffffff',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  canvasGoal: {
    width: 140,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    opacity: 0.7,
    borderRadius: 2,
    shadowColor: '#ffffff',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  canvasCorner: {
    position: 'absolute',
    bottom: 18,
  },
  canvasCornerLeft: {
    left: 16,
  },
  canvasCornerRight: {
    right: 16,
  },
  canvasCornerH: {
    width: 14,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    opacity: 0.7,
    shadowColor: '#ffffff',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  canvasCornerV: {
    position: 'absolute',
    left: 6,
    top: -6,
    width: 2,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    opacity: 0.7,
    shadowColor: '#ffffff',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  rowTriple: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '90%',
    alignSelf: 'center',
  },
  rowDouble: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '72%',
    alignSelf: 'center',
  },
  rowSplit: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '84%',
    alignSelf: 'center',
  },
  rowSingle: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginTop: 10,
  },
  infoCard: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    color: 'rgba(226,232,240,0.78)',
    fontSize: 13,
    fontWeight: '600',
  },
  infoValue: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
  },
  infoMuted: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12.5,
    fontWeight: '600',
  },
  needBlock: {
    gap: 8,
  },
  needChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  needChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  needChipActive: {
    borderColor: 'rgba(255,255,255,0.26)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  needChipText: {
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '700',
    fontSize: 12.5,
  },
  needChipTextActive: {
    color: '#F8FAFC',
  },
  needHelper: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: -2,
  },
  saveButton: {
    marginTop: 8,
    backgroundColor: COLORS.latvianMaroon,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  saveButtonDisabled: {
    opacity: 0.35,
  },
  saveText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  cancelButton: {
    marginTop: 10,
    alignItems: 'center',
  },
  cancelText: {
    color: '#cbd5e1',
    fontWeight: '700',
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
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
    gap: 8,
  },
  searchIcon: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  playerName: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  playerMeta: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  lockedLabel: {
    marginTop: 4,
    color: '#f97316',
    fontSize: 12,
    fontWeight: '600',
  },
  playerRowLocked: {
    opacity: 0.55,
  },
  playerPrice: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '800',
  },
});
