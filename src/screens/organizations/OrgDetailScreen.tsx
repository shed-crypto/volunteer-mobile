/**
 * OrgDetailScreen.tsx — Деталі організації (FR-03b, FR-03e, FR-03f)
 *
 * БАГ-ФІКс: неправильний URL.
 * Було: GET /organizations/${orgId}/detail   ← endpoint не існує → 404
 * Стало: GET /organizations/${orgId}          ← правильний endpoint
 *
 * Також адаптовано маппінг response до структури яку повертає бекенд
 * (Organization entity з полями members, children, hubs — не myRole, subGroups).
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../utils/theme';
import api from '../../api/axios';
import { orgsApi } from '../../api/orgs.api';
import { ScreenHeader } from '../../components/ui';

interface OrgMember {
  id: string;
  userId: string;
  orgRole: string;
  isActive: boolean;
  user?: {
    id: string;
    fullName: string;
    systemRole: string;
    email: string;
  };
}

interface Hub {
  id: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
}

interface OrgChild {
  id: string;
  name: string;
  description?: string;
}

interface OrgDetail {
  id: string;
  name: string;
  description?: string;
  members: OrgMember[];
  children: OrgChild[];
  hubs: Hub[];
}

type RouteParams = { orgId: string };

const ORG_ROLE_LABELS: Record<string, string> = {
  leader:      '👑 Лідер',
  coordinator: '🎯 Координатор',
  member:      '👤 Учасник',
};

export default function OrgDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { user } = useAuth();
  const orgId = route.params?.orgId;

  const [org, setOrg]         = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'members' | 'hubs' | 'groups'>('members');

  // БАГ-ФІКс: /organizations/${orgId} замість /organizations/${orgId}/detail
  const fetchOrg = useCallback(async () => {
    console.log('[OrgDetailScreen] Fetching org with orgId:', orgId);
    if (!orgId) {
      console.error('[OrgDetailScreen] orgId is missing!');
      Alert.alert('Помилка', 'ID організації не вказано');
      if (navigation.canGoBack()) navigation.goBack();
      return;
    }
    try {
      console.log('[OrgDetailScreen] Making request to:', `/organizations/${orgId}`);
      const { data } = await api.get<OrgDetail>(`/organizations/${orgId}`);
      console.log('[OrgDetailScreen] Successfully fetched org data:', data);
      setOrg(data);
    } catch (e: any) {
      console.error('[OrgDetailScreen] Error fetching organization:', e);
      console.error('[OrgDetailScreen] Error response:', e.response);
      console.error('[OrgDetailScreen] Error message:', e?.response?.data?.message);
      
      let errorMessage = 'Не вдалося завантажити організацію';
      if (e.response?.data?.message) {
        errorMessage = e.response.data.message;
      } else if (e.message) {
        errorMessage = e.message;
      }
      
      Alert.alert('Помилка', errorMessage);
      if (navigation.canGoBack()) navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  const myMembership = org?.members?.find((m) => m.userId === user?.id);
  const isLeaderOrCoord = myMembership?.orgRole === 'leader' || myMembership?.orgRole === 'coordinator';
  const activeMembers = org?.members?.filter((m) => m.isActive !== false) ?? [];

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!org) return null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title={org.name}
        subtitle={myMembership ? ORG_ROLE_LABELS[myMembership.orgRole] ?? 'Учасник' : undefined}
        onBack={() => navigation.goBack()}
        rightAction={
          isLeaderOrCoord ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => navigation.navigate('OrgJoinRequests', { orgId })}>
                <Ionicons name="mail" size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('OrgSettings', { orgId })}>
                <Ionicons name="settings" size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('OrgEdit', { orgId })}>
                <Ionicons name="create" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : !myMembership ? (
            <TouchableOpacity
              style={styles.joinBtn}
              onPress={() => {
                Alert.prompt(
                  'Запит на вступ',
                  'Напишіть коротке повідомлення для лідерів організації',
                  [
                    { text: 'Скасувати', style: 'cancel' },
                    {
                      text: 'Надіслати',
                      onPress: async (msg?: string) => {
                        try {
                          await orgsApi.join(orgId, msg);
                          Alert.alert('Успіх', 'Запит надіслано');
                        } catch (e: any) {
                          Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося надіслати запит');
                        }
                      }
                    }
                  ]
                );
              }}
            >
              <Text style={styles.joinBtnText}>Вступити</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      {org.description ? (
        <View style={styles.descCard}>
          <Text style={styles.descText}>{org.description}</Text>
        </View>
      ) : null}

      {/* Статистика */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{activeMembers.length}</Text>
          <Text style={styles.statLabel}>Учасників</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{org.hubs?.length ?? 0}</Text>
          <Text style={styles.statLabel}>Хабів</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{org.children?.length ?? 0}</Text>
          <Text style={styles.statLabel}>Підгруп</Text>
        </View>
      </View>

      {/* Таби */}
      <View style={styles.tabs}>
        {(['members', 'hubs', 'groups'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'members' ? `Учасники (${activeMembers.length})`
               : t === 'hubs' ? `Хаби (${org.hubs?.length ?? 0})`
               : `Підгрупи (${org.children?.length ?? 0})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {tab === 'members' && (
          activeMembers.length === 0 ? (
            <Text style={styles.empty}>Немає учасників</Text>
          ) : (
            activeMembers.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={styles.memberCard}
                onPress={() => m.userId && navigation.navigate('UserProfile', { userId: m.userId })}
                activeOpacity={0.75}
              >
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {(m.user?.fullName ?? '?')[0]?.toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.user?.fullName ?? 'Невідомий'}</Text>
                  <Text style={styles.memberRole}>
                    {ORG_ROLE_LABELS[m.orgRole] ?? m.orgRole}
                  </Text>
                </View>
                {isLeaderOrCoord && (
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() =>
                      Alert.alert(
                        'Видалити учасника?',
                        m.user?.fullName,
                        [
                          { text: 'Скасувати', style: 'cancel' },
                          {
                            text: 'Видалити', style: 'destructive',
                            onPress: async () => {
                              try {
                                await api.delete(`/organizations/${orgId}/members/${m.userId}`);
                                fetchOrg();
                              } catch (e: any) {
                                Alert.alert('Помилка', e?.response?.data?.message ?? '');
                              }
                            },
                          },
                        ],
                      )
                    }
                  >
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))
          )
        )}

        {tab === 'hubs' && (
          (org.hubs?.length ?? 0) === 0 ? (
            <Text style={styles.empty}>Немає хабів/складів</Text>
          ) : (
            org.hubs.map((hub) => (
              <View key={hub.id} style={styles.hubCard}>
                <Text style={styles.hubName}>📦 {hub.name}</Text>
                {hub.address && <Text style={styles.hubAddr}>{hub.address}</Text>}
                {hub.description && <Text style={styles.hubDesc}>{hub.description}</Text>}
                {hub.latitude && hub.longitude && (
                  <Text style={styles.hubCoords}>
                    📍 {hub.latitude.toFixed(4)}, {hub.longitude.toFixed(4)}
                  </Text>
                )}
              </View>
            ))
          )
        )}

        {tab === 'groups' && (
          (org.children?.length ?? 0) === 0 ? (
            <Text style={styles.empty}>Немає підгруп</Text>
          ) : (
            org.children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.groupCard}
                onPress={() => navigation.navigate('OrgDetail', { orgId: child.id })}
                activeOpacity={0.75}
              >
                <Text style={styles.groupName}>{child.name}</Text>
                {child.description && (
                  <Text style={styles.groupDesc} numberOfLines={2}>{child.description}</Text>
                )}
                <Text style={styles.groupArrow}>›</Text>
              </TouchableOpacity>
            ))
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  descCard: {
    backgroundColor: Colors.primaryLight,
    marginHorizontal: 16, marginTop: 12,
    padding: 12, borderRadius: 10,
  },
  descText: { fontSize: 14, color: Colors.primary, lineHeight: 20 },

  statsRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12,
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statNum: { fontSize: 20, fontWeight: '700', color: Colors.primary },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  joinBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  joinBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  tabs: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12,
    backgroundColor: Colors.borderLight, borderRadius: 10, padding: 3,
  },
  tab: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.surface },
  tabText: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
  tabTextActive: { color: Colors.primary },

  memberCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.borderLight,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  memberAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  memberName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  memberRole: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  removeBtn: { padding: 8 },
  removeBtnText: { color: Colors.danger, fontSize: 18, fontWeight: '700' },

  hubCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.borderLight,
  },
  hubName: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  hubAddr: { fontSize: 13, color: Colors.textSecondary },
  hubDesc: { fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  hubCoords: { fontSize: 12, color: Colors.primary, marginTop: 4 },

  groupCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.borderLight,
  },
  groupName: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  groupDesc: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  groupArrow: { fontSize: 24, color: Colors.textMuted },

  empty: { textAlign: 'center', color: Colors.textMuted, marginTop: 32, fontSize: 14 },
});