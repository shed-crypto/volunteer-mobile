/**
 * UserProfileScreen.tsx — Профіль іншого користувача (FR-01f, FR-02a)
 *
 * БАГ-ФІКс: GET /users/:id/vouches-given не існує на бекенді.
 * Правильний endpoint: GET /users/:id/vouches (повертає vouches отримані userId).
 * Щоб перевірити чи current user вже поручився — фільтруємо по voucherId.
 *
 * Також показуємо пояснення: хто може поручитися і як стати координатором.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui';
import { Colors } from '../../utils/theme';
import axiosInstance from '../../api/axios';
import { SystemRole, ClearanceLevel } from '../../types';
import { chatApi } from '../../api/chat.api';

interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  systemRole: string;
  clearanceLevel: string;
  vouchCount: number;
  trustScore?: number;
  isBlocked: boolean;
  createdAt: string;
}

interface Vouch {
  id: string;
  voucherId: string;
  voucheeId: string;
  voucher?: { fullName: string };
}

type RouteParams = { userId: string };

const CLEARANCE_INFO: Record<string, { label: string; color: string }> = {
  local:         { label: 'Локальний',   color: '#4CAF50' },
  international: { label: 'Міжнародний', color: '#2196F3' },
  frontline:     { label: 'Фронтовий',   color: '#F44336' },
};

const ROLE_LABELS: Record<string, string> = {
  volunteer:   'Волонтер',
  requester:   'Потребуючий',
  coordinator: 'Координатор',
  admin:       'Адміністратор',
};

export default function UserProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { user: currentUser } = useAuth();
  const userId = route.params?.userId;

  const [profile, setProfile]     = useState<UserProfile | null>(null);
  const [vouches, setVouches]     = useState<Vouch[]>([]);
  const [loading, setLoading]     = useState(true);
  const [vouching, setVouching]   = useState(false);

  const isOwnProfile = currentUser?.id === userId;
  const hasVouched   = vouches.some((v) => v.voucherId === currentUser?.id);

  // Хто може поручитися: FRONTLINE волонтер або Admin
  const canVouch =
    !isOwnProfile &&
    (currentUser?.clearanceLevel === ClearanceLevel.FRONTLINE ||
     currentUser?.systemRole === SystemRole.ADMIN);

  useEffect(() => { fetchAll(); }, [userId]);

  const fetchAll = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const [profileRes, vouchesRes] = await Promise.all([
        axiosInstance.get<UserProfile>(`/users/${userId}`),
        // БАГ-ФІКс: правильний endpoint /users/:id/vouches (не /vouches-given)
        axiosInstance.get<Vouch[]>(`/users/${userId}/vouches`),
      ]);
      setProfile(profileRes.data);
      setVouches(vouchesRes.data ?? []);
     } catch (e: any) {
       console.error('Failed to load user profile:', e);
       Alert.alert('Помилка', 'Не вдалося завантажити профіль');
       if (navigation.canGoBack()) navigation.goBack();
     } finally {
       setLoading(false);
     }
  };

  const handleVouch = async () => {
    if (hasVouched) {
      Alert.alert('Вже поручились', 'Ви вже поручилися за цього волонтера');
      return;
    }
    Alert.alert(
      'Поручитися',
      `Ви підтверджуєте надійність: ${profile?.fullName}?\n\nПоручительство підвищує clearance level та дає доступ до більшої кількості заявок.`,
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Поручитися ✓',
          onPress: async () => {
            setVouching(true);
            try {
              await axiosInstance.post(`/users/${userId}/vouch`);
              await fetchAll();
              Alert.alert('✓', `Ви поручилися за ${profile?.fullName}`);
            } catch (err: any) {
              Alert.alert('Помилка', err?.response?.data?.message || 'Не вдалося поручитися');
            } finally {
              setVouching(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!profile) return null;

  const cl = CLEARANCE_INFO[profile.clearanceLevel] ?? { label: profile.clearanceLevel, color: '#999' };
  const vouchCount = vouches.length;
  const FRONTLINE_NEEDED = 3;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Профіль волонтера</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Avatar + name */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{profile.fullName[0]?.toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{profile.fullName}</Text>
          <Text style={styles.email}>{profile.email}</Text>

          <View style={styles.badges}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{ROLE_LABELS[profile.systemRole] ?? profile.systemRole}</Text>
            </View>
            <View style={[styles.clearanceBadge, { backgroundColor: cl.color }]}>
              <Text style={styles.clearanceBadgeText}>{cl.label}</Text>
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{vouchCount}</Text>
            <Text style={styles.statLabel}>Поручителів</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{Math.round(Number(profile.trustScore ?? 0))}</Text>
            <Text style={styles.statLabel}>Trust score</Text>
          </View>
        </View>

        {/* Vouch progress */}
        {profile.clearanceLevel !== 'frontline' && (
          <View style={styles.vouchCard}>
            <Text style={styles.vouchTitle}>Прогрес поруки</Text>
            <Text style={styles.vouchSubtitle}>
              {vouchCount}/{FRONTLINE_NEEDED} поручителів для FRONTLINE рівня
            </Text>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${Math.min(100, (vouchCount / FRONTLINE_NEEDED) * 100)}%` }]} />
            </View>
            <Text style={styles.vouchHint}>
              {vouchCount === 0
                ? 'Поки що немає поручителів. FRONTLINE волонтери або адмін можуть поручитися.'
                : vouchCount < FRONTLINE_NEEDED
                ? `Ще ${FRONTLINE_NEEDED - vouchCount} поручителів до FRONTLINE рівня`
                : 'FRONTLINE рівень буде надано автоматично'}
            </Text>
          </View>
        )}

        {/* Список поручителів */}
        {vouches.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Поручителі ({vouchCount})</Text>
            {vouches.map((v) => (
              <View key={v.id} style={styles.voucherRow}>
                <View style={styles.voucherDot} />
                <Text style={styles.voucherName}>{v.voucher?.fullName ?? 'Верифікований волонтер'}</Text>
                {v.voucherId === currentUser?.id && (
                  <Text style={styles.youBadge}>Ви</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Coordinator info */}
        {profile.systemRole === 'volunteer' && (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>💡 Як стати координатором?</Text>
            <Text style={styles.infoText}>
              Координатора призначає адміністратор. Координатор отримує права: створювати підзадачі, делегувати заявки іншим організаціям, переглядати список всіх волонтерів.{'\n\n'}
              Щоб підвищити clearance: отримайте {FRONTLINE_NEEDED} поручителі від FRONTLINE волонтерів або адміна.
            </Text>
          </View>
        )}

        {/* Vouch button */}
        {!isOwnProfile && (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            {canVouch ? (
              <Button
                title={hasVouched ? '✓ Ви вже поручилися' : '🤝 Поручитися за волонтера'}
                variant={hasVouched ? 'secondary' : 'primary'}
                onPress={handleVouch}
                loading={vouching}
                disabled={hasVouched}
              />
            ) : (
              !isOwnProfile && (
                <View style={styles.cantVouchBox}>
                  <Text style={styles.cantVouchText}>
                    🔒 Поручитися може лише FRONTLINE волонтер або адміністратор
                  </Text>
                </View>
              )
            )}
          </View>
        )}
        
        {/* Start Chat button */}
        {!isOwnProfile && (
          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <Button
              title="💬 Почати чат"
              variant="outline"
              onPress={async () => {
                try {
                  const chat = await chatApi.getOrCreateDirect(userId);
                  // Navigate to ChatRoom via Chats navigator (nested navigation)
                  navigation.navigate('Chats', {
                    screen: 'ChatRoom',
                    params: { chatId: chat.id, chatName: profile.fullName },
                  });
                } catch (error: any) {
                  console.error('Failed to start chat:', error);
                  Alert.alert(
                    'Помилка',
                    error.response?.data?.message || 'Не вдалося почати чат'
                  );
                }
              }}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: Colors.primary, paddingTop: 44, paddingBottom: 16,
    paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  backBtn: { padding: 4 },
  backText: { color: 'rgba(255,255,255,0.8)', fontSize: 22 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },

  avatarSection: { alignItems: 'center', paddingTop: 24, paddingBottom: 16 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 32 },
  name: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  email: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  badges: { flexDirection: 'row', gap: 8 },
  roleBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  roleBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  clearanceBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4 },
  clearanceBadgeText: { fontSize: 12, fontWeight: '600', color: '#fff' },

  statsRow: {
    flexDirection: 'row', marginHorizontal: 16,
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  statNum: { fontSize: 22, fontWeight: '700', color: Colors.primary },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  vouchCard: {
    margin: 16, backgroundColor: Colors.surface, borderRadius: 12,
    padding: 16, borderWidth: 1, borderColor: Colors.border,
  },
  vouchTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  vouchSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  progressBg: { height: 6, backgroundColor: Colors.borderLight, borderRadius: 3 },
  progressFill: { height: 6, backgroundColor: Colors.primary, borderRadius: 3 },
  vouchHint: { fontSize: 12, color: Colors.textMuted, marginTop: 8 },

  section: { marginHorizontal: 16, marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  voucherRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight,
  },
  voucherDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.secondary },
  voucherName: { flex: 1, fontSize: 13, color: Colors.text },
  youBadge: {
    fontSize: 11, fontWeight: '600', color: Colors.primary,
    backgroundColor: Colors.primaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },

  infoCard: {
    margin: 16, backgroundColor: '#FFF8E1', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#FFE082',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#F57F17', marginBottom: 6 },
  infoText: { fontSize: 13, color: '#795548', lineHeight: 20 },

  cantVouchBox: {
    backgroundColor: Colors.borderLight, borderRadius: 10,
    padding: 12, alignItems: 'center',
  },
  cantVouchText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
});
