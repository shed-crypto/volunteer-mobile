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

  // ─── Load tasks ────────────────────────────────────────────────────────────
  const loadTasks = useCallback(async (requestId: string) => {
    // Спочатку шукаємо в локальній БД
    try {
      const localTasks = await collections.tasks.query().fetch();
      const requestTasks = localTasks.filter((t: any) => t.requestId === requestId || t.requestServerId === requestId);
      
      if (requestTasks.length > 0) {
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
        }));
      }
    } catch (localError) {
      console.log('Local DB lookup failed:', localError);
    }

    // Якщо немає локальних даних - повертаємо порожній масив
    return [];
  }, []);

  const load = useCallback(async () => {
    try {
      const req = await requestsApi.getOne(requestId);
      setRequest(req);
      
      // Завантажуємо задачі з сервера
      try {
        const serverTasks = await tasksApi.getByRequest(requestId);
        setTasks(serverTasks);
        
      // WatermelonDB-кеш оновить SyncService у фоні — не блокуємо UI тут
      } catch (serverError) {
        console.error('Failed to load tasks from server:', serverError);
        // Якщо не вдалося завантажити з сервера, спробуємо з локальної БД
        const localTasks = await loadTasks(requestId);
        setTasks(localTasks);
      }
    } catch (error) {
      // Спробуємо завантажити з локальної БД (offline fallback)
      try {
        // Add timeout to prevent infinite loading
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout')), 5000)
        );
        
        const localReqsPromise = collections.requests.query().fetch();
        const localReqs = await Promise.race([localReqsPromise, timeoutPromise]) as any[];
        const local = localReqs.find((r: any) => r.serverId === requestId || r.id === requestId);
        if (local) {
          setRequest({
            id: local.serverId ?? local.id,
            title: local.title,
            description: local.description ?? '',
            category: local.category as any,
            urgency: local.urgency as any,
            status: local.status as any,
            requiredClearance: local.requiredClearance as any,
            latitude: local.latitude ?? undefined,
            longitude: local.longitude ?? undefined,
            isLocationHidden: local.isLocationHidden,
            tags: local.tags,
            creatorId: local.creatorId ?? '',
            createdAt: local.createdAtServer ? new Date(local.createdAtServer).toISOString() : '',
          } as any);
          
          // Завантажуємо задачі з локальної БД
          const localTasks = await loadTasks(requestId);
          setTasks(localTasks);
        } else {
          Alert.alert('Помилка', 'Не вдалося завантажити заявку');
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate('RequestsList' as never);
        }
      } catch (dbError) {
        Alert.alert('Помилка', 'Не вдалося завантажити заявку: ' + (dbError as Error).message);
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('RequestsList' as never);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [requestId, loadTasks, navigation]);

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
