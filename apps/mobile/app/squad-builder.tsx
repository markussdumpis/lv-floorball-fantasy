import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Modal,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  GestureResponderEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSquad, SquadSlotKey } from '../src/hooks/useSquad';
import { AppBackground } from '../src/components/AppBackground';
import { SEASON_BUDGET_CREDITS } from '../src/constants/fantasyRules';
import type { Player } from '../src/types/Player';
import { formatPlayerShortName, formatTeamCode } from '../src/utils/fantasy';

type SlotGroup = 'U' | 'A' | 'V' | 'FLEX';

const SLOT_ORDER: SquadSlotKey[] = ['U1', 'U2', 'U3', 'U4', 'A1', 'A2', 'V1', 'F1'];
const SLOT_LABELS: Record<SquadSlotKey, string> = {
  U1: 'U',
  U2: 'U',
  U3: 'U',
  U4: 'U',
  A1: 'A',
  A2: 'A',
  V1: 'V',
  F1: 'F',
};
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
  const router = useRouter();
  const {
    state,
    savedSnapshot,
    loadSquad,
    updateSlot,
    saveSquad,
    remainingBudget,
    players,
    chooseCaptain,
    resetUnsavedChanges,
    pendingTransfersUsed,
    saving,
    loading,
    error,
    selectedPlayers,
  } = useSquad();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SquadSlotKey | null>(null);
  const [captainPickerVisible, setCaptainPickerVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(true);

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

  const transfersRemainingRaw = useMemo(() => {
    const base = savedSnapshot?.transfersLeft ?? state.transfersLeft;
    return base - pendingTransfersUsed;
  }, [pendingTransfersUsed, savedSnapshot, state.transfersLeft]);
  const transfersRemainingDisplay = Math.max(transfersRemainingRaw, 0);

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
    return `Need: U x${Math.max(needU, 0)}, A x${Math.max(needA, 0)}, V x${Math.max(needV, 0)}, F x${Math.max(needFlex, 0)}`;
  }, [state.slots]);

  const eligiblePlayers = useMemo(() => {
    if (!activeSlot) return [];
    const pos = SLOT_POS[activeSlot];
    return players.filter(p => {
      if (pos === 'FLEX') return true;
      return positionToGroup(p.position) === pos;
    });
  }, [activeSlot, players]);

  const handleSelectPlayer = useCallback(
    (playerId: string) => {
      if (!activeSlot || !isEditing) return;
      const prevPlayer = state.slots.find(s => s.slot_key === activeSlot)?.player_id;
      const wouldUseTransfer = Boolean(prevPlayer && prevPlayer !== playerId);
      if (wouldUseTransfer && transfersRemainingRaw <= 0) {
        Alert.alert('No transfers left', 'You have no transfers left to change this player.');
        return;
      }
      updateSlot(activeSlot, playerId);
      setPickerVisible(false);
      setActiveSlot(null);
    },
    [activeSlot, isEditing, state.slots, transfersRemainingRaw, updateSlot]
  );

  const renderSlot = (slot: SquadSlotKey) => {
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
    const teamCode = formatTeamCode(player?.team ?? '');
    const shortName = formatPlayerShortName(player?.name);
    return (
      <Pressable
        key={slot}
        style={[styles.slot, player ? styles.slotFilled : styles.slotEmpty]}
        onPress={(e: GestureResponderEvent) => {
          e.stopPropagation();
          if (!isEditing) return;
          if (transfersRemainingRaw <= 0 && filled?.player_id) {
            Alert.alert('No transfers left', 'You have no transfers left to change this player.');
            return;
          }
          setActiveSlot(slot);
          setPickerVisible(true);
        }}
      >
        <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
        {isCaptain ? (
          <View style={styles.captainBadge}>
            <Text style={styles.captainBadgeText}>C</Text>
          </View>
        ) : null}
        {player ? (
          <>
            <Text style={styles.slotTeamCode} numberOfLines={1}>
              {teamCode}
            </Text>
            <Text
              style={styles.slotPlayerName}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {shortName}
            </Text>
            <Text style={styles.slotPlayerMeta} numberOfLines={1}>
              {playerPrice !== null ? playerPrice.toFixed(1) : '--'}
            </Text>
          </>
        ) : (
          <Text style={styles.slotPlus}>+</Text>
        )}
      </Pressable>
    );
  };

  const canSave = useMemo(() => {
    const filledCount = state.slots.filter(s => s.player_id).length;
    const withinBudget = remainingBudget >= 0;
    const isComplete = filledCount === SLOT_ORDER.length;
    const hasCaptain = Boolean(state.captainId);
    const hasTransfers = transfersRemainingRaw >= 0;
    return isEditing && isComplete && withinBudget && hasCaptain && hasTransfers;
  }, [isEditing, remainingBudget, state.captainId, state.slots, transfersRemainingRaw]);

  const saveLabel = useMemo(() => {
    const filledCount = state.slots.filter(s => s.player_id).length;
    if (!isEditing) return 'Locked — tap Change players';
    if (filledCount !== SLOT_ORDER.length || !state.captainId) return 'Complete squad to save';
    if (remainingBudget < 0) return `Over budget by ${Math.abs(remainingBudget).toFixed(1)}`;
    if (transfersRemainingRaw < 0) return 'No transfers left';
    return pendingTransfersUsed > 0 ? 'Save changes' : 'Save squad';
  }, [isEditing, pendingTransfersUsed, remainingBudget, state.captainId, state.slots, transfersRemainingRaw]);

  const handleSave = useCallback(async () => {
    if (!isEditing) return;
    if (remainingBudget < 0) {
      Alert.alert(
        'Over budget',
        `Adjust your picks to fit within ${SEASON_BUDGET_CREDITS.toFixed(1)} credits.`
      );
      return;
    }
    const filledCount = state.slots.filter(s => s.player_id).length;
    if (filledCount !== SLOT_ORDER.length) {
      Alert.alert('Incomplete squad', 'Add players to all slots before saving.');
      return;
    }
    if (!state.captainId) {
      Alert.alert('Choose a captain', 'Select a captain before saving.');
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
      Alert.alert('Saved', 'Squad saved.');
    } else if (result?.error) {
      Alert.alert('Save failed', result.error);
    }
  }, [isEditing, loadSquad, remainingBudget, saveSquad, state.captainId, state.slots, transfersRemainingRaw]);

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

  const teamTotalPoints = useMemo(() => {
    return state.teamPoints ?? 0;
  }, [state.teamPoints]);

  return (
    <AppBackground variant="home">
      <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
        <View style={styles.topRow}>
          <Text style={styles.title}>Choose your team</Text>
          {showClose && (
            <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
              <Text style={styles.link}>Close</Text>
            </TouchableOpacity>
          )}
        </View>

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

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleChangePlayers}>
            <Text style={styles.secondaryText}>Change players</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              styles.secondaryButtonAlt,
              (!isEditing || !captainOptions.length) && { opacity: 0.5 },
            ]}
            disabled={!isEditing || !captainOptions.length}
            onPress={() => {
              if (!isEditing) {
                Alert.alert('Locked', 'Tap Change players to edit your squad first.');
                return;
              }
              if (!captainOptions.length) {
                Alert.alert('No players selected', 'Add players before choosing a captain.');
                return;
              }
              setCaptainPickerVisible(true);
            }}
          >
            <Text style={styles.secondaryText}>Choose captain</Text>
          </TouchableOpacity>
        </View>

        <Pressable style={styles.fieldCard} onPress={() => router.push('/my-points')}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldTitle}>Squad</Text>
            <View style={styles.pointsWrap}>
              <Text style={styles.pointsLabel}>Points</Text>
              <Text style={styles.pointsValue}>{teamTotalPoints ?? 0}</Text>
            </View>
          </View>

          <View style={styles.fieldGrid}>
            <View style={styles.rowFour}>{SLOT_ORDER.slice(0, 4).map(renderSlot)}</View>
            <View style={styles.rowTwo}>{SLOT_ORDER.slice(4, 6).map(renderSlot)}</View>
            <View style={styles.rowGoalFlex}>
              {renderSlot('V1')}
              {renderSlot('F1')}
            </View>
          </View>
        </Pressable>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Budget remaining</Text>
            <Text style={styles.infoValue}>
              {remainingBudget.toFixed(1)}{' '}
              <Text style={styles.infoMuted}>/ {SEASON_BUDGET_CREDITS.toFixed(1)}</Text>
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Need</Text>
            <Text style={styles.infoValue}>{neededText}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Transfers left</Text>
            <Text style={styles.infoValue}>
              {transfersRemainingDisplay}
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
          onRequestClose={() => setPickerVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Pick player</Text>
                <TouchableOpacity onPress={() => setPickerVisible(false)} hitSlop={10}>
                  <Text style={styles.link}>Close</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={eligiblePlayers}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.playerRow} onPress={() => handleSelectPlayer(item.id)}>
                    <View>
                      <Text style={styles.playerName}>{item.name}</Text>
                      <Text style={styles.playerMeta}>
                        {item.team} · {item.position} ·{' '}
                        {(item.price_final ?? item.price)?.toFixed(1) ?? '--'}
                      </Text>
                    </View>
                    <Text style={styles.playerPrice}>
                      {(item.price_final ?? item.price)?.toFixed(1) ?? '--'}
                    </Text>
                  </TouchableOpacity>
                )}
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
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.playerRow}
                    onPress={() => {
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
                    </View>
                    <Text style={styles.playerPrice}>
                      {(item.price_final ?? item.price)?.toFixed(1) ?? '--'}
                    </Text>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                contentContainerStyle={{ paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
              />
            </View>
          </View>
        </Modal>
      </View>
    </AppBackground>
  );
}

const slotBase = {
  width: 72,
  height: 72,
  borderRadius: 36,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  paddingHorizontal: 6,
  paddingVertical: 6,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    gap: 14,
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
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  secondaryButtonAlt: {
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
  secondaryText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
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
  link: {
    color: '#93C5FD',
    fontSize: 14,
    fontWeight: '700',
  },
  fieldCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
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
    color: 'rgba(226,232,240,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  pointsValue: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  fieldGrid: {
    gap: 14,
    alignItems: 'center',
  },
  rowFour: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  rowTwo: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
  },
  rowGoalFlex: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
  },
  slot: {
    ...slotBase,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    position: 'relative',
  },
  slotEmpty: {
    borderStyle: 'dashed',
  },
  slotFilled: {},
  slotLabel: {
    position: 'absolute',
    top: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  captainBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  captainBadgeText: {
    color: '#0f172a',
    fontSize: 10,
    fontWeight: '800',
  },
  slotTeamCode: {
    color: '#F8FAFC',
    fontSize: 19,
    fontWeight: '800',
    marginTop: 16,
  },
  slotPlus: {
    color: '#e2e8f0',
    fontSize: 30,
    fontWeight: '800',
    marginTop: 8,
  },
  slotPlayerName: {
    color: 'rgba(248,250,252,0.9)',
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 70,
  },
  slotPlayerMeta: {
    color: '#cbd5e1',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
  infoCard: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    color: 'rgba(226,232,240,0.82)',
    fontSize: 14,
    fontWeight: '600',
  },
  infoValue: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 15,
  },
  infoMuted: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  saveButton: {
    marginTop: 8,
    backgroundColor: '#EF4444',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#ef4444',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  saveButtonDisabled: {
    opacity: 0.35,
  },
  saveText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
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
  playerPrice: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '800',
  },
});
