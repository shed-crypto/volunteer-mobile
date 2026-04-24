import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  StyleSheet, Modal, FlatList,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { tasksApi } from '../../api/tasks.api';
import { Task, TaskStatus, AssignmentStatus, SystemRole, Organization } from '../../types';
import { Colors, statusColors } from '../../utils/theme';
import { Badge, Card, Button, LoadingScreen, ScreenHeader, Input, ProgressBar } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { TaskReportModal } from '../../components/TaskReportModal';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { collections } from '../../db/index';
import { Q } from '@nozbe/watermelondb';

type RouteParams = {
  TaskDetail: { taskId: string; requestId?: string; requestTitle?: string };
};

export default function TaskDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'TaskDetail'>>();
  const { taskId, requestId, requestTitle } = route.params;
  const { user } = useAuth();
  const isNew = taskId === '__new__';

  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(!isNew);

  const { isOnline } = useNetworkStatus();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  // Захист від подвійного запуску (React StrictMode)
  const isLoadingRef = useRef(false);

  const load = useCallback(async () => {
    if (isNew || !taskId || isLoadingRef.current) {
      setLoading(false);
      return;
    }

    isLoadingRef.current = true;
    console.log(`[TaskDetailScreen] Завантаження задачі: ${taskId}`);

    try {
      if (isOnlineRef.current) {
        // СТРАТЕГІЯ: Онлайн → одразу API (без очікування WatermelonDB-черги).
        console.log('[TaskDetailScreen] Онлайн — завантаження з API');
        const data = await tasksApi.getOne(taskId);
        setTask(data);
      } else {
        // Офлайн → читаємо з локальної БД
        console.log('[TaskDetailScreen] Офлайн — завантаження з локальної БД');
        const localTasks = await collections.tasks
          .query(Q.where('server_id', taskId))
          .fetch();
        if (localTasks.length > 0) {
          setTask(localTasks[0]._raw);
        } else {
          console.warn('[TaskDetailScreen] Задача не знайдена в локальній БД');
          setTask(null);
        }
      }
    } catch (error: any) {
      console.error('[TaskDetailScreen] Помилка завантаження:', error);
      // API впав → fallback до локальної БД
      try {
        const localTasks = await collections.tasks
          .query(Q.where('server_id', taskId))
          .fetch();
        if (localTasks.length > 0) {
          setTask(localTasks[0]._raw);
        } else {
          setTask(null);
        }
      } catch (dbErr) {
        console.warn('[TaskDetailScreen] Помилка читання з локальної БД:', dbErr);
        setTask(null);
      }
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [taskId, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!task) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Завдання" onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
          <Text style={{ color: Colors.textSecondary, textAlign: 'center' }}>
            Завдання не знайдено
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={task?.title || 'Завдання'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8, color: Colors.text }}>
            {task?.title}
          </Text>
          <Text style={{ fontSize: 14, color: Colors.textSecondary, lineHeight: 20 }}>
            {task?.description}
          </Text>
        </Card>

        {task?.status && (
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 }}>
              Статус
            </Text>
            <Text style={{ fontSize: 15, color: Colors.text }}>
              {task.status}
            </Text>
          </Card>
        )}

        {task?.neededPeopleCount != null && (
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 }}>
              Потрібно людей
            </Text>
            <Text style={{ fontSize: 15, color: Colors.text }}>
              {task.assignedCount ?? 0} / {task.neededPeopleCount}
            </Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
