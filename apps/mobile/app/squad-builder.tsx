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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSquad, SquadSlotKey } from '../src/hooks/useSquad';
import { AppBackground } from '../src/components/AppBackground';
import { SEASON_BUDGET_CREDITS } from '../src/constants/fantasyRules';

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
  const router = useRouter();
  const { state, loadSquad, updateSlot, saveSquad, remainingBudget, players } = useSquad();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SquadSlotKey | null>(null);

  useEffect(() => {
    loadSquad();
  }, [loadSquad]);

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
      if (!activeSlot) return;
      const prevPlayer = state.slots.find(s => s.slot_key === activeSlot)?.player_id;
      const useTransfer = Boolean(prevPlayer && prevPlayer !== playerId);
      updateSlot(activeSlot, playerId, useTransfer);
      setPickerVisible(false);
      setActiveSlot(null);
    },
    [activeSlot, state.slots, updateSlot]
  );

  const renderSlot = (slot: SquadSlotKey) => {
    const filled = state.slots.find(s => s.slot_key === slot);
    const player = filled?.player_id ? players.find(p => p.id === filled.player_id) : null;
    const playerPrice =
      typeof player?.price_final === 'number' && !Number.isNaN(player.price_final)
        ? player.price_final
        : typeof player?.price === 'number' && !Number.isNaN(player.price)
        ? player.price
        : null;
    return (
      <Pressable
        key={slot}
        style={[styles.slot, player ? styles.slotFilled : styles.slotEmpty]}
        onPress={() => {
          setActiveSlot(slot);
          setPickerVisible(true);
        }}
      >
        <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
        {player ? (
          <>
            <Text style={styles.slotPlayerName} numberOfLines={1}>
              {player.name}
            </Text>
            <Text style={styles.slotPlayerMeta} numberOfLines={1}>
              {player.team} · {playerPrice !== null ? playerPrice.toFixed(1) : '--'}
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
    return isComplete && withinBudget;
  }, [state.slots, remainingBudget]);

  const saveLabel = useMemo(() => {
    const filledCount = state.slots.filter(s => s.player_id).length;
    if (filledCount !== SLOT_ORDER.length) return 'Complete squad to save';
    if (remainingBudget < 0) return `Over budget by ${Math.abs(remainingBudget).toFixed(1)}`;
    return 'Save squad';
  }, [remainingBudget, state.slots]);

  return (
    <AppBackground variant="home">
      <View style={styles.screen}>
        <View style={styles.topRow}>
          <Text style={styles.title}>Choose your team</Text>
          {showClose && (
            <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
              <Text style={styles.link}>Close</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.fieldCard}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldTitle}>Squad</Text>
            <Text style={styles.fieldSub}>U x4 · A x2 · V x1 · F x1</Text>
          </View>

          <View style={styles.fieldGrid}>
            <View style={styles.rowFour}>{SLOT_ORDER.slice(0, 4).map(renderSlot)}</View>
            <View style={styles.rowTwo}>{SLOT_ORDER.slice(4, 6).map(renderSlot)}</View>
            <View style={styles.rowGoalFlex}>
              {renderSlot('V1')}
              {renderSlot('F1')}
            </View>
          </View>
        </View>

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
            <Text style={styles.infoValue}>{state.transfersLeft}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          disabled={!canSave}
          onPress={() => {
            if (remainingBudget < 0) {
              Alert.alert(
                'Over budget',
                `Adjust your picks to fit within ${SEASON_BUDGET_CREDITS.toFixed(1)} credits.`
              );
              return;
            }
            saveSquad();
            Alert.alert('Saved', 'Squad saved.');
          }}
        >
          <Text style={styles.saveText}>{saveLabel}</Text>
        </TouchableOpacity>

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
                        {item.team} · {item.position} · {item.price?.toFixed(1) ?? '--'}
                      </Text>
                    </View>
                    <Text style={styles.playerPrice}>{item.price?.toFixed(1) ?? '--'}</Text>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 16 }}
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
  slotPlus: {
    color: '#e2e8f0',
    fontSize: 30,
    fontWeight: '800',
    marginTop: 8,
  },
  slotPlayerName: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },
  slotPlayerMeta: {
    color: '#cbd5e1',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
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
