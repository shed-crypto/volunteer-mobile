/**
 * EditProfileScreen.tsx — Редагування власного профілю (FR-01e)
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { Button, Input } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { axiosInstance } from '../../api/axios';

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const { user, refreshUser } = useAuth();

  const [fullName, setFullName]       = useState(user?.fullName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? '');
  const [telegramId, setTelegramId]   = useState(user?.telegramId ?? '');
  const [loading, setLoading]         = useState(false);
  const [errors, setErrors]           = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = 'Введіть ім\'я';
    if (phoneNumber && !/^\+?\d{10,15}$/.test(phoneNumber.replace(/\s/g, '')))
      e.phoneNumber = 'Невірний формат телефону';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await axiosInstance.patch('/users/me', {
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim() || null,
        telegramId: telegramId.trim() || null,
      });
      await refreshUser();
      Alert.alert('Збережено', 'Профіль успішно оновлено');
      navigation.goBack();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Помилка при збереженні';
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Редагування профілю</Text>

        <Input
          label="Повне ім'я *"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          error={errors.fullName}
          placeholder="Ваше ім'я та прізвище"
        />

        <Input
          label="Номер телефону"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
          error={errors.phoneNumber}
          placeholder="+380XXXXXXXXX"
        />

        <Input
          label="Telegram ID"
          value={telegramId}
          onChangeText={setTelegramId}
          autoCapitalize="none"
          placeholder="@username"
        />

        <View style={styles.hint}>
          <Text style={styles.hintText}>
            💡 Telegram ID використовується для отримання сповіщень про нові заявки та зміни статусу.
          </Text>
        </View>

        <Button
          title="Зберегти зміни"
          onPress={handleSave}
          loading={loading}
          style={styles.saveBtn}
        />

        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Скасувати</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, gap: 4 },
  title: { fontSize: 22, fontWeight: '700', color: '#222', marginBottom: 20 },
  hint: {
    backgroundColor: '#E8F4FD', borderRadius: 10, padding: 12, marginVertical: 8,
  },
  hintText: { fontSize: 13, color: '#1a56db', lineHeight: 18 },
  saveBtn: { marginTop: 16 },
  cancelBtn: { alignItems: 'center', marginTop: 12, padding: 12 },
  cancelText: { color: Colors.primary, fontSize: 15 },
});
