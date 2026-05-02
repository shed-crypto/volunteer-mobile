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
import { ScreenHeader, Button, ConfirmDeleteModal } from '../../components/ui';

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
  chatId?: string;
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

  const [org, setOrg]         = useState<OrgDetail & { parentOrg?: { id: string; name: string } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'members' | 'hubs' | 'groups'>('members');
  const [deleteModal, setDeleteModal] = useState<{ visible: boolean; targetName: string; onConfirm: () => void; title?: string }>({ visible: false, targetName: '', onConfirm: () => {} });

  const fetchOrg = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    try {
      // Бекенд має повертати parentOrg, перевіримо структуру в service/controller
      const { data } = await api.get<OrgDetail & { parentOrg?: { id: string; name: string } }>(`/organizations/${orgId}`);
      setOrg(data);
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося завантажити');
      if (navigation.canGoBack()) navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  const myMembership = org?.members?.find((m) => m.userId === user?.id);
  const isAdmin = user?.systemRole === 'admin';
  const isLeaderOrCoord = myMembership?.orgRole === 'leader' || myMembership?.orgRole === 'coordinator';
  const isLeader = myMembership?.orgRole === 'leader';
  const canManage = isLeaderOrCoord || isAdmin;
  const activeMembers = org?.members?.filter((m) => m.isActive !== false) ?? [];

  if (loading) return <ActivityIndicator size="large" color={Colors.primary} style={{ flex: 1 }} />;
  if (!org) return null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title={org.name}
        onBack={() => navigation.goBack()}
        subtitle={myMembership ? ORG_ROLE_LABELS[myMembership.orgRole] ?? 'Учасник' : undefined}
        rightAction={
          canManage ? (
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
              {org.chatId && (
                <TouchableOpacity onPress={() => navigation.navigate('Chats', { screen: 'ChatRoom', params: { chatId: org.chatId } })}>
                  <Ionicons name="chatbubble" size={24} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
      />

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {org.parentOrg && (
          <View style={styles.subgroupBadge}>
            <Ionicons name="git-branch" size={14} color="#fff" />
            <Text style={styles.subgroupText}>Підгрупа організації: {org.parentOrg.name}</Text>
          </View>
        )}
        {org.description ? <View style={styles.descCard}><Text style={styles.descText}>{org.description}</Text></View> : null}
        
        <View style={styles.statsRow}>
          <View style={styles.stat}><Text style={styles.statNum}>{activeMembers.length}</Text><Text style={styles.statLabel}>Учасників</Text></View>
          <View style={styles.stat}><Text style={styles.statNum}>{org.hubs?.length ?? 0}</Text><Text style={styles.statLabel}>Хабів</Text></View>
          <View style={styles.stat}><Text style={styles.statNum}>{org.children?.length ?? 0}</Text><Text style={styles.statLabel}>Підгруп</Text></View>
        </View>

        <View style={styles.tabs}>
          {(['members', 'hubs', 'groups'] as const).map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'members' ? 'Учасники' : t === 'hubs' ? 'Хаби' : 'Підгрупи'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'members' && activeMembers.map((m) => (
          <View key={m.id} style={styles.memberCard}>
            <Text style={{ flex: 1 }}>{m.user?.fullName}</Text>
            {canManage && (
              <TouchableOpacity onPress={() => Alert.alert('Видалити?', 'Видалити учасника?', [
                { text: 'Ні' },
                { text: 'Так', style: 'destructive', onPress: () => api.delete(`/organizations/${orgId}/members/${m.userId}`).then(fetchOrg) }
              ])}>
                <Ionicons name="trash" size={20} color={Colors.danger} />
              </TouchableOpacity>
            )}
          </View>
        ))}

        {tab === 'hubs' && (
          <View>
            {canManage && <Button title="+ Додати хаб" onPress={() => navigation.navigate('AddHub', { orgId })} style={{ marginBottom: 12 }} />}
            {org.hubs.map((hub) => (
              <TouchableOpacity key={hub.id} style={styles.hubCard} onPress={() => navigation.navigate('HubDetail', { orgId, hubId: hub.id })}>
                <Text style={styles.hubName}>{hub.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {tab === 'groups' && (
          <View>
            {canManage && <Button title="+ Створити підгрупу" onPress={() => navigation.navigate('OrgEdit', { parentOrgId: orgId })} style={{ marginBottom: 12 }} />}
            {org.children.map((child) => (
              <TouchableOpacity key={child.id} style={styles.groupCard} onPress={() => navigation.navigate('OrgDetail', { orgId: child.id })}>
                <Text>{child.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!myMembership && <Button title="Вступити" onPress={() => orgsApi.join(orgId).then(() => Alert.alert('Успіх'))} />}
        
        {isAdmin && !isLeaderOrCoord && <Text style={{ textAlign: 'center', color: Colors.primary, marginBottom: 10, fontWeight: '700' }}>Адміністраторський доступ</Text>}
        {myMembership && !isLeader && <Button title="Покинути" variant="danger" onPress={() => orgsApi.leave(orgId).then(() => navigation.goBack())} />}
        
        <ConfirmDeleteModal 
          visible={deleteModal.visible} 
          targetName={deleteModal.targetName} 
          title={deleteModal.title}
          onClose={() => setDeleteModal(prev => ({ ...prev, visible: false }))} 
          onConfirm={() => { deleteModal.onConfirm(); setDeleteModal(prev => ({ ...prev, visible: false })); }} 
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  descCard: { backgroundColor: Colors.primaryLight, padding: 12, borderRadius: 10, marginVertical: 10 },
  descText: { color: Colors.primary },
  subgroupBadge: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 6,
    backgroundColor: Colors.secondary, padding: 8, borderRadius: 8,
  },
  subgroupText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  statsRow: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 10 },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 10 },
  tabs: { flexDirection: 'row', marginVertical: 10, backgroundColor: '#eee', borderRadius: 8 },
  tab: { flex: 1, padding: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#ddd' },
  tabText: { fontSize: 12 },
  tabTextActive: { fontWeight: '700' },
  memberCard: { flexDirection: 'row', padding: 12, backgroundColor: '#fff', marginBottom: 5, borderRadius: 8 },
  hubCard: { padding: 12, backgroundColor: '#fff', marginBottom: 5, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between' },
  hubName: { fontWeight: '600' },
  groupCard: { padding: 12, backgroundColor: '#fff', marginBottom: 5, borderRadius: 8 },
});