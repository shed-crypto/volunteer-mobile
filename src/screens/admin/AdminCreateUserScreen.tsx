import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader, Button, Input } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { usersApi } from '../../api/users.api';
import { SystemRole, ClearanceLevel } from '../../types';

const ROLES = [
  { label: 'Волонтер', value: SystemRole.VOLUNTEER },
  { label: 'Координатор', value: SystemRole.COORDINATOR },
  { label: 'Адміністратор', value: SystemRole.ADMIN },
  { label: 'Потребуючий', value: SystemRole.REQUESTER },
];

const CLEARANCES = [
  { label: 'Локальний', value: ClearanceLevel.LOCAL },
  { label: 'Міжнародний', value: ClearanceLevel.INTERNATIONAL },
  { label: 'Фронтлайн', value: ClearanceLevel.FRONTLINE },
];

export default function AdminCreateUserScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    password: '',
    phoneNumber: '',
    systemRole: SystemRole.VOLUNTEER,
    clearanceLevel: ClearanceLevel.LOCAL,
  });

  const handleCreate = async () => {
    if (!form.email || !form.fullName || !form.password) {
      Alert.alert('Помилка', 'Заповніть обовʼязкові поля (Email, ПІБ, Пароль)');
      return;
    }

    setLoading(true);
    try {
      await usersApi.create(form);
      Alert.alert('Успіх', 'Користувача створено', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося створити користувача');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Новий користувач" onBack={() => navigation.goBack()} />
      
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        <Input
          label="Email *"
          value={form.email}
          onChangeText={(v) => setForm({ ...form, email: v })}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Input
          label="Повне імʼя *"
          value={form.fullName}
          onChangeText={(v) => setForm({ ...form, fullName: v })}
        />

        <Input
          label="Пароль (мін. 8 симв.) *"
          value={form.password}
          onChangeText={(v) => setForm({ ...form, password: v })}
          secureTextEntry
        />

        <Input
          label="Номер телефону"
          value={form.phoneNumber}
          onChangeText={(v) => setForm({ ...form, phoneNumber: v })}
          keyboardType="phone-pad"
        />

        <Text style={styles.sectionTitle}>Системна роль</Text>
        <View style={styles.chipRow}>
          {ROLES.map((r) => (
            <TouchableOpacity
              key={r.value}
              style={[styles.chip, form.systemRole === r.value && styles.chipActive]}
              onPress={() => setForm({ ...form, systemRole: r.value })}
            >
              <Text style={[styles.chipText, form.systemRole === r.value && styles.chipTextActive]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Рівень допуску</Text>
        <View style={styles.chipRow}>
          {CLEARANCES.map((c) => (
            <TouchableOpacity
              key={c.value}
              style={[styles.chip, form.clearanceLevel === c.value && styles.chipActive]}
              onPress={() => setForm({ ...form, clearanceLevel: c.value })}
            >
              <Text style={[styles.chipText, form.clearanceLevel === c.value && styles.chipTextActive]}>
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ marginTop: 24 }}>
          <Button
            title="Створити користувача"
            onPress={handleCreate}
            loading={loading}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { padding: 16 },
  sectionTitle: {
    fontSize: 14, fontWeight: '600', color: '#666',
    marginTop: 16, marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#F3F4F6',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: 13, color: '#4B5563' },
  chipTextActive: { color: 'white', fontWeight: '600' },
});