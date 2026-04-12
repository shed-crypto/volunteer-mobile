import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, StyleSheet, RefreshControl, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { usersApi } from '../../api/users.api';
import { TrustVouch, SystemRole } from '../../types';
import { Colors, clearanceLabels, roleLabels } from '../../utils/theme';
import { Button, Card, LoadingScreen, ScreenHeader } from '../../components/ui';
import { useBiometrics, BiometricState } from '../../hooks/useBiometrics';

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user, logout } = useAuth();
  const biometrics = useBiometrics();

  const [vouches, setVouches]         = useState<TrustVouch[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [bioState, setBioState]       = useState<BiometricState>({ isSupported: false, isEnabled: false });
  const [bioToggling, setBioToggling] = useState(false);

  const load = async () => {
    if (!user) return;
    try {
      const [v, bio] = await Promise.all([
        usersApi.getVouches(user.id),
        biometrics.getBiometricState(),
      ]);
      setVouches(v);
      setBioState(bio);
    } catch {
      setVouches([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleLogout = () => {
    Alert.alert('Вийти?', 'Ви дійсно хочете вийти з системи?', [
      { text: 'Скасувати' },
      { text: 'Вийти', style: 'destructive', onPress: logout },
    ]);
  };

  // ─── Перемикач біометрії ──────────────────────────────────────────────────
  const handleBioToggle = async (value: boolean) => {
    setBioToggling(true);
    try {
      if (value) {
        // Ввімкнути: просимо ввести пароль щоб зберегти credentials
        Alert.prompt(
          '🔒 Ввімкнути біометрію',
          'Введіть ваш пароль для збереження (зашифровано на пристрої)',
          async (password) => {
            if (!password || !user?.email) return;
            const ok = await biometrics.enableBiometric(user.email, password);
            if (ok) {
              setBioState((s) => ({ ...s, isEnabled: true }));
              Alert.alert('✅', 'Біометричний вхід увімкнено');
            } else {
              Alert.alert('Скасовано', 'Біометрію не підтверджено');
            }
          },
          'secure-text',
        );
      } else {
        // Вимкнути
        await biometrics.disableBiometric();
        setBioState((s) => ({ ...s, isEnabled: false }));
        Alert.alert('ℹ️', 'Біометричний вхід вимкнено');
      }
    } finally {
      setBioToggling(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const clearanceLabel = clearanceLabels[user?.clearanceLevel ?? ''] ?? user?.clearanceLevel;
  const roleLabel      = roleLabels[user?.systemRole ?? ''] ?? user?.systemRole;
  const trustPct       = Math.min(Math.round(Number(user?.trustScore ?? 0)), 100);
  const FRONTLINE_NEEDED = 3;
  const vouchCount = vouches.length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader title="Мій профіль" />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Avatar & name */}
        <View style={styles.profileHero}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{user?.fullName?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text style={styles.name}>{user?.fullName}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.roleRow}>
            <Text style={styles.roleBadge}>{roleLabel}</Text>
            <Text style={styles.clearanceBadge}>{clearanceLabel}</Text>
          </View>
        </View>

        {/* Trust score */}
        <Card>
          <Text style={styles.cardTitle}>Рейтинг довіри</Text>
          <View style={styles.trustRow}>
            <Text style={styles.trustScore}>{trustPct}</Text>
            <Text style={styles.trustMax}>/100</Text>
          </View>
          <View style={styles.trustBarBg}>
            <View style={[styles.trustBarFill, { width: `${trustPct}%` }]} />
          </View>
          <Text style={styles.trustHint}>
            Зростає при підтвердженні виконаних задач (+5 за кожну)
          </Text>
        </Card>

        {/* Vouches */}
        <Card>
          <Text style={styles.cardTitle}>Система поручителів</Text>
          <View style={styles.vouchProgress}>
            {Array.from({ length: FRONTLINE_NEEDED }).map((_, i) => (
              <View key={i} style={[styles.vouchDot, i < vouchCount && styles.vouchDotFilled]}>
                <Text style={{ fontSize: 14 }}>{i < vouchCount ? '✓' : ''}</Text>
              </View>
            ))}
            <Text style={styles.vouchCount}>{vouchCount}/{FRONTLINE_NEEDED}</Text>
          </View>
          <Text style={styles.vouchDesc}>
            {vouchCount === 0
              ? 'Ще немає поручителів. Зверніться до верифікованих учасників.'
              : vouchCount < FRONTLINE_NEEDED
              ? `Ще ${FRONTLINE_NEEDED - vouchCount} поручителів до рівня Frontline`
              : '✅ Рівень Frontline розблоковано — доступні прифронтові задачі'}
          </Text>
          {vouches.length > 0 && (
            <View style={styles.voucherList}>
              {vouches.map((v) => (
                <View key={v.id} style={styles.voucherRow}>
                  <View style={styles.voucherAvatar}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>
                      {v.voucher?.fullName?.[0] ?? '?'}
                    </Text>
                  </View>
                  <Text style={styles.voucherName}>{v.voucher?.fullName ?? 'Невідомий'}</Text>
                  <Text style={styles.voucherDate}>
                    {new Date(v.createdAt).toLocaleDateString('uk-UA')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Account info */}
        <Card>
          <Text style={styles.cardTitle}>Акаунт</Text>
          <InfoRow label="Email" value={user?.email ?? ''} />
          {user?.phoneNumber && <InfoRow label="Телефон" value={user.phoneNumber} />}
          <InfoRow label="ID" value={user?.id?.slice(0, 8) + '...' ?? ''} />
          <InfoRow label="Зареєстровано" value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString('uk-UA') : '—'} />
        </Card>

        {/* Security settings */}
        <Card>
          <Text style={styles.cardTitle}>Безпека</Text>

          {/* Biometric toggle */}
          {bioState.isSupported && (
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>
                  {Platform.OS === 'ios' ? '🔒 Face ID / Touch ID' : '👆 Відбиток пальця'}
                </Text>
                <Text style={styles.settingDesc}>Швидкий вхід без пароля</Text>
              </View>
              <Switch
                value={bioState.isEnabled}
                onValueChange={handleBioToggle}
                disabled={bioToggling}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={bioState.isEnabled ? '#fff' : Colors.textMuted}
              />
            </View>
          )}

          {!bioState.isSupported && (
            <Text style={styles.bioUnsupported}>
              ⓘ Біометрія не налаштована або не підтримується цим пристроєм
            </Text>
          )}
        </Card>

        {/* Navigation */}
        <View style={{ marginHorizontal: 16, gap: 10 }}>
          <Button title="✏️ Редагувати профіль" variant="outline"
            onPress={() => navigation.navigate('EditProfile')} />
          <Button title="🚗 Мій транспорт" variant="outline"
            onPress={() => navigation.navigate('Vehicles')} />
          <Button title="🏢 Організації" variant="outline"
            onPress={() => navigation.navigate('Organizations')} />
          {user?.systemRole === SystemRole.ADMIN && (
            <Button title="🛡 Адмін-панель" variant="outline"
              onPress={() => navigation.navigate('Admin')} />
          )}
          <Button title="Вийти з системи" variant="danger" onPress={handleLogout} />
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight }}>
      <Text style={{ fontSize: 13, color: Colors.textSecondary }}>{label}</Text>
      <Text style={{ fontSize: 13, color: Colors.text, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

// Needed to fix Alert.prompt type issue on Android (it's iOS only)
const Platform = require('react-native').Platform;

const styles = StyleSheet.create({
  profileHero: {
    backgroundColor: Colors.primary,
    alignItems: 'center',
    paddingVertical: 28, paddingHorizontal: 20,
    marginBottom: 4,
  },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 3, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 36, fontWeight: '800', color: '#fff' },
  name:  { fontSize: 22, fontWeight: '800', color: '#fff' },
  email: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  roleBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: '#fff', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, fontSize: 12, fontWeight: '700',
  },
  clearanceBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: '#fff', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, fontSize: 12, fontWeight: '700',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 14 },
  trustRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 10 },
  trustScore: { fontSize: 40, fontWeight: '800', color: Colors.primary },
  trustMax: { fontSize: 20, color: Colors.textMuted },
  trustBarBg: { height: 10, backgroundColor: Colors.borderLight, borderRadius: 5, overflow: 'hidden', marginBottom: 8 },
  trustBarFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 5 },
  trustHint: { fontSize: 12, color: Colors.textMuted },
  vouchProgress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  vouchDot: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: Colors.border,
    backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  vouchDotFilled: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  vouchCount: { marginLeft: 8, fontSize: 16, fontWeight: '700', color: Colors.text },
  vouchDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  voucherList: { marginTop: 12, gap: 8 },
  voucherRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  voucherAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center',
  },
  voucherName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.text },
  voucherDate: { fontSize: 12, color: Colors.textMuted },
  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 6,
  },
  settingInfo: { flex: 1, marginRight: 12 },
  settingLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  settingDesc:  { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  bioUnsupported: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },
});
