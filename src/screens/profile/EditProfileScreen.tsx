/**
 * EditProfileScreen.tsx — Редагування власного профілю (FR-01e)
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import { Button, Input } from '../../components/ui';
import { Colors } from '../../utils/theme';
import api from '../../api/axios';
import { getMediaUrl, fileUtils } from '../../utils/fileUtils';

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const { user, refreshUser } = useAuth();

  const [fullName, setFullName]       = useState(user?.fullName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? '');
  const [telegramId, setTelegramId]   = useState(user?.telegramId ?? '');
  const [avatarUploading, setAvatarUploading] = useState(false);
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

  const handlePickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Помилка', 'Потрібен дозвіл на доступ до галереї');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const fileUri = result.assets[0].uri;
      setAvatarUploading(true);

      // Завантаження як у orgs.api — appendImage + formData
      const rawName = fileUri.split('/').pop() || 'avatar.jpg';
      const ext = rawName.split('.').pop()?.toLowerCase();
      const fallbackType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const normalized = await fileUtils.normalizeImagePickerAsset(fileUri, rawName, fallbackType);

      const formData = new FormData();
      formData.append('file', { uri: normalized.uri, name: normalized.name, type: normalized.mimeType } as any);

      const { url } = await api.post('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data);

      console.log('[Avatar] upload success, url:', url);
      await refreshUser();
      Alert.alert('✓', 'Аватарку оновлено');
    } catch (e) {
      console.error('[Avatar] error:', e);
      Alert.alert('Помилка', 'Не вдалося завантажити аватарку');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await api.patch('/users/me', {
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

        {/* ─── Аватарка ────────────────────────────────────────────────────── */}
        <TouchableOpacity onPress={handlePickAvatar} style={styles.avatarSection} disabled={avatarUploading}>
          {user?.avatarUrl ? (
            <Image source={{ uri: getMediaUrl(user.avatarUrl) }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarPlaceholderText}>
                {user?.fullName?.charAt(0)?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          <Text style={styles.avatarChangeText}>
            {avatarUploading ? 'Завантаження...' : 'Змінити аватарку'}
          </Text>
        </TouchableOpacity>

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

  // Аватарка
  avatarSection: { alignItems: 'center', marginBottom: 20 },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 8 },
  avatarPlaceholder: { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholderText: { fontSize: 36, fontWeight: '700', color: Colors.primary },
  avatarChangeText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  hint: {
    backgroundColor: '#E8F4FD', borderRadius: 10, padding: 12, marginVertical: 8,
  },
  hintText: { fontSize: 13, color: '#1a56db', lineHeight: 18 },
  saveBtn: { marginTop: 16 },
  cancelBtn: { alignItems: 'center', marginTop: 12, padding: 12 },
  cancelText: { color: Colors.primary, fontSize: 15 },
});
