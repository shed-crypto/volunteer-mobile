/**
 * AdminScreen.tsx — Панель адміністратора (FR-01h, FR-02e)
 *
 * БАГ-ФІКси:
 * 1. Неправильний endpoint: /admin/users → /users/admin-list
 * 2. Неправильний block: POST /admin/users/:id/block → PATCH /users/:id/block
 * 3. Відсутній unblock endpoint → PATCH /users/:id/unblock
 * 4. Додано зміну ролі через PATCH /users/:id/role
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
   View, Text, FlatList, StyleSheet,
   TouchableOpacity, Alert, ActivityIndicator,
   TextInput, ActionSheetIOS, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../utils/theme';
import { ScreenHeader } from '../../components/ui';
import axiosInstance from '../../api/axios';
import { SystemRole, ClearanceLevel } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { usersApi } from '../../api/users.api';

interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  systemRole: string;
  clearanceLevel: string;
  isBlocked: boolean;
  vouchCount: number;
  isEmailVerified: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  volunteer:   'Волонтер',
  requester:   'Потребуючий',
  coordinator: 'Координатор',
  admin:       'Адмін',
};

const CLEARANCE_COLORS: Record<string, string> = {
  local:         '#4CAF50',
  international: '#2196F3',
  frontline:     '#F44336',
};

const CLEARANCE_LABELS: Record<string, string> = {
  local:         'Лок.',
  international: 'Міжн.',
  frontline:     'Фронт.',
};

const ALL_ROLES = [
  { value: SystemRole.ADMIN,       label: 'Адмін' },
  { value: SystemRole.VOLUNTEER,   label: 'Волонтер' },
  { value: SystemRole.COORDINATOR, label: 'Координатор' },
  { value: SystemRole.REQUESTER,   label: 'Потребуючий' },
];

const ALL_CLEARANCE = [
  { value: ClearanceLevel.LOCAL,         label: 'Локальний' },
  { value: ClearanceLevel.INTERNATIONAL, label: 'Міжнародний' },
  { value: ClearanceLevel.FRONTLINE,     label: 'Фронтлайн (ВПО/ЗСУ)' },
];

export default function AdminScreen() {
  const navigation = useNavigation<any>();
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [filtered, setFiltered] = useState<AdminUser[]>([]);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const { user: currentUser } = useAuth();

  // БАГ-ФІКс: правильний endpoint /users/admin-list
  const fetchUsers = useCallback(async () => {
    console.log('[AdminScreen] Fetching users...');
    setLoading(true);
    try {
      const { data } = await axiosInstance.get<AdminUser[]>('/users/admin-list');
      console.log('[AdminScreen] Users fetched:', data.length);
      setUsers(data);
      setFiltered(data);
    } catch (e: any) {
      console.error('[AdminScreen] Error fetching users:', e);
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося завантажити список');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('[AdminScreen] Component mounted, fetching users');
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(
      q
        ? users.filter((u) =>
            u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
          )
        : users,
    );
  }, [search, users]);

  // БАГ-ФІКс: PATCH /users/:id/block та PATCH /users/:id/unblock
  const toggleBlock = async (user: AdminUser) => {
    // Запобігаємо блокуванню/розблокуванню власного облікового запису адміністратором
    if (currentUser && user.id === currentUser.id && user.systemRole === SystemRole.ADMIN) {
      Alert.alert('Помилка', 'Адміністратор не може блокувати або розблокувати власний обліковий запис');
      return;
    }
    
    const action = user.isBlocked ? 'розблокувати' : 'заблокувати';
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} користувача?`,
      `${user.fullName}\n${user.email}`,
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          style: user.isBlocked ? 'default' : 'destructive',
          onPress: async () => {
            setActioning(user.id);
            try {
              const endpoint = user.isBlocked
                ? `/users/${user.id}/unblock`
                : `/users/${user.id}/block`;
              console.log(`[AdminScreen] Toggling block: ${endpoint}`);
              await axiosInstance.patch(endpoint);
              setUsers((prev) =>
                prev.map((u) => u.id === user.id ? { ...u, isBlocked: !u.isBlocked } : u),
              );
            } catch (e: any) {
              console.error('[AdminScreen] Error toggling block:', e);
              Alert.alert('Помилка', e?.response?.data?.message ?? 'Дія не вдалася');
            } finally {
              setActioning(null);
            }
          },
        },
      ],
    );
  };

  // Зміна ролі через PATCH /users/:id/role
  const changeRole = (user: AdminUser) => {
    // Запобігаємо зміні власної ролі адміністратора (самогубство)
    if (currentUser && user.id === currentUser.id && user.systemRole === SystemRole.ADMIN) {
      Alert.alert('Помилка', 'Адміністратор не може змінювати свою власну роль');
      return;
    }
    
    // Виключаємо поточного користувача зі списку для зміни ролі (адмін не може змінювати власну роль)
    const options = ALL_ROLES.filter((r) => r.value !== user.systemRole && r.value !== SystemRole.ADMIN);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.label), 'Скасувати'],
          cancelButtonIndex: options.length,
          title: `Змінити роль: ${user.fullName}`,
          message: `Поточна роль: ${ROLE_LABELS[user.systemRole] ?? user.systemRole}`,
          destructiveButtonIndex: -1,
        },
        async (idx) => {
          if (idx >= options.length) return;
          const result = await doChangeRole(user, options[idx].value);
          if (result.success) {
            Alert.alert('✓', result.message);
          } else {
            Alert.alert('Помилка', result.message);
          }
        },
      );
    } else {
      // Android: Alert з кнопками
      Alert.alert(
        `Змінити роль: ${user.fullName}`,
        `Поточна роль: ${ROLE_LABELS[user.systemRole] ?? user.systemRole}\nОберіть нову:`,
        [
          ...options.map((o) => ({
            text: o.label,
            onPress: async () => {
              const result = await doChangeRole(user, o.value);
              if (result.success) {
                Alert.alert('✓', result.message);
              } else {
                Alert.alert('Помилка', result.message);
              }
            },
          })),
          { text: 'Скасувати', style: 'cancel' as const },
        ],
      );
    }
  };

  const doChangeRole = async (user: AdminUser, newRole: SystemRole) => {
    setActioning(user.id);
    try {
      console.log(`[AdminScreen] Changing role for user ${user.id} to ${newRole}`);
      await axiosInstance.patch(`/users/${user.id}/role`, { systemRole: newRole });
      setUsers((prev) =>
        prev.map((u) => u.id === user.id ? { ...u, systemRole: newRole } : u),
      );
      // Повертаємо результат замість показу Alert тут, щоб уникнути вкладені діалоги на Android
      return { success: true, message: `${user.fullName} тепер ${ROLE_LABELS[newRole]}` };
    } catch (e: any) {
      console.error('[AdminScreen] Error changing role:', e);
      // Повертаємо помилку замість показу Alert тут
      return { success: false, message: e?.response?.data?.message ?? 'Не вдалося змінити роль' };
    } finally {
      setActioning(null);
    }
  };

  // Зміна рівня допуску через PATCH /users/:id/clearance
  const changeClearance = (user: AdminUser) => {
    const options = ALL_CLEARANCE.filter((c) => c.value !== user.clearanceLevel);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.label), 'Скасувати'],
          cancelButtonIndex: options.length,
          title: `Змінити рівень допуску: ${user.fullName}`,
          message: `Поточний: ${CLEARANCE_LABELS[user.clearanceLevel] ?? user.clearanceLevel}`,
        },
        async (idx) => {
          if (idx >= options.length) return;
          await doChangeClearance(user, options[idx].value as ClearanceLevel);
        },
      );
    } else {
      Alert.alert(
        'Змінити рівень допуску',
        `Користувач: ${user.fullName}\nОберіть новий рівень:`,
        [
          ...options.map((o) => ({
            text: o.label,
            onPress: () => doChangeClearance(user, o.value as ClearanceLevel),
          })),
          { text: 'Скасувати', style: 'cancel' },
        ],
      );
    }
  };

  const doChangeClearance = async (user: AdminUser, newLevel: ClearanceLevel) => {
    setActioning(user.id);
    try {
      await usersApi.updateClearance(user.id, newLevel);
      setUsers((prev) =>
        prev.map((u) => u.id === user.id ? { ...u, clearanceLevel: newLevel } : u),
      );
      Alert.alert('Успіх', `Рівень допуску ${user.fullName} змінено на ${CLEARANCE_LABELS[newLevel]}`);
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося змінити рівень допуску');
    } finally {
      setActioning(null);
    }
  };

  const renderUser = ({ item }: { item: AdminUser }) => (
    <View style={[styles.userCard, item.isBlocked && styles.userCardBlocked]}>
      <TouchableOpacity
        style={styles.userInfo}
        onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.avatarSmall}>
          <Text style={styles.avatarText}>{item.fullName[0]?.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.userName} numberOfLines={1}>{item.fullName}</Text>
            {!item.isEmailVerified && <Text style={{ fontSize: 12 }}>✉️</Text>}
            {item.isBlocked && <Text style={{ fontSize: 12 }}>🚫</Text>}
          </View>
          <Text style={styles.userEmail} numberOfLines={1}>{item.email}</Text>
          <View style={styles.badgeRow}>
            {/* Кнопка зміни ролі */}
            <TouchableOpacity
              style={styles.rolePill}
              onPress={() => changeRole(item)}
              disabled={actioning === item.id}
            >
              <Text style={styles.roleText}>
                {ROLE_LABELS[item.systemRole] ?? item.systemRole} ✎
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clearancePill, { borderColor: CLEARANCE_COLORS[item.clearanceLevel] ?? '#999' }]}
              onPress={() => changeClearance(item)}
              disabled={actioning === item.id}
            >
              <View style={[styles.clearanceDot, { backgroundColor: CLEARANCE_COLORS[item.clearanceLevel] ?? '#999' }]} />
              <Text style={styles.clearanceText}>{CLEARANCE_LABELS[item.clearanceLevel] ?? item.clearanceLevel} ✎</Text>
            </TouchableOpacity>
            <Text style={styles.vouchText}>👥 {item.vouchCount ?? 0}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.blockBtn, item.isBlocked && styles.unblockBtn]}
        onPress={() => toggleBlock(item)}
        disabled={actioning === item.id}
      >
        {actioning === item.id
          ? <ActivityIndicator size="small" color="white" />
          : <Text style={styles.blockBtnText}>{item.isBlocked ? 'Розблок.' : 'Блок.'}</Text>
        }
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Адміністрування"
        subtitle="Управління користувачами"
        rightAction={{
          icon: 'person-add-outline',
          onPress: () => navigation.navigate('AdminCreateUser'),
        }}
      />

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Пошук за ім'ям або email..."
          placeholderTextColor="#AAA"
        />
        <TouchableOpacity
          style={styles.devBtn}
          onPress={() => navigation.navigate('DevDBInspector' as never)}
        >
          <Text style={styles.devBtnText}>🗄️ База даних</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>
        Користувачів: {filtered.length}
        {search ? ` (з ${users.length})` : ''}
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        onRefresh={fetchUsers}
        refreshing={loading}
        ListEmptyComponent={
          loading ? null : (
            <View style={{ alignItems: 'center', marginTop: 48 }}>
              <Text style={{ fontSize: 40 }}>👤</Text>
              <Text style={{ color: '#888', marginTop: 8 }}>Користувачів не знайдено</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },

  searchContainer: { padding: 12, paddingBottom: 4 },
  searchInput: {
    backgroundColor: 'white', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0',
    color: '#222',
  },
  countText: { fontSize: 13, color: '#888', paddingHorizontal: 14, marginBottom: 4 },
  list: { padding: 12 },
  devBtn: {
    backgroundColor: '#333', borderRadius: 8,
    padding: 10, marginTop: 8, alignItems: 'center',
  },
  devBtnText: { color: 'white', fontWeight: '700', fontSize: 14 },

  userCard: {
    backgroundColor: 'white', borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 2, elevation: 2,
  },
  userCardBlocked: { opacity: 0.55 },
  userInfo: { flexDirection: 'row', flex: 1, alignItems: 'center', gap: 10 },
  avatarSmall: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: 'white', fontWeight: '700', fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  userName: { fontSize: 14, fontWeight: '600', color: '#222', flexShrink: 1 },
  userEmail: { fontSize: 11, color: '#888', marginTop: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  rolePill: {
    backgroundColor: '#EEF2FF', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#C7D2FE',
  },
  roleText: { fontSize: 11, color: '#4338CA', fontWeight: '600' },
  clearancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F9FAFB', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1,
  },
  clearanceDot: { width: 6, height: 6, borderRadius: 3 },
  clearanceText: { fontSize: 11, color: '#444', fontWeight: '500' },
  vouchText: { fontSize: 11, color: '#666' },

  blockBtn: {
    backgroundColor: '#F44336', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, minWidth: 72, alignItems: 'center',
    flexShrink: 0,
  },
  unblockBtn: { backgroundColor: '#4CAF50' },
  blockBtnText: { color: 'white', fontWeight: '700', fontSize: 12 },
});