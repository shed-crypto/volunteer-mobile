import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, Platform,
  RefreshControl, StyleSheet, Linking,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { requestsApi } from '../../api/requests.api';
import { tasksApi } from '../../api/tasks.api';
import { Request, Task, TaskStatus, SystemRole, RequestStatus } from '../../types';
import {
  Colors, urgencyColors, statusColors,
  categoryLabels, clearanceLabels,
} from '../../utils/theme';
import {
  Badge, Card, Button, EmptyState,
  LoadingScreen, ScreenHeader, ProgressBar,
} from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { OfflineLogger } from '../../utils/offlineLogger';
import { collections } from '../../db/index';
import { database } from '../../db/index';

type RouteParams = { RequestDetail: { requestId: string } };

const KANBAN_COLS: { status: TaskStatus; label: string; color: string }[] = [
  { status: TaskStatus.TODO,           label: 'До роботи',    color: Colors.textMuted },
  { status: TaskStatus.IN_PROGRESS,    label: 'Виконується',  color: Colors.primary },
  { status: TaskStatus.PENDING_REVIEW, label: 'На перевірці', color: Colors.warning },
  { status: TaskStatus.DONE,           label: 'Готово ✓',     color: Colors.secondary },
];

export default function RequestDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'RequestDetail'>>();
  const { requestId } = route.params;
  const { user } = useAuth();

  const [request, setRequest] = useState<Request | null>(null);
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const { isOffline } = useNetwork();

  // ─── Load tasks from local DB ────────────────────────────────────────────
  const loadTasksLocal = useCallback(async (requestId: string): Promise<Task[]> => {
    try {
      const localTasks = await collections.tasks.query().fetch();
      const requestTasks = localTasks.filter((t: any) => t.requestId === requestId || t.requestServerId === requestId);
      
      if (requestTasks.length > 0) {
        // Load assignments for these tasks
        const localAssignments = await collections.taskAssignments.query().fetch();
        const taskAssignmentsMap = new Map<string, any[]>();
        localAssignments
          .filter((a: any) => requestTasks.some((t: any) => t.serverId === a.taskId || t.id === a.taskId))
          .forEach((a: any) => {
            const key = a.taskId;
            if (!taskAssignmentsMap.has(key)) taskAssignmentsMap.set(key, []);
            const list = taskAssignmentsMap.get(key)!;
            if (!list.find((x: any) => x.userId === a.userId)) {
              list.push({
                id: a.id,
                taskId: a.taskId,
                userId: a.userId,
                user: { fullName: a.userName || 'Користувач' },
                status: a.status,
                fulfilledRole: a.fulfilledRole,
                assignedAt: a.assignedAt ? new Date(a.assignedAt).toISOString() : '',
              });
            }
          });

        return requestTasks.map((t: any) => ({
          id: t.serverId || t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          neededPeopleCount: t.neededPeopleCount,
          requiredRoles: t.requiredRoles,
          assignedCount: t.assignedCount,
          priority: t.priority,
          createdAt: t.createdAt,
          requestId: t.requestId || t.requestServerId,
          assignments: taskAssignmentsMap.get(t.serverId) || taskAssignmentsMap.get(t.id) || [],
        }));
      }
    } catch (localError) {
      OfflineLogger.cache('Local tasks load failed:', localError);
    }
    return [];
  }, []);

  // ─── Load request from local DB ────────────────────────────────────────────
  const loadRequestLocal = useCallback(async (requestId: string): Promise<Request | null> => {
    try {
      const localReqs = await collections.requests.query().fetch();
      const local = localReqs.find((r: any) => r.serverId === requestId || r.id === requestId);
      if (local) {
        OfflineLogger.cache('Loaded request from local DB', { id: local.serverId || local.id });
        return {
          id: local.serverId ?? local.id,
          title: local.title,
          description: local.description ?? '',
          category: local.category as any,
          urgency: local.urgency as any,
          status: local.status as any,
          requiredClearance: local.requiredClearance as any,
          latitude: local.latitude != null ? local.latitude : undefined,
          longitude: local.longitude != null ? local.longitude : undefined,
          isLocationHidden: local.isLocationHidden,
          tags: local.tags,
          creatorId: local.creatorId ?? '',
          createdAt: local.createdAtServer ? new Date(local.createdAtServer).toISOString() : '',
        } as any;
      }
    } catch (e) {
      OfflineLogger.cache('Local request load failed:', e);
    }
    return null;
  }, []);

  // ─── Helper: load from local DB with timeout (migration may block query) ──
  const loadLocalWithTimeout = useCallback(async () => {
    return Promise.race([
      Promise.all([loadRequestLocal(requestId), loadTasksLocal(requestId)]),
      new Promise<[Request | null, Task[]]>((resolve) => 
        setTimeout(() => {
          OfflineLogger.cache('RequestDetail: local DB timeout (migration?)');
          resolve([null, []]);
        }, 2000)
      )
    ]);
  }, [requestId, loadRequestLocal, loadTasksLocal]);

  // ─── Helper: save request to local DB ────────────────────────────────────
  const saveRequestToDB = useCallback(async (req: Request) => {
    try {
      const existing = await collections.requests.query().fetch();
      const existingReq = existing.find((r: any) => r.serverId === req.id);
      
      if (existingReq) {
        await database.write(async () => {
          await existingReq.update((r: any) => {
            r.title = req.title;
            r.description = req.description ?? null;
            r.category = req.category;
            r.urgency = req.urgency;
            r.status = req.status;
            r.requiredClearance = req.requiredClearance ?? 'local';
            r.latitude = req.latitude ?? null;
            r.longitude = req.longitude ?? null;
            r.isLocationHidden = req.isLocationHidden ?? false;
            r.tagsRaw = JSON.stringify(req.tags ?? []);
            r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
            r.isSynced = true;
            r.pendingAction = null;
            r.lastSyncedAt = Date.now();
          });
        });
      } else {
        await database.write(async () => {
          await collections.requests.create((r: any) => {
            r.serverId = req.id;
            r.title = req.title;
            r.description = req.description ?? null;
            r.category = req.category;
            r.urgency = req.urgency;
            r.status = req.status;
            r.requiredClearance = req.requiredClearance ?? 'local';
            r.creatorId = req.creatorId ?? null;
            r.latitude = req.latitude ?? null;
            r.longitude = req.longitude ?? null;
            r.isLocationHidden = req.isLocationHidden ?? false;
            r.tagsRaw = JSON.stringify(req.tags ?? []);
            r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
            r.createdAtServer = req.createdAt ? new Date(req.createdAt).getTime() : Date.now();
            r.isSynced = true;
            r.pendingAction = null;
            r.lastSyncedAt = Date.now();
          });
        });
      }
      OfflineLogger.cache(`RequestDetail: saved request ${req.id} to DB`);
    } catch (e) {
      OfflineLogger.cache('RequestDetail: save request to DB failed', e);
    }
  }, []);

  // ─── Helper: save tasks to local DB ──────────────────────────────────────
  const saveTasksToDB = useCallback(async (taskList: Task[]) => {
    try {
      const existing = await collections.tasks.query().fetch();
      const existingMap = new Map(existing.map((t: any) => [t.serverId, t]));
      const operations: any[] = [];

      for (const task of taskList) {
        const existingTask = existingMap.get(task.id);
        if (existingTask) {
          operations.push(
            existingTask.prepareUpdate((t: any) => {
              t.title = task.title;
              t.description = task.description ?? null;
              t.status = task.status;
              t.neededPeopleCount = task.neededPeopleCount;
              t.requiredRolesRaw = JSON.stringify(task.requiredRoles ?? []);
              t.assignedCount = task.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
              t.priority = task.priority ?? 0;
              t.deadline = task.deadline ? new Date(task.deadline).getTime() : null;
              t.isSynced = true;
              t.pendingAction = null;
              t.lastSyncedAt = Date.now();
            })
          );
        } else {
          operations.push(
            collections.tasks.prepareCreate((t: any) => {
              t.serverId = task.id;
              t.requestServerId = requestId;
              t.title = task.title;
              t.description = task.description ?? null;
              t.status = task.status;
              t.neededPeopleCount = task.neededPeopleCount ?? 1;
              t.requiredRolesRaw = JSON.stringify(task.requiredRoles ?? []);
              t.assignedCount = task.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
              t.priority = task.priority ?? 0;
              t.deadline = task.deadline ? new Date(task.deadline).getTime() : null;
              t.isSynced = true;
              t.pendingAction = null;
              t.lastSyncedAt = Date.now();
            })
          );
        }
      }

      if (operations.length > 0) {
        await database.write(async () => {
          await database.batch(...operations);
        });
        OfflineLogger.cache(`RequestDetail: saved ${operations.length} tasks to DB`);
      }
    } catch (e) {
      OfflineLogger.cache('RequestDetail: save tasks to DB failed', e);
    }
  }, [requestId]);

  // ─── Main load: OFFLINE-FIRST ────────────────────────────────────────────
  const load = useCallback(async () => {
    OfflineLogger.nav(`RequestDetailScreen.load() called, requestId=${requestId}`);
    
    try {
      // КРОК 1: Завантажити з локальної БД (з АДАПТИВНИМ таймаутом)
      // Онлайн: 300мс, Офлайн: 2000мс
      const timeout = isOffline ? 2000 : 300;
      const [localRequest, localTasks] = await Promise.race([
        Promise.all([loadRequestLocal(requestId), loadTasksLocal(requestId)]),
        new Promise<[null, []]>((resolve) => 
          setTimeout(() => {
            OfflineLogger.cache(`RequestDetail: local DB timeout (${timeout}ms)`);
            resolve([null, []]);
          }, timeout)
        )
      ]);
      
      if (localRequest) {
        OfflineLogger.nav('Showing local data first (offline-first)');
        setRequest(localRequest);
        setTasks(localTasks);
        setIsOfflineMode(true);
        setLoading(false);
      }

      // КРОК 2: Якщо є мережа — оновити з сервера
      if (!isOffline) {
        try {
          OfflineLogger.nav('Fetching from server...');
          const req = await requestsApi.getOne(requestId);
          setRequest(req);
          setIsOfflineMode(false);
          
          // ЗБЕРЕГТИ заявку в БД
          await saveRequestToDB(req);
          
          try {
            const serverTasks = await tasksApi.getByRequest(requestId);
            setTasks(serverTasks);
            // ЗБЕРЕГТИ задачі в БД
            await saveTasksToDB(serverTasks);
          } catch (serverTaskError) {
            OfflineLogger.network('Server tasks failed, keeping local tasks');
            // Залишаємо локальні задачі
          }
        } catch (serverError) {
          OfflineLogger.network('Server request failed:', serverError);
          if (!localRequest) {
            // Немає ні локальних, ні серверних даних
            Alert.alert('Помилка', 'Не вдалося завантажити заявку');
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('RequestsList' as never);
          }
        }
      } else {
        OfflineLogger.nav('Offline — showing cached data only');
      }
    } catch (e) {
      OfflineLogger.nav('RequestDetail: unexpected error', e);
    } finally {
      // КРИТИЧНО: завжди знімати loading
      setLoading(false);
      setRefreshing(false);
    }
  }, [requestId, loadRequestLocal, loadTasksLocal, navigation, isOffline, saveRequestToDB, saveTasksToDB]);

  useEffect(() => { load(); }, [load]);

  const handleCancelRequest = async () => {
    Alert.alert('Скасувати заявку?', 'Цю дію неможливо відмінити.', [
      { text: 'Ні' },
      {
        text: 'Так, скасувати', style: 'destructive',
        onPress: async () => {
          await requestsApi.update(requestId, { status: RequestStatus.CANCELLED });
          load();
        },
      },
    ]);
  };

  if (loading) return <LoadingScreen />;
  if (!request) return null;

  const doneTasks  = tasks.filter((t) => t.status === TaskStatus.DONE).length;
  const totalTasks = tasks.length;
  const urgency    = urgencyColors[request.urgency];
  const status     = statusColors[request.status];

  const isOwner = user?.id === request.creatorId;
  const isAdmin = user?.systemRole === SystemRole.ADMIN;
  const isCoord = user?.systemRole === SystemRole.COORDINATOR;
  const canManage = isOwner || isAdmin;
  const canCreateTask = isOwner || isAdmin || isCoord;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title="Деталі заявки"
        onBack={() => navigation.goBack()}
      />

      {isOfflineMode && (
        <View style={{ backgroundColor: Colors.warningLight, padding: 8, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: Colors.warning }}>
            📴 Офлайн режим — показано кешовані дані
          </Text>
        </View>
      )}
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Main info card */}
        <Card style={{ marginTop: 16 }}>
          <View style={[styles.urgencyStrip, { backgroundColor: urgency?.bg }]} />

          <Text style={styles.title}>{request.title}</Text>

          <View style={styles.badgeRow}>
            <Badge label={urgency?.label ?? request.urgency} colorScheme="urgency" value={request.urgency} />
            <Badge label={status?.label  ?? request.status}  colorScheme="status"  value={request.status} />
            <Badge label={categoryLabels[request.category] ?? request.category} />
          </View>

          {request.description ? (
            <Text style={styles.description}>{request.description}</Text>
          ) : null}

          {/* Meta rows */}
          <View style={styles.metaList}>
            <MetaRow icon="🔒" label="Допуск" value={clearanceLabels[request.requiredClearance] ?? request.requiredClearance} />
            {request.deadline && (
              <MetaRow icon="⏰" label="Дедлайн" value={new Date(request.deadline).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })} />
            )}
            {request.latitude ? (
              <LocationDisplay request={request} />
            ) : null}
            {request.fundraisingUrl && (
              <TouchableOpacity onPress={() => Linking.openURL(request.fundraisingUrl!)}>
                <MetaRow icon="💳" label="Збір" value="Перейти до збору коштів →" highlight />
              </TouchableOpacity>
            )}
          </View>

          {/* Tags */}
          {request.tags?.filter(Boolean).length > 0 && (
            <View style={styles.tagRow}>
              {request.tags.filter(Boolean).map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Progress */}
        {totalTasks > 0 && (
          <Card>
            <View style={styles.progressHeader}>
              <Text style={styles.sectionTitle}>Прогрес виконання</Text>
              <Text style={styles.progressCount}>{doneTasks}/{totalTasks}</Text>
            </View>
            <ProgressBar value={doneTasks} total={totalTasks} color={Colors.secondary} />
            <Text style={styles.progressPct}>
              {totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}% завершено
            </Text>
          </Card>
        )}

        {/* Kanban board */}
        <View style={styles.kanbanHeader}>
          <Text style={styles.sectionTitle}>Kanban-дошка підзадач</Text>
          {canCreateTask && (
            <TouchableOpacity
              style={styles.addTaskBtn}
              onPress={() => navigation.navigate('TaskDetail', { taskId: '__new__', requestId, requestTitle: request.title })}
            >
              <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 13 }}>+ Додати</Text>
            </TouchableOpacity>
          )}
        </View>

        {tasks.length === 0 ? (
          <EmptyState icon="📌" title="Підзадач немає" subtitle={canCreateTask ? 'Натисніть «+ Додати» для декомпозиції' : 'Координатор ще не розбив заявку на підзадачі'} />
        ) : (
          KANBAN_COLS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            if (colTasks.length === 0) return null;
            return (
              <View key={col.status} style={{ marginHorizontal: 16, marginBottom: 12 }}>
                <View style={styles.colHeader}>
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text style={[styles.colTitle, { color: col.color }]}>{col.label}</Text>
                  <Text style={styles.colCount}>{colTasks.length}</Text>
                </View>
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    requestTitle={request.title}
                    onPress={() => navigation.navigate('TaskDetail', { taskId: task.id, requestTitle: request.title })}
                    onRefresh={load}
                    currentUserId={user?.id ?? ''}
                    userRole={user?.systemRole ?? SystemRole.VOLUNTEER}
                  />
                ))}
              </View>
            );
          })
        )}

        {/* Actions */}
        {canManage && request.status !== RequestStatus.CANCELLED && request.status !== RequestStatus.COMPLETED && (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <Button title="Скасувати заявку" variant="danger" onPress={handleCancelRequest} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function LocationDisplay({ request }: { request: Request }) {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (request.isLocationHidden) {
          setAddress('Приблизне розташування');
        } else {
          const results = await Location.reverseGeocodeAsync({ 
            latitude: Number(request.latitude), 
            longitude: Number(request.longitude) 
          });
          if (results.length > 0) {
            const addr = results[0];
            setAddress([addr.city, addr.region, addr.street].filter(Boolean).join(', '));
          } else {
            setAddress(`${Number(request.latitude).toFixed(4)}, ${Number(request.longitude).toFixed(4)}`);
          }
        }
      } catch {
        setAddress(`${Number(request.latitude).toFixed(4)}, ${Number(request.longitude).toFixed(4)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [request]);

  if (loading) return <MetaRow icon="📍" label="Місце" value="Завантаження..." />;

  const lat = Number(request.latitude);
  const lng = Number(request.longitude);
  const label = encodeURIComponent(request.title);
  const url = Platform.OS === 'ios'
    ? `maps:0,0?q=${label}@${lat},${lng}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;

  return (
    <TouchableOpacity onPress={() => Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`))}>
      <MetaRow 
        icon="📍" 
        label="Місце" 
        value={`${address || ''} (${lat.toFixed(4)}, ${lng.toFixed(4)}) → відкрити в картах`} 
        highlight 
      />
    </TouchableOpacity>
  );
}

function MetaRow({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
      <Text style={{ fontSize: 14 }}>{icon}</Text>
      <Text style={{ fontSize: 13, color: Colors.textSecondary, width: 64 }}>{label}:</Text>
      <Text style={{ fontSize: 13, color: highlight ? Colors.primary : Colors.text, flex: 1, fontWeight: highlight ? '600' : '400' }}>{value}</Text>
    </View>
  );
}

function TaskCard({ task, onPress, onRefresh, currentUserId, userRole, requestTitle }: {
  task: Task;
  requestTitle: string;
  onPress: () => void;
  onRefresh: () => void;
  currentUserId: string;
  userRole: SystemRole;
}) {
  const [actioning, setActioning] = useState(false);
  const isAssigned = task.assignments?.some((a) => a.userId === currentUserId && a.status !== 'withdrawn');
  const isFull = (task.assignments?.filter((a) => a.status !== 'withdrawn').length ?? 0) >= task.neededPeopleCount;
  const st = statusColors[task.status];

  const handleAssign = async () => {
    setActioning(true);
    try {
      if (isAssigned) {
        await tasksApi.withdraw(task.id);
      } else {
        await tasksApi.assign(task.id);
      }
      onRefresh();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Спробуйте ще раз');
    } finally {
      setActioning(false);
    }
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View style={styles.taskCard}>
        <View style={styles.taskHeader}>
          <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
          <Badge label={st?.label ?? task.status} colorScheme="status" value={task.status} size="sm" />
        </View>

        <View style={styles.taskMeta}>
          <Text style={styles.taskMetaText}>👥 {task.assignments?.filter((a) => a.status !== 'withdrawn').length ?? 0}/{task.neededPeopleCount}</Text>
          {task.requiredRoles?.filter(Boolean).length > 0 && (
            <Text style={styles.taskMetaText}>🎭 {task.requiredRoles.filter(Boolean).join(', ')}</Text>
          )}
          {task.deadline && (
            <Text style={[styles.taskMetaText, { color: Colors.warning }]}>
              ⏰ {new Date(task.deadline).toLocaleDateString('uk-UA')}
            </Text>
          )}
        </View>

        <ProgressBar value={task.assignments?.filter((a) => a.status !== 'withdrawn').length ?? 0} total={task.neededPeopleCount} />

        {/* Only volunteers can take tasks */}
        {(userRole === SystemRole.VOLUNTEER || userRole === SystemRole.COORDINATOR) &&
          task.status === TaskStatus.TODO && (
          <TouchableOpacity
            style={[styles.assignBtn, isAssigned && styles.assignBtnActive, (isFull && !isAssigned) && styles.assignBtnDisabled]}
            onPress={handleAssign}
            disabled={actioning || (isFull && !isAssigned)}
          >
            <Text style={[styles.assignBtnText, isAssigned && { color: Colors.danger }]}>
              {actioning ? '...' : isAssigned ? 'Відмовитися' : isFull ? 'Слоти заповнені' : '✋ Взяти в роботу'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  urgencyStrip: { height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', color: Colors.text, marginBottom: 10, lineHeight: 24 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  description: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  metaList: { marginTop: 4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { backgroundColor: Colors.primaryLight, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressCount: { fontSize: 16, fontWeight: '700', color: Colors.secondary },
  progressPct: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  kanbanHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 8, marginBottom: 4 },
  addTaskBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primaryLight },
  colHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  colTitle: { fontSize: 13, fontWeight: '700' },
  colCount: { marginLeft: 'auto', fontSize: 12, color: Colors.textMuted, backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  taskCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.borderLight,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  taskTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text },
  taskMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  taskMetaText: { fontSize: 12, color: Colors.textSecondary },
  assignBtn: {
    marginTop: 8, borderRadius: 8, paddingVertical: 8,
    alignItems: 'center', backgroundColor: Colors.primaryLight,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  assignBtnActive: { backgroundColor: Colors.dangerLight, borderColor: Colors.danger },
  assignBtnDisabled: { backgroundColor: Colors.borderLight, borderColor: Colors.border },
  assignBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
});
