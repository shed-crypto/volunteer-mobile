import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Switch, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Q } from '@nozbe/watermelondb';
import { useAuth } from '../../context/AuthContext';
import { usersApi } from '../../api/users.api';
import { TrustVouch, SystemRole } from '../../types';
import { Colors, clearanceLabels, roleLabels } from '../../utils/theme';
import { Button, Card, LoadingScreen, ScreenHeader } from '../../components/ui';
import { getMediaUrl, fileUtils } from '../../utils/fileUtils';
import { useBiometrics, BiometricState } from '../../hooks/useBiometrics';
import { SyncEventLogger } from '../../services/SyncEventLogger';
import { getServerReachable } from '../../api/axios';
import { uploadFormData } from '../../api/upload';
import { API_BASE_URL } from '../../api/axios';
import api from '../../api/axios';
import { collections, safeWrite } from '../../db/index';
import { SyncService } from '../../db/SyncService';

const CACHED_VOUCHES_KEY = 'cached_vouches';

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user, logout, refreshUser } = useAuth();
  const biometrics = useBiometrics();

  const [vouches, setVouches]         = useState<TrustVouch[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [bioState, setBioState]       = useState<BiometricState>({ isSupported: false, isEnabled: false });
  const [bioToggling, setBioToggling] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [isOffline, setIsOffline]     = useState(false);
  const [pendingProfile, setPendingProfile] = useState<any>(null);
  const [syncingProfile, setSyncingProfile] = useState(false);
  const mountedRef = useRef(true);

  const load = async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);

    // Перевіряємо чи є мережа
    const serverOk = getServerReachable();
    setIsOffline(!serverOk);

    // Перевіряємо чи є pending PROFILE_UPDATE в action_queue
    try {
      const allQueue = await collections.actionQueue.query().fetch();
      const profileItem: any = allQueue.find((item: any) => item.actionType === 'PROFILE_UPDATE');
      if (profileItem) {
        try {
          const payload = JSON.parse(profileItem.payloadRaw || '{}');
          setPendingProfile({
            fullName: payload?.data?.fullName,
            phoneNumber: payload?.data?.phoneNumber,
            localAvatarUri: payload?.localAvatarUri,
            queueItemId: profileItem.id,
          });
          // Якщо сервер доступний — автоматично синхронізуємо
          if (serverOk) {
            syncPendingProfile();
          }
        } catch {
          setPendingProfile(null);
        }
      } else {
        setPendingProfile(null);
      }
    } catch {
      setPendingProfile(null);
    }

    try {
      if (!serverOk) {
        // Офлайн — завантажуємо кешовані дані
        const cached = await AsyncStorage.getItem(CACHED_VOUCHES_KEY);
        if (cached) {
          setVouches(JSON.parse(cached));
        }
        const bio = await biometrics.getBiometricState();
        setBioState(bio);
      } else {
        const [v, bio] = await Promise.all([
          usersApi.getVouches(user.id),
          biometrics.getBiometricState(),
        ]);
        setVouches(v);
        setBioState(bio);
        await AsyncStorage.setItem(CACHED_VOUCHES_KEY, JSON.stringify(v));
      }
    } catch {
      try {
        const cached = await AsyncStorage.getItem(CACHED_VOUCHES_KEY);
        if (cached) setVouches(JSON.parse(cached));
      } catch {}
      setBioState({ isSupported: false, isEnabled: false });
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  /** Видалити PROFILE_UPDATE з action_queue */
  const removeFromActionQueue = async () => {
    if (!pendingProfile?.queueItemId) return;
    try {
      await safeWrite(async () => {
        const allQueue = await collections.actionQueue.query().fetch();
        const item = allQueue.find((i: any) => i.id === pendingProfile.queueItemId);
        if (item) await item.destroyPermanently();
      });
    } catch (e) {
      console.warn('[Profile] Failed to remove queue item:', e);
    }
  };

  const syncPendingProfile = async () => {
    if (!pendingProfile || syncingProfile) return;
    setSyncingProfile(true);
    try {
      const serverOk = getServerReachable();
      if (!serverOk) {
        Alert.alert('⚠️ Офлайн', 'Сервер недоступний. Спробуйте пізніше.');
        return;
      }

      // Завантажуємо аватарку
      if (pendingProfile.localAvatarUri) {
        const rawName = pendingProfile.localAvatarUri.split('/').pop() || 'avatar.jpg';
        const ext = rawName.split('.').pop()?.toLowerCase();
        const fallbackType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const normalized = await fileUtils.normalizeImagePickerAsset(pendingProfile.localAvatarUri, rawName, fallbackType);
        const formData = new FormData();
        formData.append('file', { uri: normalized.uri, name: normalized.name, type: normalized.mimeType } as any);
        await uploadFormData<{ url: string }>(`${API_BASE_URL}/chats/avatar`, formData);
      }

      // Оновлюємо профіль
      const patchData: any = {};
      if (pendingProfile.fullName) patchData.fullName = pendingProfile.fullName;
      if (pendingProfile.phoneNumber) patchData.phoneNumber = pendingProfile.phoneNumber;
      if (user) {
        await api.patch(`/users/${user.id}`, patchData);
      }

      // Чистимо чергу
      await removeFromActionQueue();
      setPendingProfile(null);
      await refreshUser();
      Alert.alert('✅', 'Зміни профілю синхронізовано');
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося синхронізувати зміни. Спробуйте пізніше.');
    } finally {
      setSyncingProfile(false);
    }
  };

  const cancelPendingProfile = async () => {
    await removeFromActionQueue();
    setPendingProfile(null);
    Alert.alert('Скасовано', 'Незбережені зміни профілю видалено з черги.');
  };

  useEffect(() => {
    load();
    // Підписка на події SyncService — оновлюємо профіль після синхронізації
    const unsubSync = SyncService.on('sync-event', async (data: any) => {
      if (data?.type === 'sync_success' || data?.type === 'sync_error') {
        // Перевіряємо чи змінилась черга (SyncService міг видалити PROFILE_UPDATE)
        try {
          const allQueue = await collections.actionQueue.query().fetch();
          const hasProfileUpdate = allQueue.some((item: any) => item.actionType === 'PROFILE_UPDATE');
          if (!hasProfileUpdate && pendingProfile) {
            setPendingProfile(null);
          }
        } catch {}
        // Оновлюємо дані юзера з сервера
        await refreshUser();
      }
    });
    return () => {
      mountedRef.current = false;
      unsubSync();
    };
  }, []);

  useEffect(() => {
    const update = async () => {
      const c = await SyncEventLogger.getUnreadCount();
      if (mountedRef.current) setEventCount(c);
    };
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, []);

  const handleLogout = () => {
    Alert.alert('Вийти?', 'Ви дійсно хочете вийти з системи?', [
      { text: 'Скасувати' },
      { text: 'Вийти', style: 'destructive', onPress: logout },
    ]);
  };

  const handleBioToggle = async (value: boolean) => {
    setBioToggling(true);
    try {
      if (value) {
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
      <ScreenHeader
        title="Мій профіль"
        rightAction={
          <TouchableOpacity onPress={() => navigation.navigate('NotificationHistory')} style={{ flexDirection: 'row', alignItems: 'center', padding: 4 }}>
            <Text style={{ fontSize: 22 }}>🔔</Text>
            {eventCount > 0 && (
              <View style={{ position: 'absolute', top: -2, right: -4, backgroundColor: '#d32f2f', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{eventCount > 99 ? '99+' : eventCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        }
      />

      {/* ─── Офлайн-банер ─────────────────────────────────────────────────── */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>📡 Ви в офлайні — показано кешовані дані</Text>
        </View>
      )}

      {/* ─── Банер черги редагування профілю ──────────────────────────────── */}
      {pendingProfile && (
        <View style={styles.pendingBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>⏳ Є невідправлені зміни профілю</Text>
            <Text style={styles.pendingDesc}>
              {pendingProfile.fullName && `Ім'я: ${pendingProfile.fullName}`}
              {pendingProfile.localAvatarUri && ' + аватарка'}
            </Text>
          </View>
          <View style={styles.pendingActions}>
            <TouchableOpacity
              style={styles.pendingRetryBtn}
              onPress={syncPendingProfile}
              disabled={syncingProfile}
            >
              <Text style={styles.pendingRetryText}>
                {syncingProfile ? '...' : 'Синхр.'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pendingCancelBtn}
              onPress={cancelPendingProfile}
              disabled={syncingProfile}
            >
              <Text style={styles.pendingCancelText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Avatar & name */}
        <View style={styles.profileHero}>
          {user?.avatarUrl ? (
            <Image source={{ uri: getMediaUrl(user.avatarUrl) }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{user?.fullName?.[0]?.toUpperCase() ?? '?'}</Text>
            </View>
          )}
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
          <InfoRow label="ID" value={user?.id ? user.id.slice(0, 8) + '...' : ''} />
          <InfoRow label="Зареєстровано" value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString('uk-UA') : '—'} />
        </Card>

        {/* Security settings */}
        <Card>
          <Text style={styles.cardTitle}>Безпека</Text>
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
          <Button title="🔑 Змінити пароль" variant="outline"
            onPress={() => navigation.navigate('ChangePassword')} />
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
  avatarImage: { width: 80, height: 80, borderRadius: 40, marginBottom: 10 },
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
  offlineBanner: {
    backgroundColor: '#FFF3CD',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  offlineBannerText: {
    fontSize: 12,
    color: '#856404',
    textAlign: 'center',
    fontWeight: '600',
  },
  pendingBanner: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#BBDEFB',
  },
  pendingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1565C0',
  },
  pendingDesc: {
    fontSize: 11,
    color: '#64B5F6',
    marginTop: 2,
  },
  pendingActions: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 8,
  },
  pendingRetryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1565C0',
  },
  pendingRetryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  pendingCancelBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EF9A9A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C62828',
  },
});