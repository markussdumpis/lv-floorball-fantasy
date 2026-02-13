import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../src/providers/AuthProvider';
import { getStoredSession } from '../src/lib/supabaseRest';
import {
  DIAGNOSTICS_ENABLED,
  clearDiagnosticsStorage,
  getLastApiError,
  getLastCoreWrite,
} from '../src/lib/diagnostics';
import { COLORS } from '../src/theme/colors';

type Row = { label: string; value: string };
const QA_STORAGE_KEY = 'qa_controls_enabled';

export default function DiagnosticsScreen() {
  const { user } = useAuth();
  const [qaEnabled, setQaEnabled] = useState(false);
  const { rows, load } = useDiagnosticsData(user?.id, qaEnabled);

  useEffect(() => {
    AsyncStorage.getItem(QA_STORAGE_KEY)
      .then(v => setQaEnabled(v === 'true'))
      .catch(() => setQaEnabled(false));
  }, []);

  useEffect(() => {
    load();
  }, [user?.id, qaEnabled]);

  const handleClear = () => {
    Alert.alert('Clear diagnostics?', 'This will remove last API error and last write info.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearDiagnosticsStorage();
          await load();
        },
      },
    ]);
  };

  const sections = useMemo(() => rows, [rows]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Diagnostics</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>QA controls</Text>
          <Switch
            value={qaEnabled}
            onValueChange={async next => {
              setQaEnabled(next);
              await AsyncStorage.setItem(QA_STORAGE_KEY, next ? 'true' : 'false');
            }}
            trackColor={{ true: COLORS.accent, false: COLORS.border }}
            thumbColor={qaEnabled ? COLORS.card : '#888'}
          />
        </View>
        {sections.map(row => (
          <View key={row.label} style={styles.row}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.value}>{row.value}</Text>
          </View>
        ))}
        {qaEnabled ? (
          <>
            <Text style={styles.qaMarker}>QA: Clear button should appear below</Text>
            <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
              <Text style={styles.clearText}>Clear diagnostics</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.qaHint}>Enable QA controls to show reset actions.</Text>
        )}
        <Text style={styles.hint}>No secrets are stored; values are read-only.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatTs(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function useDiagnosticsData(userId?: string | null, qaEnabled?: boolean) {
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
    const sessionInfo = await getStoredSession();
    const lastError = await getLastApiError();
    const lastWrite = await getLastCoreWrite();

    const version = Constants.expoConfig?.version ?? 'dev';
    const build = Constants.expoConfig?.runtimeVersion ?? Constants.expoConfig?.extra?.buildNumber ?? '';
    const newRows: Row[] = [
      { label: 'Diagnostics enabled', value: DIAGNOSTICS_ENABLED ? 'true' : 'false' },
      { label: 'QA controls', value: qaEnabled ? 'on' : 'off' },
      { label: 'Auth status', value: userId ? 'logged in' : 'logged out' },
      { label: 'User id', value: userId ?? '—' },
      { label: 'Token present', value: sessionInfo.token ? 'true' : 'false' },
      { label: 'App version', value: build ? `${version} (${build})` : version },
      {
        label: 'Last API error',
        value: lastError
          ? `${lastError.endpoint} ${lastError.status ?? 'n/a'} @ ${formatTs(lastError.timestamp)} — ${lastError.message}`
          : 'none',
      },
      {
        label: 'Last core write',
        value: lastWrite ? `${lastWrite.label} @ ${formatTs(lastWrite.timestamp)}` : 'none',
      },
      { label: 'Current time', value: `${now.toLocaleString()} (${tz})` },
      { label: 'Network', value: 'unknown' },
    ];
    setRows(newRows);
  };

  return { rows, load };
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  switchLabel: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 64,
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  row: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 12,
  },
  label: {
    color: COLORS.muted,
    fontSize: 13,
    marginBottom: 4,
  },
  value: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    color: COLORS.muted2,
    fontSize: 12,
    marginTop: 8,
  },
  clearBtn: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  clearText: {
    color: '#EF4444',
    fontWeight: '700',
  },
  qaMarker: {
    color: COLORS.muted2,
    fontSize: 12,
    marginBottom: 6,
  },
  qaHint: {
    color: COLORS.muted2,
    fontSize: 12,
    marginBottom: 10,
  },
});
