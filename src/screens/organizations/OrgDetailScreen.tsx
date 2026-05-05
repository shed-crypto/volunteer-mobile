import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Alert, ActivityIndicator, RefreshControl,
  Image,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../utils/theme';
import api from '../../api/axios';
import { orgsApi } from '../../api/orgs.api';
import { Button, ConfirmDeleteModal, EmptyState, ScreenHeader } from '../../components/ui';
import { getMediaUrl } from '../../utils/fileUtils';

interface OrgMember {
  id: string;
  userId: string;
  orgRole: string;
  isActive: boolean;
  isDeputy?: boolean;
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
  mediaUrl?: string;
}

interface OrgNode {
  id: string;
  name: string;
  description?: string;
  parentOrgId?: string;
}

interface OrgDetail {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  chatId?: string;
  parentOrgId?: string;
  parentOrg?: OrgNode;
  parent?: OrgNode;
  ancestors?: OrgNode[];
  members: OrgMember[];
  children: OrgNode[];
  hubs: Hub[];
}

type RouteParams = { orgId: string; parentPath?: OrgNode[] };
type OrgTab = 'members' | 'hubs' | 'groups';

const ORG_ROLE_LABELS: Record<string, string> = {
  leader: 'Лідер',
  coordinator: 'Координатор',
  member: 'Учасник',
};

const TAB_CONFIG: Record<OrgTab, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  members: { label: 'Учасники', icon: 'people-outline' },
  hubs: { label: 'Хаби', icon: 'cube-outline' },
  groups: { label: 'Підгрупи', icon: 'git-branch-outline' },
};

function compactPath(nodes: OrgNode[], current: OrgNode): OrgNode[] {
  const path = [...nodes, current];
  if (path.length <= 4) return path;
  return [path[0], { id: '__ellipsis__', name: '...' }, path[path.length - 2], path[path.length - 1]];
}

async function loadAncestorPath(parentOrgId?: string): Promise<OrgNode[]> {
  const ancestors: OrgNode[] = [];
  let currentParentId = parentOrgId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const { data } = await api.get<OrgDetail>(`/organizations/${currentParentId}`);
    ancestors.unshift({
      id: data.id,
      name: data.name,
      parentOrgId: data.parentOrgId,
    });
    currentParentId = data.parentOrgId;
  }

  return ancestors;
}

export default function OrgDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { user } = useAuth();
  const orgId = route.params?.orgId;
  const parentPath = route.params?.parentPath ?? [];

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<OrgTab>('members');
  const [privileges, setPrivileges] = useState<any>(null);
  const hasLoadedRef = useRef(false);
  const [deleteModal, setDeleteModal] = useState<{ visible: boolean; targetName: string; onConfirm: () => void; title?: string }>({
    visible: false,
    targetName: '',
    onConfirm: () => {},
  });

  const fetchOrg = useCallback(async (options?: { showLoader?: boolean }) => {
    if (!orgId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (options?.showLoader) setLoading(true);

    try {
      const { data } = await api.get<OrgDetail>(`/organizations/${orgId}`);
      console.log('Org members data:', data.members?.map(m => ({ userId: m.userId, isDeputy: m.isDeputy })));
      const hasParentContext = data.ancestors?.length || data.parentOrg || data.parent || parentPath.length;
      if (!hasParentContext && data.parentOrgId) {
        data.ancestors = await loadAncestorPath(data.parentOrgId);
      }
      setOrg(data);
      const priv = await orgsApi.getMemberPrivileges(orgId);
      setPrivileges(priv);
      hasLoadedRef.current = true;
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося завантажити організацію');
      if (navigation.canGoBack()) navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation, orgId, parentPath.length]);

  useFocusEffect(
    useCallback(() => {
      fetchOrg({ showLoader: !hasLoadedRef.current });
    }, [fetchOrg]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrg({ showLoader: false });
  }, [fetchOrg]);

  const isAdmin = user?.systemRole === 'admin';
  const canManage = isAdmin || (privileges?.canEdit ?? false);
  const isLeader = privileges?.isLeader ?? false;
  const activeMembers = useMemo(() => org?.members?.filter((m) => m.isActive !== false) ?? [], [org?.members]);
  const lineage = useMemo(() => {
    if (!org) return [];
    const backendAncestors = org.ancestors?.length ? org.ancestors : [];
    const routeAncestors = parentPath.length ? parentPath : [];
    const fallbackParent = !backendAncestors.length ? org.parentOrg ?? org.parent : undefined;
    const ancestors = backendAncestors.length ? backendAncestors : routeAncestors.length ? routeAncestors : fallbackParent ? [fallbackParent] : [];
    return compactPath(ancestors, org);
  }, [org, parentPath]);

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Organizations');
  };

  const openOrg = (id: string) => {
    if (id === orgId || id === '__ellipsis__') return;
    navigation.push('OrgDetail', { orgId: id });
  };

  const childParentPath = useMemo(
    () => lineage.filter((node) => node.id !== '__ellipsis__' && node.id !== org?.id),
    [lineage, org?.id],
  );

  if (loading) return <ActivityIndicator size="large" color={Colors.primary} style={{ flex: 1 }} />;
  if (!org) return null;

  const myMembership = org?.members?.find((m) => m.userId === user?.id);
  const roleLabel = myMembership ? ORG_ROLE_LABELS[myMembership.orgRole] ?? 'Учасник' : undefined;
  const isSubgroup = lineage.length > 1;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={org.name}
        onBack={goBack}
        subtitle={roleLabel}
        rightAction={
          canManage ? (
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => navigation.navigate('OrgJoinRequests', { orgId })}>
                <Ionicons name="mail-outline" size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('OrgSettings', { orgId })}>
                <Ionicons name="settings-outline" size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('OrgEdit', { orgId })}>
                <Ionicons name="create-outline" size={24} color="#fff" />
              </TouchableOpacity>
              {org.chatId && (
                <TouchableOpacity onPress={() => navigation.navigate('Chats', { screen: 'ChatRoom', params: { chatId: org.chatId } })}>
                  <Ionicons name="chatbubble-ellipses-outline" size={24} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        <View style={styles.hero}>
          {org.bannerUrl && (
            <Image source={{ uri: getMediaUrl(org.bannerUrl) }} style={styles.banner} />
          )}
          <View style={styles.heroTop}>
            <View style={styles.orgIcon}>
              {org.logoUrl ? (
                <Image source={{ uri: getMediaUrl(org.logoUrl) }} style={styles.orgLogo} />
              ) : (
                <Ionicons name={isSubgroup ? 'git-branch-outline' : 'business-outline'} size={26} color={Colors.primary} />
              )}
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.kicker}>{isSubgroup ? 'Підгрупа' : 'Організація'}</Text>
              <Text style={styles.heroTitle}>{org.name}</Text>
            </View>
          </View>

          {lineage.length > 1 && (
            <View style={styles.pathBox}>
              <Text style={styles.pathLabel}>Належить до</Text>
              <View style={styles.pathRow}>
                {lineage.map((node, index) => {
                  const isCurrent = node.id === org.id;
                  const isEllipsis = node.id === '__ellipsis__';
                  return (
                    <React.Fragment key={`${node.id}-${index}`}>
                      {index > 0 && <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />}
                      <TouchableOpacity
                        disabled={isCurrent || isEllipsis}
                        onPress={() => openOrg(node.id)}
                        style={[styles.pathChip, isCurrent && styles.pathChipCurrent, isEllipsis && styles.pathChipMuted]}
                      >
                        <Text style={[styles.pathText, isCurrent && styles.pathTextCurrent]} numberOfLines={1}>
                          {node.name}
                        </Text>
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          )}

          {org.description ? <Text style={styles.descText}>{org.description}</Text> : null}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="people-outline" size={18} color={Colors.primary} />
            <Text style={styles.statNum}>{activeMembers.length}</Text>
            <Text style={styles.statLabel}>учасників</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="cube-outline" size={18} color={Colors.secondary} />
            <Text style={styles.statNum}>{org.hubs?.length ?? 0}</Text>
            <Text style={styles.statLabel}>хабів</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="git-branch-outline" size={18} color={Colors.warning} />
            <Text style={styles.statNum}>{org.children?.length ?? 0}</Text>
            <Text style={styles.statLabel}>підгруп</Text>
          </View>
        </View>

        <View style={styles.tabs}>
          {(Object.keys(TAB_CONFIG) as OrgTab[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Ionicons name={TAB_CONFIG[t].icon} size={16} color={tab === t ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{TAB_CONFIG[t].label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'members' && (
          <View>
            {activeMembers.length === 0 ? (
              <EmptyState icon="👥" title="Учасників ще немає" />
            ) : activeMembers.map((m) => (
              <View key={m.id} style={styles.memberCard}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{m.user?.fullName?.charAt(0)?.toUpperCase() ?? '?'}</Text>
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{m.user?.fullName ?? 'Без імені'}</Text>
                  <Text style={styles.cardSubtitle}>
                    {ORG_ROLE_LABELS[m.orgRole] ?? 'Учасник'}{m.isDeputy ? ' (Заступник)' : ''}
                  </Text>
                </View>
                {canManage && (
                  <View style={styles.memberActions}>
                    <TouchableOpacity onPress={() => navigation.navigate('EditMember', { 
                      orgId, 
                      userId: m.userId, 
                      orgName: org.name, 
                      currentRole: m.orgRole, 
                      isDeputy: m.isDeputy 
                    })}>
                      <Ionicons name="create-outline" size={20} color={Colors.primary} />
                    </TouchableOpacity>
                    {m.orgRole !== 'leader' && m.userId !== user?.id && (
                      <TouchableOpacity onPress={() => Alert.alert('Видалити?', 'Видалити учасника з організації?', [
                        { text: 'Ні' },
                        { text: 'Так', style: 'destructive', onPress: () => api.delete(`/organizations/${orgId}/members/${m.userId}`).then(() => fetchOrg({ showLoader: false })) },
                      ])}>
                        <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'hubs' && (
          <View>
            {canManage && <Button title="+ Додати хаб" onPress={() => navigation.navigate('AddHub', { orgId })} style={styles.actionButton} />}
            {org.hubs.length === 0 ? (
              <EmptyState icon="📦" title="Хабів ще немає" />
            ) : org.hubs.map((hub) => (
              <TouchableOpacity key={hub.id} style={styles.listCard} onPress={() => navigation.navigate('HubDetail', { orgId, hubId: hub.id })}>
                {hub.mediaUrl ? (
                  <Image source={{ uri: getMediaUrl(hub.mediaUrl) }} style={styles.hubThumb} />
                ) : (
                  <View style={styles.listIcon}>
                    <Ionicons name="cube-outline" size={19} color={Colors.secondary} />
                  </View>
                )}
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{hub.name}</Text>
                  {hub.address ? <Text style={styles.cardSubtitle}>{hub.address}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {tab === 'groups' && (
          <View>
            {canManage && <Button title="+ Створити підгрупу" onPress={() => navigation.navigate('OrgEdit', { parentOrgId: orgId })} style={styles.actionButton} />}
            {org.children.length === 0 ? (
              <EmptyState icon="🌿" title="Підгруп ще немає" />
            ) : org.children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.listCard}
                onPress={() => navigation.push('OrgDetail', {
                  orgId: child.id,
                  parentPath: [...childParentPath, { id: org.id, name: org.name, parentOrgId: org.parentOrgId }],
                })}
              >
                <View style={styles.listIcon}>
                  <Ionicons name="git-branch-outline" size={19} color={Colors.warning} />
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{child.name}</Text>
                  {child.description ? <Text style={styles.cardSubtitle} numberOfLines={2}>{child.description}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!myMembership && <Button title="Вступити" onPress={() => orgsApi.join(orgId).then(() => Alert.alert('Успіх', 'Запит на вступ надіслано'))} />}

        {isAdmin && !privileges?.isLeader && <Text style={styles.adminNote}>Адміністраторський доступ</Text>}
        {myMembership && !isLeader && <Button title="Покинути" variant="danger" onPress={() => orgsApi.leave(orgId).then(goBack)} />}

        <ConfirmDeleteModal
          visible={deleteModal.visible}
          targetName={deleteModal.targetName}
          title={deleteModal.title}
          onClose={() => setDeleteModal((prev) => ({ ...prev, visible: false }))}
          onConfirm={() => {
            deleteModal.onConfirm();
            setDeleteModal((prev) => ({ ...prev, visible: false }));
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  headerActions: { flexDirection: 'row', gap: 12 },
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 12,
  },
  heroTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  orgIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  orgLogo: { width: '100%', height: '100%' },
  banner: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    marginBottom: 16,
    resizeMode: 'cover',
  },
  heroTextWrap: { flex: 1 },
  kicker: { color: Colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  heroTitle: { color: Colors.text, fontSize: 21, fontWeight: '800', marginTop: 2 },
  pathBox: {
    marginTop: 14,
    padding: 10,
    borderRadius: 10,
    backgroundColor: Colors.borderLight,
  },
  pathLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  pathRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pathChip: {
    maxWidth: 150,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: Colors.surface,
  },
  pathChipCurrent: { backgroundColor: Colors.primary },
  pathChipMuted: { backgroundColor: 'transparent', paddingHorizontal: 2 },
  pathText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '700' },
  pathTextCurrent: { color: '#fff' },
  descText: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 14 },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 12,
  },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statNum: { fontSize: 19, fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textMuted },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.borderLight,
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  tabActive: { backgroundColor: Colors.surface },
  tabText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: Colors.primary },
  actionButton: { marginBottom: 12 },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: Colors.surface,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.secondaryLight,
  },
  memberAvatarText: { color: Colors.secondary, fontWeight: '800' },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    backgroundColor: Colors.surface,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  listIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.borderLight,
  },
  hubThumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: Colors.borderLight },
  cardText: { flex: 1 },
  cardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  cardSubtitle: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  memberActions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  adminNote: { textAlign: 'center', color: Colors.primary, marginBottom: 10, fontWeight: '700' },
});