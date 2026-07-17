/**
 * KanbanScreen.tsx — Kanban-дошка підзадач заявки (FR-06e)
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Colors } from '../../utils/theme';
import api from '../../api/axios';

type TaskStatus = 'TO_DO' | 'IN_PROGRESS' | 'EN_ROUTE' | 'ON_SITE' | 'DONE';

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'TO_DO',       label: 'Очікує',   color: '#9E9E9E' },
  { status: 'IN_PROGRESS', label: 'В роботі', color: '#2196F3' },
  { status: 'EN_ROUTE',    label: 'В дорозі', color: '#FF9800' },
  { status: 'ON_SITE',     label: 'На місці', color: '#9C27B0' },
  { status: 'DONE',        label: 'Виконано', color: '#4CAF50' },
];

const NEXT_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  TO_DO: 'IN_PROGRESS', IN_PROGRESS: 'EN_ROUTE', EN_ROUTE: 'ON_SITE', ON_SITE: 'DONE',
};

interface TaskItem {
  id: string; title: string; description?: string;
  status: TaskStatus; priority: number;
  assignments: { user: { fullName: string; id: string } }[];
}

type RouteParams = { requestId: string; requestTitle?: string };

export default function KanbanScreen() {
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const navigation = useNavigation<any>();
  const { requestId, requestTitle } = route.params;

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const { data } = await api.get<TaskItem[]>(`/requests/${requestId}/tasks`);
      setTasks(data);
    } catch {
      Alert.alert('Помилка', 'Не вдалося завантажити задачі');
    } finally { setLoading(false); }
  }, [requestId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleStatusChange = async (task: TaskItem) => {
    const nextStatus = NEXT_STATUS[task.status];
    if (!nextStatus) return;
    const nextLabel = COLUMNS.find((c) => c.status === nextStatus)?.label ?? nextStatus;
    Alert.alert('Змінити статус?', `"${task.title}"\n→ ${nextLabel}`, [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Підтвердити', onPress: async () => {
        setUpdatingId(task.id);
        try {
          await api.patch(`/tasks/${task.id}/status`, { status: nextStatus });
          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: nextStatus } : t));
        } catch { Alert.alert('Помилка', 'Не вдалося оновити статус'); }
        finally { setUpdatingId(null); }
      }},
    ]);
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return (
    <View style={styles.container}>
      {requestTitle && <Text style={styles.requestTitle}>{requestTitle}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.status);
          return (
            <View key={col.status} style={styles.column}>
              <View style={[styles.colHeader, { borderTopColor: col.color }]}>
                <Text style={[styles.colTitle, { color: col.color }]}>{col.label}</Text>
                <View style={[styles.colCount, { backgroundColor: col.color }]}>
                  <Text style={styles.colCountText}>{colTasks.length}</Text>
                </View>
              </View>
              {colTasks.length === 0
                ? <View style={styles.emptyCol}><Text style={styles.emptyText}>—</Text></View>
                : colTasks.map((task) => (
                  <View key={task.id} style={styles.taskCard}>
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    {task.description ? <Text style={styles.taskDesc} numberOfLines={2}>{task.description}</Text> : null}
                    {task.assignments.length > 0 && (
                      <View style={styles.assignees}>
                        {task.assignments.map((a) => (
                          <View key={a.user.id} style={styles.assigneeBadge}>
                            <Text style={styles.assigneeText}>{a.user.fullName.split(' ')[0]}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {NEXT_STATUS[task.status] && (
                      <TouchableOpacity style={styles.advanceBtn} onPress={() => handleStatusChange(task)} disabled={updatingId === task.id}>
                        {updatingId === task.id
                          ? <ActivityIndicator size="small" color={Colors.primary} />
                          : <Text style={styles.advanceBtnText}>→ {COLUMNS.find((c) => c.status === NEXT_STATUS[task.status])?.label}</Text>
                        }
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              }
            </View>
          );
        })}
      </ScrollView>
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateTask', { requestId })}>
        <Text style={styles.fabText}>+ Задача</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F5' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  requestTitle: { fontSize: 14, color: '#666', paddingHorizontal: 16, paddingTop: 12, fontStyle: 'italic' },
  board: { padding: 12, gap: 10, alignItems: 'flex-start' },
  column: { width: 200, backgroundColor: 'white', borderRadius: 14, padding: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2, minHeight: 120 },
  colHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 3, paddingTop: 8, marginBottom: 10 },
  colTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  colCount: { borderRadius: 10, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  colCountText: { color: 'white', fontSize: 11, fontWeight: '700' },
  emptyCol: { alignItems: 'center', paddingVertical: 16 },
  emptyText: { color: '#CCC', fontSize: 18 },
  taskCard: { backgroundColor: '#F8F9FA', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#ECECEC' },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#222', marginBottom: 4 },
  taskDesc: { fontSize: 12, color: '#888', marginBottom: 6, lineHeight: 16 },
  assignees: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  assigneeBadge: { backgroundColor: '#E3F2FD', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  assigneeText: { fontSize: 11, color: '#1565C0', fontWeight: '500' },
  advanceBtn: { borderWidth: 1, borderColor: Colors.primary, borderRadius: 8, paddingVertical: 5, alignItems: 'center' },
  advanceBtnText: { color: Colors.primary, fontSize: 12, fontWeight: '600' },
  fab: { position: 'absolute', bottom: 20, right: 20, backgroundColor: Colors.primary, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 12, elevation: 6 },
  fabText: { color: 'white', fontWeight: '700', fontSize: 15 },
});
