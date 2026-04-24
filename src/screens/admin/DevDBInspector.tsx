import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../utils/theme';
import { Card, Button, ScreenHeader } from '../../components/ui';
import { collections, database } from '../../db/index';
import * as FileSystem from 'expo-file-system';
import { API_BASE_URL } from '../../api/axios';
import { isServerReachable } from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';

interface DBTable {
  name: string;
  count: number;
  data: any[];
}

export default function DevDBInspector() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tables, setTables] = useState<DBTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [jsonData, setJsonData] = useState<string>('');

  // Визначаємо всі колекції для інспекції
  const collectionNames = [
    { key: 'requests', name: 'requests', display: 'Заявки' },
    { key: 'tasks', name: 'tasks', display: 'Задачі' },
    { key: 'chatMessages', name: 'chatMessages', display: 'Чат-повідомлення' },
    { key: 'users', name: 'users', display: 'Користувачі' },
    { key: 'pendingReports', name: 'pendingReports', display: 'Відкладені звіти' },
    { key: 'actionQueue', name: 'actionQueue', display: 'Черга дій' },
    { key: 'taskAssignments', name: 'taskAssignments', display: 'Призначення задач' },
  ];

  const loadAllTables = async () => {
    const results: DBTable[] = [];
    
    for (const { key } of collectionNames) {
      try {
        const col = (collections as any)[key];
        const items = await col.query().fetch();
        
        results.push({
          name: key,
          count: items.length,
          data: items.map((item: any) => {
            const raw = item._raw || {};
            return {
              id: raw.id,
              ...Object.fromEntries(
                Object.entries(raw).filter(([k]) => !k.startsWith('_'))
              )
            };
          })
        });
      } catch (err) {
        console.error(`[DevDBInspector] Помилка читання ${key}:`, err);
        results.push({ name: key, count: 0, data: [] });
      }
    }
    
    setTables(results);
  };

  const manualSync = async () => {
    setIsSyncing(true);
    try {
      // Тут можна викликати SyncService.sync()
      const { SyncService } = await import('../db/SyncService');
      await SyncService.sync();
      setLastSync(new Date());
      await loadAllTables();
    } catch (error) {
      console.warn('[DevDBInspector] Синхронізація не вдалась:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const clearDatabase = async () => {
    Alert.alert(
      '❌ Очищення БД',
      'Ви впевнені? Всі локальні дані буде втрачено!',
      [
        { text: 'Скасувати' },
        {
          text: 'Так, очистити',
          onPress: async () => {
            try {
              await database.write(async () => {
                await database.unsafeResetDatabase();
              });
              setTables([]);
              Alert.alert('✓', 'База очищена');
            } catch (e) {
              Alert.alert('✗', 'Помилка очистки: ' + e.message);
            }
          },
        },
      ]
    );
  };

  const exportDB = async () => {
    try {
      const exportData = {
        timestamp: new Date().toISOString(),
        server: API_BASE_URL,
        user: user?.email || 'anonymous',
        tables: tables.reduce((acc, table) => {
          acc[table.name] = {
            count: table.count,
            sample: table.data.slice(0, 3)
          };
          return acc;
        }, {} as Record<string, any>)
      };
      
      const fileName = `db-export-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(
        FileSystem.documentDirectory + fileName,
        JSON.stringify(exportData, null, 2)
      );
      Alert.alert('✓', `Експорт збережено: ${fileName}`);
    } catch (error) {
      console.warn('[DevDBInspector] Помилка експорту:', error);
    }
  };

  React.useEffect(() => {
    loadAllTables();
  }, []);

  if (!__DEV__) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <ScreenHeader title="Інспектор БД" onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: Colors.textMuted }}>
            Доступно тільки в режимі розробки
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader title="Інспектор БД" onBack={() => navigation.goBack()} />
      
      {/* Статус бар */}
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: Colors.text }}>Сервер:</Text>
          <View style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: isServerReachable ? Colors.successLight : Colors.dangerLight
          }}>
            <Text style={{
              color: isServerReachable ? Colors.success : Colors.danger,
              fontWeight: '600'
            }}>
              {isServerReachable ? 'Доступний' : 'Недоступний'}
            </Text>
          </View>
        </View>
        
        <Text style={{ color: Colors.textMuted }}>
          Останній синх{' '}
          {lastSync?.toLocaleTimeString('uk-UA') || 'ніколи'}
        </Text>
        
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            title={isSyncing ? '🔄 Синк...' : '🔄 Синхронізувати'}
            onPress={manualSync}
            disabled={isSyncing}
            style={{ flex: 1 }}
          />
          <Button
            title='🗑️ Очистити'
            onPress={clearDatabase}
            variant='danger'
            style={{ flex: 1 }}
          />
        </View>
        
        <Button
          title='📤 Експорт JSON'
          onPress={exportDB}
          variant='outline'
        />
      </View>
      
      {/* Таблиці */}
      <ScrollView style={{ flex: 1 }}>
        {tables.map((table, idx) => (
          <TouchableOpacity
            key={table.name}
            onPress={() => {
              setSelectedTable(table.name === selectedTable ? null : table.name);
              setJsonData(JSON.stringify(table.data, null, 2));
            }}
          >
            <Card style={{ padding: 16, marginHorizontal: 16, marginVertical: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: Colors.text }}>
                  {collectionNames.find(c => c.key === table.name)?.display || table.name}
                </Text>
                <Text style={{ fontSize: 14, color: Colors.primary }}>
                  {table.count} записів
                </Text>
              </View>
              
              {selectedTable === table.name && (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontSize: 12, color: Colors.textMuted, marginBottom: 8 }}>
                    Приклад даних:
                  </Text>
                  <ScrollView
                    horizontal
                    style={{
                      backgroundColor: Colors.background,
                      padding: 12,
                      borderRadius: 8,
                      maxHeight: 150
                    }}
                  >
                    <Text style={{ fontSize: 11, color: Colors.text, lineHeight: 16 }}>
                      {jsonData || 'Немає даних'}
                    </Text>
                  </ScrollView>
                </View>
              )}
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}