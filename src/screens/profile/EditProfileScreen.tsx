/**
 * EditProfileScreen.tsx — Редагування власного профілю (FR-01e)
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import { Button, Input, ScreenHeader } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { API_BASE_URL, checkServerReachable } from '../../api/axios';
import api from '../../api/axios';
import { uploadFormData } from '../../api/upload';
import { getMediaUrl, fileUtils } from '../../utils/fileUtils';
import { collections, safeWrite } from '../../db/index';

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const { user, refreshUser } = useAuth();

  const [fullName, setFullName]       = useState(user?.fullName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? '');
  const [telegramId, setTelegramId]   = useState(user?.telegramId ?? '');
  const [localAvatarUri, setLocalAvatarUri] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [errors, setErrors]           = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = "Введіть ім'я";
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

      // Зберігаємо локальний URI — нікуди не відправляємо, чекаємо "Зберегти зміни"
      setLocalAvatarUri(result.assets[0].uri);
    } catch (e) {
      console.error('[Avatar] pick error:', e);
      Alert.alert('Помилка', 'Не вдалося вибрати зображення');
    }
  };

  /** Відправляє аватарку на сервер (якщо вибрана) */
  const uploadAvatarIfNeeded = async (): Promise<boolean> => {
    if (!localAvatarUri) return true; // нічого завантажувати

    try {
      setAvatarUploading(true);
      const rawName = localAvatarUri.split('/').pop() || 'avatar.jpg';
      const ext = rawName.split('.').pop()?.toLowerCase();
      const fallbackType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const normalized = await fileUtils.normalizeImagePickerAsset(localAvatarUri, rawName, fallbackType);

      const formData = new FormData();
      formData.append('file', { uri: normalized.uri, name: normalized.name, type: normalized.mimeType } as any);

      const avatarEndpoint = `${API_BASE_URL}/chats/avatar`;
      await uploadFormData<{ url: string }>(avatarEndpoint, formData);
      return true;
    } catch (e) {
      console.error('[Avatar] upload error:', e);
      return false;
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);

    try {
      // Якщо сервер недоступний — зберігаємо в чергу
      const serverOk = await checkServerReachable();
      if (!serverOk) {
        // Зберігаємо дані профілю для пізнішої синхронізації
        const pending = {
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim() || null,
          telegramId: telegramId.trim() || null,
          localAvatarUri,
          timestamp: Date.now(),
        };
        await AsyncStorage.setItem(PENDING_AVATAR_KEY, JSON.stringify(pending));
        Alert.alert(
          'Збережено локально',
          "Зміни будуть відправлені, коли з'явиться з'єднання з сервером.",
        );
        navigation.goBack();
        return;
      }

      // Завантажуємо аватарку (якщо вибрана)
      const avatarOk = await uploadAvatarIfNeeded();
      if (!avatarOk) {
        Alert.alert('Помилка', 'Не вдалося завантажити аватарку. Спробуйте ще раз.');
        return;
      }

      // Оновлюємо профіль
      if (user) {
        await api.patch(`/users/${user.id}`, {
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim() || null,
          telegramId: telegramId.trim() || null,
        });
      }
      await refreshUser();
      Alert.alert('Збережено', 'Профіль успішно оновлено');
      navigation.goBack();
    } catch (err: any) {
      // Якщо помилка — зберігаємо в чергу для офлайн-синхронізації
      try {
        const pending = {
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim() || null,
          telegramId: telegramId.trim() || null,
          localAvatarUri,
          timestamp: Date.now(),
        };
        await AsyncStorage.setItem(PENDING_AVATAR_KEY, JSON.stringify(pending));
        Alert.alert(
          'Збережено локально',
          "Зміни будуть відправлені, коли з'явиться з'єднання з сервером.",
        );
        navigation.goBack();
      } catch {
        const msg = err?.response?.data?.message || 'Помилка при збереженні';
        Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const avatarSource = localAvatarUri
    ? { uri: localAvatarUri }
    : user?.avatarUrl
      ? { uri: getMediaUrl(user.avatarUrl) }
      : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenHeader title="Редагування профілю" onBack={() => navigation.goBack()} />

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── Аватарка ──────────────────────────────────────────────────── */}
          <TouchableOpacity onPress={handlePickAvatar} style={styles.avatarSection} disabled={avatarUploading}>
            {avatarSource ? (
              <Image source={avatarSource} style={styles.avatar} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 4 },

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