import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, StyleSheet, Modal, FlatList,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { tasksApi } from '../../api/tasks.api';
import { orgsApi } from '../../api/orgs.api';
import { API_BASE_URL } from '../../api/axios';
import {
  Task, TaskStatus, AssignmentStatus,
  SystemRole, Organization,
} from '../../types';
import { Colors, statusColors } from '../../utils/theme';
import {
  Badge, Card, Button, LoadingScreen,
  ScreenHeader, Input, ProgressBar,
} from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { TaskReportModal } from '../../components/TaskReportModal';
import { fileUtils } from '../../utils/fileUtils';

type RouteParams = {
  TaskDetail: { taskId: string; requestId?: string; requestTitle?: string };
};

/** Будує абсолютний URL для файлу зі збереженого відносного шляху */
function buildFileUrl(relativePath: string): string {
  // API_BASE_URL = 'http://host:3000/api' → baseUrl = 'http://host:3000'
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
  // relativePath завжди починається з '/' ('/uploads/reports/...')
  return `${base}${relativePath}`;
}

export default function TaskDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'TaskDetail'>>();
  const { taskId, requestId, requestTitle } = route.params;
  const { user } = useAuth();

  const isNew = taskId === '__new__';

  const [task, setTask]           = useState<Task | null>(null);
  const [loading, setLoading]     = useState(!isNew);
  const [actioning, setActioning] = useState(false);

  // Delegation modal state
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [orgs, setOrgs]                           = useState<Organization[]>([]);
  const [delegating, setDelegating]               = useState(false);

  // Create form state
  const [newTitle, setNewTitle]   = useState('');
  const [newDesc, setNewDesc]     = useState('');
  const [newPeople, setNewPeople] = useState('1');
  const [newRoles, setNewRoles]   = useState('');
  const [creating, setCreating]   = useState(false);

  // Report state
  const [showReportModal, setShowReportModal] = useState(false);
  const [uploading, setUploading]             = useState(false);
  const [reports, setReports]                 = useState<any[]>([]);

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const t = await tasksApi.getOne(taskId);
      setTask(t);
    } catch {
      Alert.alert('Помилка', 'Не вдалося завантажити підзадачу');
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('RequestsList' as never);
    } finally {
      setLoading(false);
    }
  }, [taskId, isNew]);

  useEffect(() => { load(); }, [load]);

  // Завантажуємо звіти щоразу, коли змінюється task
  useEffect(() => {
    if (!task) return;
    import('../../api/task-reports.api')
      .then((mod) => mod.taskReportsApi.getAll(task.id))
      .then(setReports)
      .catch(() => {}); // Не критично — просто не показуємо звіти
  }, [task]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newTitle.trim() || newTitle.trim().length < 3) {
      Alert.alert('', 'Назва — мін. 3 символи');
      return;
    }
    if (!requestId) return;
    setCreating(true);
    try {
      await tasksApi.create(requestId, {
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        neededPeopleCount: parseInt(newPeople) || 1,
        requiredRoles: newRoles.split(',').map((r) => r.trim()).filter(Boolean),
      });
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('RequestsList' as never);
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Щось пішло не так');
    } finally {
      setCreating(false);
    }
  };

  const handleAssign = async () => {
    if (!task) return;
    setActioning(true);
    try {
      const isMe = task.assignments?.some((a) => a.userId === user?.id && a.status !== 'withdrawn');
      if (isMe) await tasksApi.withdraw(task.id);
      else       await tasksApi.assign(task.id);
      load();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Спробуйте ще раз');
    } finally {
      setActioning(false);
    }
  };

  /**
   * «Позначити як виконану» — ОКРЕМА дія від звіту.
   * 1. Перепитує підтвердження.
   * 2. Змінює статус задачі на PENDING_REVIEW через API.
   * 3. Після успіху пропонує додати звіт (не обов'язково).
   */
  const handleComplete = async () => {
    if (!task) return;
    Alert.alert(
      '✅ Позначити як виконану?',
      'Задача перейде в статус "На перевірці". Після цього координатор підтвердить або відхилить виконання.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Підтвердити',
          onPress: async () => {
            setActioning(true);
            try {
              await tasksApi.complete(task.id);
              await load();
              // Пропонуємо додати звіт після зміни статусу
              Alert.alert(
                '📋 Додати звіт?',
                'Бажаєте додати звіт про виконану роботу (фото, коментар)?',
                [
                  { text: 'Пізніше', style: 'cancel' },
                  { text: 'Так, додати', onPress: () => setShowReportModal(true) },
                ],
              );
            } catch (e: any) {
              Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося оновити статус');
            } finally {
              setActioning(false);
            }
          },
        },
      ],
    );
  };

  /**
   * «Додати звіт» — незалежна кнопка, яка відкриває модалку
   * без зміни статусу задачі. Доступна і під час виконання,
   * і після переходу в PENDING_REVIEW.
   */
  const handleAddReport = () => {
    setShowReportModal(true);
  };

  const handleReportSubmit = async (
    comment: string,
    attachments: Array<{ uri: string; name: string; type: string }>,
  ) => {
    if (!task) return;
    setUploading(true);
    try {
      const { taskReportsApi } = await import('../../api/task-reports.api');
      await taskReportsApi.create(task.id, comment, attachments);
      setShowReportModal(false);
      const updated = await taskReportsApi.getAll(task.id);
      setReports(updated);
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося надіслати звіт');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!task) return;
    Alert.alert(
      'Підтвердити виконання?',
      'Задача буде закрита, виконавці отримають +5 до рейтингу довіри.',
      [
        { text: 'Скасувати' },
        {
          text: 'Підтвердити ✓',
          onPress: async () => {
            setActioning(true);
            try {
              await tasksApi.confirm(task.id);
              load();
            } catch (e: any) {
              Alert.alert('Помилка', e?.response?.data?.message ?? '');
            } finally {
              setActioning(false);
            }
          },
        },
      ],
    );
  };

  const handleReject = async () => {
    if (!task) return;
    Alert.alert(
      'Відхилити виконання?',
      'Задача повернеться у статус "В роботі". Виконавці побачать коментар.',
      [
        { text: 'Скасувати' },
        {
          text: '✗ Відхилити',
          style: 'destructive',
          onPress: async () => {
            setActioning(true);
            try {
              await tasksApi.reject(task.id);
              load();
            } catch (e: any) {
              Alert.alert('Помилка', e?.response?.data?.message ?? '');
            } finally {
              setActioning(false);
            }
          },
        },
      ],
    );
  };

  const handleDelegateOpen = async () => {
    try {
      const data = await orgsApi.getAll();
      setOrgs(data);
      setShowDelegateModal(true);
    } catch {
      Alert.alert('Помилка', 'Не вдалося завантажити список організацій');
    }
  };

  const handleDelegate = async (orgId: string, orgName: string) => {
    if (!task) return;
    setDelegating(true);
    try {
      await tasksApi.delegate(task.id, orgId);
      setShowDelegateModal(false);
      Alert.alert('✓', `Задачу делеговано організації "${orgName}"`);
      load();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? '');
    } finally {
      setDelegating(false);
    }
  };

  const handleUpdateStatus = (newStatus: AssignmentStatus) => {
    if (!task) return;
    const labels: Record<string, string> = {
      en_route: '🚗 Я в дорозі',
      on_site:  '📍 Я на місці',
      assigned: '◻ Очікую',
    };
    Alert.alert('Оновити статус?', labels[newStatus] ?? newStatus, [
      { text: 'Скасувати' },
      {
        text: 'Підтвердити',
        onPress: async () => {
          setActioning(true);
          try {
            await tasksApi.updateAssignmentStatus(task.id, newStatus);
            load();
          } catch (e: any) {
            Alert.alert('Помилка', e?.response?.data?.message ?? '');
          } finally {
            setActioning(false);
          }
        },
      },
    ]);
  };

  const handleOpenAttachment = async (a: { url: string; name: string; type: string }) => {
    const absoluteUrl = buildFileUrl(a.url);
    if (a.type?.startsWith('image/')) {
      fileUtils.previewImage(absoluteUrl);
    } else {
      fileUtils.downloadAndOpenFile(absoluteUrl, a.name, a.type);
    }
  };

  // ─── Create mode ─────────────────────────────────────────────────────────
  if (isNew) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <ScreenHeader
          title="Нова підзадача"
          subtitle={requestTitle}
          onBack={() => navigation.goBack()}
        />
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Input label="Назва підзадачі *" value={newTitle} onChangeText={setNewTitle}
            placeholder="Наприклад: Знайти мікроавтобус" />
          <Input label="Опис" value={newDesc} onChangeText={setNewDesc}
            placeholder="Деталі..." multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
          <Input label="Потрібно волонтерів" value={newPeople} onChangeText={setNewPeople}
            keyboardType="number-pad" placeholder="1" />
          <Input label="Потрібні ролі (через кому)" value={newRoles} onChangeText={setNewRoles}
            placeholder="Водій, Медик, Вантажник" />
          <Button title="Створити підзадачу" onPress={handleCreate} loading={creating} size="lg" />
          <Button title="Скасувати" variant="ghost" onPress={() => navigation.goBack()} style={{ marginTop: 8 }} />
        </ScrollView>
      </View>
    );
  }

  if (loading) return <LoadingScreen />;
  if (!task) return null;

  const st = statusColors[task.status];
  const activeAssignments = task.assignments?.filter((a) => a.status !== AssignmentStatus.WITHDRAWN) ?? [];
  const isMe = task.assignments?.some((a) => a.userId === user?.id && a.status !== 'withdrawn');
  const myAssignment = task.assignments?.find((a) => a.userId === user?.id && a.status !== AssignmentStatus.WITHDRAWN);
  const isFull = false; // Recommended, not hard limit
  const isCoordOrAdmin = user?.systemRole === SystemRole.ADMIN || user?.systemRole === SystemRole.COORDINATOR;
  const isVolunteer = user?.systemRole === SystemRole.VOLUNTEER || user?.systemRole === SystemRole.COORDINATOR;

  // Чи може поточний виконавець додавати звіти
  const canReport = isMe && (
    task.status === TaskStatus.IN_PROGRESS ||
    task.status === TaskStatus.PENDING_REVIEW
  );

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title="Підзадача"
        subtitle={requestTitle}
        onBack={() => navigation.goBack()}
      />

      {/* Delegation modal */}
      <Modal visible={showDelegateModal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          <ScreenHeader title="Делегувати задачу" onBack={() => setShowDelegateModal(false)} />
          <FlatList
            data={orgs}
            keyExtractor={(o) => o.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => handleDelegate(item.id, item.name)} activeOpacity={0.8}>
                <Card>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.text }}>{item.name}</Text>
                  {item.description && (
                    <Text style={{ fontSize: 13, color: Colors.textSecondary, marginTop: 4 }} numberOfLines={2}>
                      {item.description}
                    </Text>
                  )}
                </Card>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* ── Task info card ── */}
        <Card style={{ marginTop: 16 }}>
          <View style={styles.taskHeader}>
            <Text style={styles.taskTitle}>{task.title}</Text>
            <Badge label={st?.label ?? task.status} colorScheme="status" value={task.status} />
          </View>

          {task.description ? <Text style={styles.desc}>{task.description}</Text> : null}

          <View style={styles.slotRow}>
            <Text style={styles.slotLabel}>Волонтерів: {activeAssignments.length}/{task.neededPeopleCount}</Text>
          </View>
          <ProgressBar
            value={activeAssignments.length}
            total={task.neededPeopleCount}
            color={isFull ? Colors.secondary : Colors.primary}
          />

          {task.requiredRoles?.filter(Boolean).length > 0 && (
            <View style={styles.rolesRow}>
              {task.requiredRoles.filter(Boolean).map((r) => (
                <View key={r} style={styles.roleTag}>
                  <Text style={styles.roleTagText}>🎭 {r}</Text>
                </View>
              ))}
            </View>
          )}

          {task.deadline && (
            <Text style={styles.deadline}>
              ⏰ Дедлайн:{' '}
              {new Date(task.deadline).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}
            </Text>
          )}
        </Card>

        {/* ── Assignments list ── */}
        {activeAssignments.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>Виконавці ({activeAssignments.length})</Text>
            {activeAssignments.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={styles.assigneeRow}
                onPress={() => a.userId && navigation.navigate('UserProfile', { userId: a.userId })}
                activeOpacity={0.7}
              >
                <View style={styles.assigneeAvatar}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>
                    {a.user?.fullName?.[0] ?? '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.assigneeName}>{a.user?.fullName ?? 'Волонтер'}</Text>
                  {a.fulfilledRole && <Text style={styles.assigneeRole}>{a.fulfilledRole}</Text>}
                </View>
                <View style={[
                  styles.assigneeStatus,
                  a.status === AssignmentStatus.COMPLETED && { backgroundColor: Colors.secondaryLight },
                  a.status === AssignmentStatus.EN_ROUTE  && { backgroundColor: '#fff3e0' },
                  a.status === AssignmentStatus.ON_SITE   && { backgroundColor: '#e8f5e9' },
                ]}>
                  <Text style={{ fontSize: 11, color:
                    a.status === AssignmentStatus.COMPLETED ? Colors.secondary :
                    a.status === AssignmentStatus.EN_ROUTE  ? Colors.warning :
                    a.status === AssignmentStatus.ON_SITE   ? Colors.secondary :
                    Colors.textMuted,
                  }}>
                    {a.status === AssignmentStatus.COMPLETED ? '✓ Виконано' :
                     a.status === AssignmentStatus.EN_ROUTE  ? '🚗 В дорозі' :
                     a.status === AssignmentStatus.ON_SITE   ? '📍 На місці' :
                     '● Активний'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </Card>
        )}

        {/* ── Action buttons ── */}
        <View style={styles.actions}>
          {/* Volunteer: take / withdraw */}
          {isVolunteer && (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS) && (
            <Button
              title={isMe ? 'Відмовитися від задачі' : '✋ Взяти в роботу'}
              variant={isMe ? 'danger' : 'primary'}
              onPress={handleAssign}
              loading={actioning}
            />
          )}

          {/* FR-06e: EN_ROUTE / ON_SITE */}
          {isMe && task.status === TaskStatus.IN_PROGRESS && (
            <View style={styles.routeButtons}>
              <Button
                title="🚗 Я в дорозі"
                variant={myAssignment?.status === AssignmentStatus.EN_ROUTE ? 'secondary' : 'outline'}
                onPress={() => handleUpdateStatus(AssignmentStatus.EN_ROUTE)}
                loading={actioning}
                style={{ flex: 1 }}
                size="sm"
              />
              <Button
                title="📍 Я на місці"
                variant={myAssignment?.status === AssignmentStatus.ON_SITE ? 'secondary' : 'outline'}
                onPress={() => handleUpdateStatus(AssignmentStatus.ON_SITE)}
                loading={actioning}
                style={{ flex: 1 }}
                size="sm"
              />
            </View>
          )}

          {/*
            ── ВИПРАВЛЕННЯ: «Позначити як виконану» і «Додати звіт» — РІЗНІ кнопки ──
            «Виконати» — змінює статус задачі на PENDING_REVIEW.
            «Звіт»     — відкриває форму звіту БЕЗ зміни статусу.
          */}
          {isMe && task.status === TaskStatus.IN_PROGRESS && (
            <>
              <Button
                title="✅ Позначити як виконану"
                variant="secondary"
                onPress={handleComplete}
                loading={actioning}
              />
              <Button
                title="📋 Додати звіт"
                variant="outline"
                onPress={handleAddReport}
              />
            </>
          )}

          {/* Окрема кнопка звіту для PENDING_REVIEW (якщо виконавець ще не звітував) */}
          {canReport && task.status === TaskStatus.PENDING_REVIEW && (
            <Button
              title="📋 Додати звіт"
              variant="outline"
              onPress={handleAddReport}
            />
          )}

          {/* Request creator / admin: confirm or reject */}
          {isCoordOrAdmin && task.status === TaskStatus.PENDING_REVIEW && (
            <View style={{ gap: 8 }}>
              <Button
                title="✓ Підтвердити виконання"
                variant="secondary"
                onPress={handleConfirm}
                loading={actioning}
              />
              <Button
                title="✗ Відхилити (повернути в роботу)"
                variant="danger"
                onPress={handleReject}
                loading={actioning}
              />
            </View>
          )}

          {/* FR-04b: Coordinator — delegation */}
          {isCoordOrAdmin && (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS) && (
            <Button
              title="↗ Делегувати іншій організації"
              variant="outline"
              onPress={handleDelegateOpen}
            />
          )}
        </View>

        {/* ── Chat link ── */}
        {task.chatId && (
          <View style={{ marginHorizontal: 16 }}>
            <Button
              title="💬 Відкрити чат задачі"
              variant="outline"
              onPress={() =>
                navigation.navigate('Chats', {
                  screen: 'ChatRoom',
                  params: { chatId: task.chatId, chatName: `Задача: ${task.title}` },
                })
              }
            />
          </View>
        )}

        {/* ── Reports history ── */}
        {reports.length > 0 && (
          <Card style={{ margin: 16 }}>
            <Text style={styles.sectionTitle}>Історія звітів ({reports.length})</Text>
            {reports.map((r, i) => (
              <View
                key={r.id ?? i}
                style={{
                  marginBottom: 12,
                  paddingBottom: 12,
                  borderBottomWidth: i === reports.length - 1 ? 0 : 1,
                  borderBottomColor: Colors.border,
                }}
              >
                <Text style={{ fontSize: 13, color: Colors.textSecondary }}>
                  {new Date(r.createdAt).toLocaleString('uk-UA')} • {r.user?.fullName}
                </Text>
                <Text style={{ fontSize: 14, color: Colors.text, marginTop: 4 }}>{r.comment}</Text>

                {r.attachments?.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {r.attachments.map((a: any, j: number) => (
                      <TouchableOpacity
                        key={j}
                        style={{ alignItems: 'center', width: 60 }}
                        onPress={() => handleOpenAttachment(a)}
                      >
                        <View style={[
                          styles.thumbnail,
                          { backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center' },
                        ]}>
                          <Text style={{ fontSize: 20 }}>
                            {a.type?.startsWith('image/') ? '🖼️' : '📄'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 9, textAlign: 'center', marginTop: 4 }} numberOfLines={1}>
                          {a.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}

        {/* ── Report Modal ── */}
        <TaskReportModal
          visible={showReportModal}
          onClose={() => setShowReportModal(false)}
          onSubmit={handleReportSubmit}
          loading={uploading}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  taskHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  taskTitle:      { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.text, lineHeight: 22 },
  desc:           { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  slotRow:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  slotLabel:      { fontSize: 13, fontWeight: '600', color: Colors.text },
  rolesRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  roleTag:        { backgroundColor: Colors.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  roleTagText:    { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  deadline:       { fontSize: 13, color: Colors.warning, fontWeight: '600', marginTop: 10 },
  sectionTitle:   { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  assigneeRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  assigneeAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  assigneeName:   { fontSize: 14, fontWeight: '600', color: Colors.text },
  assigneeRole:   { fontSize: 12, color: Colors.textSecondary },
  assigneeStatus: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: Colors.borderLight },
  actions:        { marginHorizontal: 16, gap: 10, marginBottom: 12 },
  routeButtons:   { flexDirection: 'row', gap: 8 },
  thumbnail:      { width: 50, height: 50, borderRadius: 8 },
});
