import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, Modal, FlatList } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { tasksApi } from '../../api/tasks.api';
import { orgsApi } from '../../api/orgs.api';
import { API_BASE_URL } from '../../api/axios';
import { Task, TaskStatus, AssignmentStatus, SystemRole, Organization } from '../../types';
import { Colors, statusColors } from '../../utils/theme';
import { Badge, Card, Button, LoadingScreen, ScreenHeader, Input, ProgressBar } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { OfflineLogger } from '../../utils/offlineLogger';
import { collections, database } from '../../db/index';
import { TaskReportModal } from '../../components/TaskReportModal';
import { fileUtils } from '../../utils/fileUtils';

type RouteParams = {
  TaskDetail: { taskId: string; requestId?: string; requestTitle?: string };
};

/** Будує абсолютний URL для файлу зі збереженого відносного шляху */
function buildFileUrl(relativePath: string): string {
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${base}${relativePath}`;
}

export default function TaskDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'TaskDetail'>>();
  const { taskId, requestId, requestTitle } = route.params;
  const { user } = useAuth();

  const isNew = taskId === '__new__';

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [actioning, setActioning] = useState(false);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [delegating, setDelegating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPeople, setNewPeople] = useState('1');
  const [newRoles, setNewRoles] = useState('');
  const [creating, setCreating] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reports, setReports] = useState<any[]>([]);

  const { isOffline } = useNetwork();

  // ─── Load task from local DB ─────────────────────────────────────────────
  const loadTaskLocal = useCallback(async (): Promise<Task | null> => {
    try {
      const localTasks = await collections.tasks.query().fetch();
      const local = localTasks.find((t: any) => t.serverId === taskId || t.id === taskId);
      if (!local) return null;
      
      // Load assignments for this task
      const localAssignments = await collections.taskAssignments.query().fetch();
      const taskAssignments = localAssignments
        .filter((a: any) => a.taskId === taskId || a.taskId === local.id)
        .map((a: any) => ({
          id: a.id,
          taskId: a.taskId,
          userId: a.userId,
          status: a.status,
          fulfilledRole: a.fulfilledRole,
          assignedAt: a.assignedAt ? new Date(a.assignedAt).toISOString() : '',
        }));
      
      return {
        id: local.serverId || local.id,
        requestId: local.requestId || local.requestServerId,
        title: local.title,
        description: local.description,
        status: local.status,
        neededPeopleCount: local.neededPeopleCount,
        requiredRoles: local.requiredRoles || [],
        assignedCount: local.assignedCount,
        priority: local.priority,
        deadline: local.deadline ? new Date(local.deadline).toISOString() : undefined,
        chatId: local.chatId,
        assignments: taskAssignments,
        createdAt: local.createdAtServer ? new Date(local.createdAtServer).toISOString() : '',
      } as Task;
    } catch (e) {
      OfflineLogger.cache('TaskDetail: local load failed', e);
      return null;
    }
  }, [taskId]);

  // ─── Save task to local DB ───────────────────────────────────────────────
  const saveTaskToDB = useCallback(async (t: Task) => {
    try {
      const existing = await collections.tasks.query().fetch();
      const existingTask = existing.find((et: any) => et.serverId === t.id);
      
      if (existingTask) {
        await database.write(async () => {
          await existingTask.update((et: any) => {
            et.title = t.title;
            et.description = t.description ?? null;
            et.status = t.status;
            et.neededPeopleCount = t.neededPeopleCount;
            et.requiredRolesRaw = JSON.stringify(t.requiredRoles ?? []);
            et.assignedCount = t.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
            et.priority = t.priority ?? 0;
            et.deadline = t.deadline ? new Date(t.deadline).getTime() : null;
            et.chatId = t.chatId ?? null;
            et.isSynced = true;
            et.lastSyncedAt = Date.now();
          });
        });
      } else {
        await database.write(async () => {
          await collections.tasks.create((et: any) => {
            et.serverId = t.id;
            et.requestServerId = t.requestId;
            et.title = t.title;
            et.description = t.description ?? null;
            et.status = t.status;
            et.neededPeopleCount = t.neededPeopleCount ?? 1;
            et.requiredRolesRaw = JSON.stringify(t.requiredRoles ?? []);
            et.assignedCount = t.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
            et.priority = t.priority ?? 0;
            et.deadline = t.deadline ? new Date(t.deadline).getTime() : null;
            et.chatId = t.chatId ?? null;
            et.isSynced = true;
            et.lastSyncedAt = Date.now();
          });
        });
      }
      
      // Save assignments
      if (t.assignments && t.assignments.length > 0) {
        const existingAssignments = await collections.taskAssignments.query().fetch();
        const existingMap = new Map(existingAssignments.map((a: any) => [a.id, a]));
        const ops: any[] = [];
        
        for (const a of t.assignments) {
          const existingA = existingMap.get(a.id);
          if (existingA) {
            ops.push(existingA.prepareUpdate((ea: any) => {
              ea.status = a.status;
              ea.fulfilledRole = a.fulfilledRole ?? null;
            }));
          } else {
            ops.push(collections.taskAssignments.prepareCreate((ea: any) => {
              ea.taskId = a.taskId || taskId;
              ea.userId = a.userId;
              ea.status = a.status;
              ea.fulfilledRole = a.fulfilledRole ?? null;
              ea.assignedAt = a.assignedAt ? new Date(a.assignedAt).getTime() : Date.now();
              ea.isSynced = true;
            }));
          }
        }
        
        if (ops.length > 0) {
          await database.write(async () => {
            await database.batch(...ops);
          });
        }
      }
      
      OfflineLogger.cache(`TaskDetail: saved task ${t.id} to DB`);
    } catch (e) {
      OfflineLogger.cache('TaskDetail: save to DB failed', e);
    }
  }, []);

  const load = useCallback(async () => {
    if (isNew) return;
    
    try {
      // КРОК 1: Load from local DB first (with adaptive timeout)
      const timeout = isOffline ? 10000 : 300;
      const localTask = await Promise.race([
        loadTaskLocal(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout))
      ]);
      
      if (localTask) {
        OfflineLogger.nav('TaskDetail: showing local data first');
        setTask(localTask);
        setLoading(false);
      }
      
      // КРОК 2: If online, update from server
      if (!isOffline) {
        try {
          const t = await tasksApi.getOne(taskId);
          // Обчислюємо assignedCount якщо сервер не повертає
          if (t.assignments && !t.assignedCount) {
            t.assignedCount = t.assignments.filter((a: any) => a.status !== 'withdrawn').length;
          }
          setTask(t);
          await saveTaskToDB(t);
          
          // Load reports
          try {
            const { taskReportsApi } = await import('../../api/task-reports.api');
            const reps = await taskReportsApi.getAll(taskId);
            setReports(reps);
          } catch {
            // ignore reports error
          }
        } catch (e) {
          OfflineLogger.network('TaskDetail: server load failed');
          if (!localTask) {
            Alert.alert('Помилка', 'Не вдалося завантажити підзадачу');
            if (navigation.canGoBack()) navigation.goBack();
          }
        }
      }
    } catch (e) {
      OfflineLogger.nav('TaskDetail: unexpected error', e);
    } finally {
      setLoading(false);
    }
  }, [taskId, isNew, isOffline, loadTaskLocal, saveTaskToDB, navigation]);

  useEffect(() => {
    load();
  }, [load]);

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
        requiredRoles: newRoles.split(',').map(r => r.trim()).filter(Boolean),
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
      const isMe = task.assignments?.some(a => a.userId === user?.id && a.status !== 'withdrawn');
      if (isMe) await tasksApi.withdraw(task.id);
      else await tasksApi.assign(task.id);
      await load();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Спробуйте ще раз');
    } finally {
      setActioning(false);
    }
  };

  const handleComplete = async () => {
    if (!task) return;
    Alert.alert('Завершити задачу?', 'Статус буде змінено на «На перевірці»', [
      { text: 'Ні' },
      {
        text: 'Так, завершити',
        onPress: async () => {
          try {
            setActioning(true);
            await tasksApi.complete(task.id);
            await load();
            Alert.alert('✓ Завершено', 'Бажаєте додати звіт про виконану роботу (фото, коментар)?', [
              { text: 'Ні, дякую' },
              { text: 'Так, додати', onPress: () => setShowReportModal(true) },
            ]);
          } catch (e: any) {
            Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося оновити статус');
          } finally {
            setActioning(false);
          }
        },
      },
    ]);
  };

  const handleAddReport = () => {
    setShowReportModal(true);
  };

  const handleReportSubmit = async (
    comment: string,
    attachments: { uri: string; name: string; type: string }[]
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
    Alert.alert('✓ Підтвердити виконання', `Задачу буде вважати виконаною`, [
      { text: 'Ні' },
      {
        text: 'Так, підтвердити',
        onPress: async () => {
          try {
            setActioning(true);
            await tasksApi.confirm(task.id);
            await load();
          } catch (e: any) {
            Alert.alert('Помилка', e?.response?.data?.message ?? '');
          } finally {
            setActioning(false);
          }
        },
      },
    ]);
  };

  const handleReject = async () => {
    if (!task) return;
    Alert.alert('✗ Відхилити', `Відмовити в підтвердженні, повернути в роботу`, [
      { text: 'Ні' },
      {
        text: 'Так, відхилити',
        onPress: async () => {
          try {
            setActioning(true);
            await tasksApi.reject(task.id);
            await load();
          } catch (e: any) {
            Alert.alert('Помилка', e?.response?.data?.message ?? '');
          } finally {
            setActioning(false);
          }
        },
      },
    ]);
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
      await load();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? '');
    } finally {
      setDelegating(false);
    }
  };

  const handleUpdateStatus = (newStatus: AssignmentStatus) => {
    if (!task) return;
    const labels: Record<string, string> = {
      assigned: 'Призначено',
      applied: 'Подано заявку',
      accepted: 'Прийнято',
      rejected: 'Відхилено',
      withdrawn: 'Відкликав',
      completed: 'Виконав',
      en_route: 'В дорозі',
      on_site: 'На місці',
    };
    Alert.alert('Оновити статус?', labels[newStatus] ?? newStatus, [
      { text: 'Ні' },
      {
        text: 'Так',
        onPress: async () => {
          try {
            setActioning(true);
            await tasksApi.updateAssignmentStatus(task.id, newStatus);
            await load();
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

  if (isNew) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Створити задачу" onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Input label="Назва задачі" value={newTitle} onChangeText={setNewTitle} />
          <Input label="Опис" value={newDesc} onChangeText={setNewDesc} multiline />
          <Input label="Потрібно людей" value={newPeople} onChangeText={setNewPeople} keyboardType="numeric" />
          <Input label="Потрібні ролі (через кому)" value={newRoles} onChangeText={setNewRoles} multiline />
          <Button title="Створити" onPress={handleCreate} loading={creating} style={{ marginTop: 12 }} />
          <Button title="Скасувати" variant="ghost" onPress={() => navigation.goBack()} style={{ marginTop: 8 }} />
        </ScrollView>
      </View>
    );
  }

  if (loading) return <LoadingScreen />;
  if (!task) return null;

  const activeAssignments = task.assignments?.filter(a => a.status !== AssignmentStatus.WITHDRAWN) ?? [];
  const isMe = task.assignments?.some(a => a.userId === user?.id && a.status !== 'withdrawn');
  const myAssignment = task.assignments?.find(a => a.userId === user?.id && a.status !== AssignmentStatus.WITHDRAWN);
  const isAdmin = user?.systemRole === SystemRole.ADMIN;
  const isCoord = user?.systemRole === SystemRole.COORDINATOR;
  const isVolunteer = user?.systemRole === SystemRole.VOLUNTEER;
  const isCoordOrAdmin = isCoord || isAdmin;
const statusLabels: Record<string, string> = {
  en_route: 'В дорозі',
  on_site: 'На місці',
  accepted: 'Прийнято',
  rejected: 'Відхилено',
  withdrawn: 'Відкликав',
  completed: 'Виконано',
  applied: 'Подано',
};

const canReport = isMe && (task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.PENDING_REVIEW);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        title={requestTitle ? `${requestTitle} / Задача` : task?.title || 'Задача'}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Meta card */}
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: Colors.text }}>{task.title}</Text>
            <Badge
              label={statusColors[task.status]?.label ?? task.status}
              colorScheme="status"
              value={task.status}
              size="md"
            />
          </View>

          {task.description && (
            <Text style={{ fontSize: 14, color: Colors.textSecondary, lineHeight: 20 }}>{task.description}</Text>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {task.requiredRoles?.filter(Boolean).length > 0 && (
              <Text style={{ fontSize: 13, color: Colors.textSecondary, fontWeight: '600' }}>
                🎭 {task.requiredRoles.filter(Boolean).join(', ')}
              </Text>
            )}
            {task.deadline && (
              <Text style={{ fontSize: 13, color: Colors.warning, fontWeight: '600' }}>
                ⏰ {new Date(task.deadline).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}
              </Text>
            )}
          </View>
        </Card>

        {/* Progress bar */}
        {task.neededPeopleCount && task.neededPeopleCount > 1 && (
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textSecondary }}>Виконавці</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>
                {/* Show actual value for debugging */}
                {task.assignedCount ?? 0}/{task.neededPeopleCount}
              </Text>
            </View>
            <ProgressBar value={task.assignedCount ?? 0} total={task.neededPeopleCount} />
          </Card>
        )}

        {/* Assignees list */}
        {activeAssignments.length > 0 && (
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', marginBottom: 8, color: Colors.text }}>
              Виконавці ({activeAssignments.length})
            </Text>
            <FlatList
              data={activeAssignments}
              scrollEnabled={false}
              keyExtractor={a => a.userId}
              renderItem={({ item: a }) => (
                <TouchableOpacity
                  onPress={() => a.userId && navigation.navigate('UserProfile', { userId: a.userId })}
                  activeOpacity={0.7}
                >
                  <View
                    style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.text }}>
                      {a.user?.fullName || 'Користувач'}
                    </Text>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary }}>
                    Статус: {statusLabels[a.status] || a.status || 'Невідомо'}
                  </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </Card>
        )}

        {/* Action buttons - Restored from buffer for better UX */}
        <Card style={{ padding: 16 }}>
          {/* Volunteer: take/withdraw */}
          {isVolunteer && (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS) && (
            <Button
              title={isMe ? 'Відмовитися від задачі' : '✋ Взяти в роботу'}
              variant={isMe ? 'danger' : 'primary'}
              onPress={handleAssign}
              loading={actioning}
              style={{ marginBottom: 10 }}
            />
          )}

          {/* Status update buttons for EN_ROUTE / ON_SITE */}
          {isMe && task.status === TaskStatus.IN_PROGRESS && myAssignment && (
            <>
              <Button
                title="🚗 Я в дорозі"
                variant={myAssignment.status === AssignmentStatus.EN_ROUTE ? 'primary' : 'outline'}
                onPress={() => {
                  const targetStatus = AssignmentStatus.EN_ROUTE;
                  const newStatus = myAssignment?.status === targetStatus ? 'assigned' as AssignmentStatus : targetStatus;
                  handleUpdateStatus(newStatus);
                }}
                loading={actioning}
                style={{ marginBottom: 8 }}
                size="sm"
              />
              <Button
                title="📍 Я на місці"
                variant={myAssignment.status === AssignmentStatus.ON_SITE ? 'primary' : 'outline'}
                onPress={() => {
                  const targetStatus = AssignmentStatus.ON_SITE;
                  const newStatus = myAssignment?.status === targetStatus ? 'assigned' as AssignmentStatus : targetStatus;
                  handleUpdateStatus(newStatus);
                }}
                loading={actioning}
                style={{ marginBottom: 8 }}
                size="sm"
              />
            </>
          )}

          {/* Complete task and Add Report - Separated for better UX (restored from buffer) */}
          {isMe && task.status === TaskStatus.IN_PROGRESS && (
            <>
              <Button
                title="✅ Позначити як виконану"
                variant="primary"
                onPress={handleComplete}
                loading={actioning}
                style={{ marginBottom: 8 }}
              />
              <Button
                title="📋 Додати звіт"
                variant="outline"
                onPress={handleAddReport}
                style={{ marginBottom: 8 }}
              />
            </>
          )}

          {/* Confirm/Reject for coordinators/admins */}
          {isCoordOrAdmin && task.status === TaskStatus.PENDING_REVIEW && (
            <>
              <Button
                title="✓ Підтвердити виконання"
                variant="primary"
                onPress={handleConfirm}
                loading={actioning}
                style={{ marginBottom: 8 }}
              />
              <Button
                title="✗ Відхилити (повернути в роботу)"
                variant="outline"
                onPress={handleReject}
                style={{ marginBottom: 8 }}
              />
            </>
          )}

          {/* Delegate button for coordinators/admins */}
          {isCoordOrAdmin && (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS) && (
            <Button
              title="🏢 Делегувати організації"
              variant="outline"
              onPress={handleDelegateOpen}
              style={{ marginBottom: 8 }}
            />
          )}

          {/* Chat button */}
          {task.chatId && (
            <Button
              title="💬 Чат завдання"
              variant="primary"
              onPress={() =>
                navigation.navigate('Chats', {
                  screen: 'ChatRoom',
                  params: { chatId: task.chatId, chatName: `Чат: ${task.title}` },
                })
              }
            />
          )}
        </Card>

        {/* Reports history */}
        {reports.length > 0 && (
          <Card style={{ padding: 16, marginTop: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', marginBottom: 12, color: Colors.text }}>
              Історія звітів ({reports.length})
            </Text>
            {reports.map((r, i) => (
              <View
                key={r.id}
                style={{
                  paddingBottom: 12,
                  marginBottom: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: Colors.borderLight,
                }}
              >
                <Text style={{ fontSize: 13, color: Colors.textSecondary, marginBottom: 4 }}>
                  {new Date(r.createdAt).toLocaleString('uk-UA')} • {r.user?.fullName}
                </Text>
                <Text style={{ fontSize: 14, color: Colors.text }}>{r.comment}</Text>
                {r.attachments?.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    {r.attachments.map((a: any, j: number) => (
                      <TouchableOpacity key={j} onPress={() => handleOpenAttachment(a)}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            backgroundColor: Colors.borderLight,
                            padding: 8,
                            borderRadius: 8,
                            marginTop: 6,
                          }}
                        >
                          <Text>{a.type?.startsWith('image/') ? '🖼️' : '📄'}</Text>
                          <Text style={{ fontSize: 13, color: Colors.text }} numberOfLines={1}>
                            {a.name}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* Delegate modal */}
      <Modal visible={showDelegateModal} animationType="slide" onRequestClose={() => setShowDelegateModal(false)}>
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          <ScreenHeader title="Делегувати задачу" onBack={() => setShowDelegateModal(false)} />
          <FlatList
            data={orgs}
            keyExtractor={o => o.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => handleDelegate(item.id, item.name)}
                activeOpacity={0.8}
              >
                <Card style={{ padding: 12, marginBottom: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.text }}>{item.name}</Text>
                  {item.description && (
                    <Text style={{ fontSize: 13, color: Colors.textSecondary, marginTop: 3 }}>
                      {item.description}
                    </Text>
                  )}
                </Card>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      {/* Report modal */}
      <TaskReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} onSubmit={handleReportSubmit} loading={uploading} />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
});
