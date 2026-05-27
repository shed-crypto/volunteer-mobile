import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getServerReachable } from '../../api/axios';
import { orgsApi } from '../../api/orgs.api';
import { requestsApi } from '../../api/requests.api';
import { OrganizationService } from '../../db/OrganizationService';
import { collections } from '../../db';
import { Q } from '@nozbe/watermelondb';
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
  tags?: string[];
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
  tags?: string[];
}

type RouteParams = { orgId: string; parentPath?: OrgNode[] };
type OrgTab = 'members' | 'hubs' | 'groups' | 'requests_tab';
type RequestsSubTab = 'active' | 'incoming' | 'completed';

const ORG_ROLE_LABELS: Record<string, string> = {
  leader: 'Лідер',
  coordinator: 'Координатор',
  member: 'Учасник',
};

const TAB_CONFIG: Record<OrgTab, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  members: { label: 'Учасники', icon: 'people-outline' },
  hubs: { label: 'Хаби', icon: 'cube-outline' },
  groups: { label: 'Підгрупи', icon: 'git-branch-outline' },
  requests_tab: { label: 'Заявки', icon: 'document-text-outline' },
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
  const [orgRequests, setOrgRequests] = useState<any[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [activeReqTasks, setActiveReqTasks] = useState<Record<string, any[]>>({});
  const [activeRequestsLoading, setActiveRequestsLoading] = useState(false);
  const [completedRequests, setCompletedRequests] = useState<any[]>([]);
  const [completedRequestsLoading, setCompletedRequestsLoading] = useState(false);
  const [delegations, setDelegations] = useState<any[]>([]);
  const [delegationsLoading, setDelegationsLoading] = useState(false);
  const [requestsSubTab, setRequestsSubTab] = useState<RequestsSubTab>('active');
  const hasLoadedRef = useRef(false);
  const [deleteModal, setDeleteModal] = useState<{ visible: boolean; targetName: string; onConfirm: () => void; title?: string }>({
    visible: false,
    targetName: '',
    onConfirm: () => {},
  });

  const fetchDelegations = useCallback(async () => {
    if (!orgId) return;
    setDelegationsLoading(true);
    try {
      const data = await orgsApi.getDelegations(orgId);
      setDelegations(data);
    } catch {
      // delegations tab is optional
    } finally {
      setDelegationsLoading(false);
    }
  }, [orgId]);

  const fetchOrg = useCallback(async (options?: { showLoader?: boolean }) => {
    if (!orgId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (options?.showLoader) setLoading(true);

    try {
      if (!getServerReachable()) {
        throw new Error('offline');
      }
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
      // Одразу завантажуємо делегування після організації
      fetchDelegations();
    } catch (e: any) {
      // Offline fallback: читаємо з локальної БД
      if (orgId) {
        try {
          const localOrgs = await OrganizationService.getMyLocal();
          const localOrg = localOrgs.find((o: any) => o.serverId === orgId);
          if (localOrg) {
            const localMembers = await OrganizationService.getMembersForOrg(orgId);
            const localHubs = await OrganizationService.getHubsForOrg(orgId);
            setOrg({
              id: (localOrg as any).serverId,
              name: (localOrg as any).name,
              description: (localOrg as any).description,
              logoUrl: (localOrg as any).logoUrl,
              members: localMembers.map((m: any) => ({
                id: (m as any).serverId,
                userId: (m as any).userId,
                orgRole: (m as any).orgRole,
                isActive: (m as any).isActive,
                isDeputy: (m as any).isDeputy,
                user: { id: (m as any).userId, fullName: (m as any).userName || 'Користувач', systemRole: '', email: '' },
              })),
              hubs: localHubs.map((h: any) => ({
                id: (h as any).serverId,
                name: (h as any).name,
                address: (h as any).address,
                latitude: (h as any).latitude,
                longitude: (h as any).longitude,
                description: (h as any).description,
                mediaUrl: (h as any).mediaUrl,
              })),
              children: [],
              parentOrgId: (localOrg as any).parentOrgId,
              tags: (localOrg as any).tags,
            } as OrgDetail);
            hasLoadedRef.current = true;
            return;
          }
        } catch (localErr) {
          console.warn('[OrgDetail] Local DB fallback failed', localErr);
        }
      }
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося завантажити організацію');
      if (navigation.canGoBack()) navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation, orgId, parentPath.length, fetchDelegations]);

  const fetchRequests = useCallback(async () => {
    if (!orgId) return;
    setRequestsLoading(true);
    try {
      const data = await orgsApi.getRequests(orgId);
      setOrgRequests(data);
    } catch {
      // requests tab is optional, ignore errors
    } finally {
      setRequestsLoading(false);
    }
  }, [orgId]);

  const myMembership = org?.members?.find((m) => m.userId === user?.id);
  const myMembershipOrgRole = myMembership?.orgRole;
  const isAdmin = user?.systemRole === 'admin';
  const isLeader = privileges?.isLeader ?? false;
  // В offline-режимі визначаємо права з локальної ролі
  const canManage = isAdmin || (privileges?.canEdit ?? false) ||
    (myMembershipOrgRole === 'leader' || myMembershipOrgRole === 'coordinator');

  useFocusEffect(
    useCallback(() => {
      fetchOrg({ showLoader: !hasLoadedRef.current });
    }, [fetchOrg]),
  );

  // Завантажуємо делегування як тільки orgId відомий
  useEffect(() => {
    if (orgId && hasLoadedRef.current) {
      fetchDelegations();
    }
  }, [orgId, fetchDelegations]);

  const fetchActiveRequests = useCallback(async () => {
    if (!orgId) return;
    setActiveRequestsLoading(true);
    try {
      if (!getServerReachable()) {
        throw new Error('offline');
      }
      const data = await requestsApi.getAll({
        managingOrganizationId: orgId,
        limit: 50,
      });
      const filtered = data.filter((r: any) =>
        !['completed', 'cancelled'].includes(r.status)
      );
      setActiveRequests(filtered);
      // Fetch tasks for each active request
      const tasksMap: Record<string, any[]> = {};
      await Promise.all(
        filtered.map(async (req: any) => {
          try {
            const full = await requestsApi.getOne(req.id);
            tasksMap[req.id] = (full as any).tasks || [];
          } catch { tasksMap[req.id] = []; }
        })
      );
      setActiveReqTasks(tasksMap);
    } catch {
      // Offline fallback: читаємо з локальної БД
      try {
        const allLocal = await collections.requests.query().fetch();
        const localActive = (allLocal as any[]).filter(
          (r: any) => r.managingOrganizationId === orgId && r.isSynced &&
            !['completed', 'cancelled'].includes(r.status)
        );
        setActiveRequests(localActive.map((r: any) => ({
          id: r.serverId,
          title: r.title,
          status: r.status,
          category: r.category,
          urgency: r.urgency,
        })));
      } catch (localErr) {
        // silent
      }
    } finally {
      setActiveRequestsLoading(false);
    }
  }, [orgId]);

  const fetchCompletedRequests = useCallback(async () => {
    if (!orgId) return;
    setCompletedRequestsLoading(true);
    try {
      if (!getServerReachable()) {
        throw new Error('offline');
      }
      const data = await requestsApi.getAll({
        managingOrganizationId: orgId,
        limit: 50,
      });
      setCompletedRequests(data.filter((r: any) =>
        ['completed', 'cancelled'].includes(r.status)
      ));
    } catch {
      // Offline fallback: читаємо з локальної БД
      try {
        const allLocal = await collections.requests.query().fetch();
        const localCompleted = (allLocal as any[]).filter(
          (r: any) => r.managingOrganizationId === orgId && r.isSynced &&
            ['completed', 'cancelled'].includes(r.status)
        );
        setCompletedRequests(localCompleted.map((r: any) => ({
          id: r.serverId,
          title: r.title,
          status: r.status,
          category: r.category,
          urgency: r.urgency,
        })));
      } catch (localErr) {
        // silent
      }
    } finally {
      setCompletedRequestsLoading(false);
    }
  }, [orgId]);

  // Завантажуємо дані при виборі вкладки та підвкладки
  useEffect(() => {
    if (tab === 'requests_tab') {
      if (requestsSubTab === 'active') {
        fetchActiveRequests();
      } else if (requestsSubTab === 'incoming') {
        fetchDelegations();
      } else if (requestsSubTab === 'completed') {
        fetchCompletedRequests();
      }
    }
  }, [tab, requestsSubTab, fetchActiveRequests, fetchDelegations, fetchCompletedRequests]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrg({ showLoader: false });
  }, [fetchOrg]);
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

  const roleLabel = myMembership ? ORG_ROLE_LABELS[myMembership.orgRole] ?? 'Учасник' : undefined;
  const isSubgroup = lineage.length > 1;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={org.name}
        onBack={goBack}
        subtitle={roleLabel}
        rightAction={
          <View style={styles.headerActions}>
            {org.chatId && myMembership && (
              <TouchableOpacity onPress={() => navigation.navigate('Chats', { screen: 'ChatRoom', params: { chatId: org.chatId } })}>
                <Ionicons name="chatbubble-ellipses-outline" size={24} color="#fff" />
              </TouchableOpacity>
            )}
            {!org.chatId && canManage && (
              <TouchableOpacity onPress={() =>
                Alert.alert('Створити чат', 'Створити чат для цієї організації?', [
                  { text: 'Ні', style: 'cancel' },
                  {
                    text: 'Так',
                    onPress: () => orgsApi.createChat(orgId).then(() => fetchOrg({ showLoader: false })),
                  },
                ])
              }>
                <Ionicons name="chatbubble-ellipses-outline" size={24} color="#fff" />
              </TouchableOpacity>
            )}
            {canManage && (
              <>
                <TouchableOpacity onPress={() => navigation.navigate('OrgJoinRequests', { orgId })}>
                  <Ionicons name="mail-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('OrgSettings', { orgId })}>
                  <Ionicons name="settings-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('OrgEdit', { orgId })}>
                  <Ionicons name="create-outline" size={24} color="#fff" />
                </TouchableOpacity>
              </>
            )}
          </View>
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
          {org.tags && org.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 }}>
              {org.tags.map((tag, i) => (
                <View key={i} style={{ backgroundColor: "#E3F2FD", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, color: "#1976D2", fontWeight: "700" }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
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

        {tab === 'requests_tab' && (
          <View>
            {/* Сегмент-контрол для підвкладок */}
            <View style={styles.subTabBar}>
              {(['active', 'incoming', 'completed'] as RequestsSubTab[])
                .filter(st => canManage || st !== 'incoming')
                .map((st) => (
                <TouchableOpacity
                  key={st}
                  style={[styles.subTab, requestsSubTab === st && styles.subTabActive]}
                  onPress={() => setRequestsSubTab(st)}
                >
                  <Text style={[styles.subTabText, requestsSubTab === st && styles.subTabTextActive]}>
                    {st === 'active' ? 'Активні' : st === 'incoming' ? 'Вхідні' : 'Завершені'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {requestsSubTab === 'active' && (
              <View>
                {activeRequestsLoading ? (
                  <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 20 }} />
                ) : activeRequests.length === 0 ? (
                  <EmptyState icon="📄" title="Немає активних заявок" subtitle="Заявки, якими керує організація, з'являться тут" />
                ) : activeRequests.map((req) => (
                  <View key={req.id}>
                    <TouchableOpacity
                      style={styles.listCard}
                      onPress={() => navigation.navigate('RequestDetail', { requestId: req.id })}
                    >
                      <View style={styles.listIcon}>
                        <Ionicons name="flame-outline" size={19} color={Colors.primary} />
                      </View>
                      <View style={styles.cardText}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{req.title ?? 'Без назви'}</Text>
                        <Text style={styles.cardSubtitle} numberOfLines={1}>
                          {req.status ?? 'open'} {req.category ? `· ${req.category}` : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                    {activeReqTasks[req.id]?.length > 0 && (
                      <View style={{ paddingLeft: 52, paddingVertical: 4 }}>
                        {activeReqTasks[req.id].map((task: any) => (
                          <TouchableOpacity
                            key={task.id}
                            onPress={() => navigation.navigate('TaskDetail', { taskId: task.id })}
                          >
                            <Text style={{ color: Colors.primary, fontSize: 13, marginVertical: 2 }}>• {task.title ?? 'Таск'}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {requestsSubTab === 'incoming' && (
              <View>
                {delegationsLoading ? (
                  <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 20 }} />
                ) : delegations.length === 0 ? (
                  <EmptyState icon="🔀" title="Немає вхідних делегувань" subtitle="Коли інші організації делегують вам задачі, вони з'являться тут" />
                ) : (
                  <TouchableOpacity onPress={() => { fetchDelegations(); }} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: Colors.primary, fontWeight: '600' }}>Оновити</Text>
                  </TouchableOpacity>
                )}
                {delegations.map((del) => (
                  <View key={del.id} style={styles.listCard}>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                      activeOpacity={0.7}
                      onPress={() => {
                        if (del.task?.requestId) {
                          navigation.navigate('RequestDetail', { requestId: del.task.requestId });
                        } else if (del.task?.id) {
                          navigation.navigate('TaskDetail', { taskId: del.task.id });
                        }
                      }}
                    >
                      <View style={styles.listIcon}>
                        <Ionicons name="git-network-outline" size={19} color={Colors.warning} />
                      </View>
                      <View style={styles.cardText}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {del.task?.title || 'Задача'}
                        </Text>
                        <Text style={styles.cardSubtitle}>
                          {del.delegatedBy?.fullName || 'Невідомо'} • {new Date(del.delegatedAt).toLocaleDateString('uk-UA')}
                        </Text>
                        {del.isAccepted === null && (
                          <Text style={[styles.cardSubtitle, { color: Colors.warning, fontWeight: '700', marginTop: 4 }]}>⏳ Очікує підтвердження</Text>
                        )}
                        {del.isAccepted === true && (
                          <Text style={[styles.cardSubtitle, { color: Colors.success, fontWeight: '700', marginTop: 4 }]}>✓ Прийнято</Text>
                        )}
                        {del.isAccepted === false && (
                          <Text style={[styles.cardSubtitle, { color: Colors.danger, fontWeight: '700', marginTop: 4 }]}>✗ Відхилено</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                    <View style={{ gap: 4 }}>
                      {del.isAccepted === null && (
                        <>
                          <Button
                            title="✓"
                            size="sm"
                            onPress={() => {
                              orgsApi.acceptDelegation(del.taskId, orgId)
                                .then(() => {
                                  Alert.alert('✓', 'Делегування прийнято');
                                  fetchDelegations();
                                })
                                .catch((e: any) => Alert.alert('Помилка', e?.response?.data?.message || ''));
                            }}
                          />
                          <Button
                            title="✗"
                            variant="danger"
                            size="sm"
                            onPress={() => {
                              orgsApi.declineDelegation(del.taskId, orgId)
                                .then(() => { Alert.alert('✗', 'Делегування відхилено'); fetchDelegations(); })
                                .catch((e: any) => Alert.alert('Помилка', e?.response?.data?.message || ''));
                            }}
                          />
                        </>
                      )}
                      {del.isAccepted === true && (
                        <Button
                          title="↩ Скасувати"
                          variant="outline"
                          size="sm"
                          onPress={() => {
                            Alert.alert('Скасувати?', 'Повернути делегування в статус очікування?', [
                              { text: 'Ні', style: 'cancel' },
                              { text: 'Так', onPress: () => {
                                orgsApi.unacceptDelegation(del.taskId, orgId)
                                  .then(() => { Alert.alert('↩', 'Прийняття скасовано'); fetchDelegations(); })
                                  .catch((e: any) => Alert.alert('Помилка', e?.response?.data?.message || ''));
                              }},
                            ]);
                          }}
                        />
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {requestsSubTab === 'completed' && (
              <View>
                {completedRequestsLoading ? (
                  <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 20 }} />
                ) : completedRequests.length === 0 ? (
                  <EmptyState icon="✅" title="Немає завершених заявок" />
                ) : completedRequests.map((req) => (
                  <TouchableOpacity
                    key={req.id}
                    style={styles.listCard}
                    onPress={() => navigation.navigate('RequestDetail', { requestId: req.id })}
                  >
                    <View style={styles.listIcon}>
                      <Ionicons name="checkmark-circle-outline" size={19} color={Colors.success} />
                    </View>
                    <View style={styles.cardText}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{req.title ?? 'Без назви'}</Text>
                      <Text style={styles.cardSubtitle} numberOfLines={1}>
                        {req.status ?? 'completed'} {req.category ? `· ${req.category}` : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
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
  subTabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.borderLight,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  subTab: {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  subTabActive: { backgroundColor: Colors.surface },
  subTabText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  subTabTextActive: { color: Colors.primary },
  adminNote: { textAlign: 'center', color: Colors.primary, marginBottom: 10, fontWeight: '700' },
});
