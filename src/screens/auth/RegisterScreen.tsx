import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../context/AuthContext';
import { Button, Input } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { SystemRole } from '../../types';
import { useBiometrics } from '../../hooks/useBiometrics';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Register'>;

// Обмежений список ролей для самостійної реєстрації.
// COORDINATOR та ADMIN призначаються лише адміністратором.
const ROLES = [
  { value: SystemRole.VOLUNTEER,  label: '🙋 Волонтер',    desc: 'Виконую завдання' },
  { value: SystemRole.REQUESTER,  label: '📨 Потребуючий', desc: 'Потребую допомоги' },
];

export default function RegisterScreen() {
  const navigation = useNavigation<Nav>();
  const { register } = useAuth();
  const biometrics = useBiometrics();

  const [fullName, setFullName]   = useState('');
  const [email, setEmail]         = useState('');
  const [phone, setPhone]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [role, setRole]           = useState<SystemRole.VOLUNTEER | SystemRole.REQUESTER>(SystemRole.VOLUNTEER);
  const [loading, setLoading]     = useState(false);
  const [errors, setErrors]       = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim() || fullName.trim().length < 2) e.fullName = 'Введіть ім\'я (мін. 2 символи)';
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) e.email = 'Невірний формат email';
    if (!password || password.length < 8) e.password = 'Пароль — мін. 8 символів';
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) e.password = 'Потрібні великі, малі літери та цифра';
    if (password !== confirm) e.confirm = 'Паролі не співпадають';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      // ─── БАГ-ФІКс: передаємо systemRole ──────────────────────────────────
      await register({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        phoneNumber: phone || undefined,
        systemRole: role,  // ← раніше не передавалось
      });

      // Пропонуємо ввімкнути біометрію після успішної реєстрації
      const supported = await biometrics.checkSupport();
      if (supported) {
        Alert.alert(
          '🔒 Біометричний вхід',
          'Хочете увімкнути вхід за відбитком пальця / Face ID для швидкого доступу?',
          [
            { text: 'Пізніше', style: 'cancel' },
            {
              text: 'Увімкнути',
              onPress: async () => {
                await biometrics.enableBiometric(
                  email.trim().toLowerCase(),
                  password,
                );
              },
            },
          ],
        );
      }

      // Показуємо нагадування про підтвердження пошти
      Alert.alert(
        '📧 Підтвердіть пошту',
        `На адресу ${email.trim().toLowerCase()} надіслано лист з посиланням для підтвердження. Перевірте вхідні (і папку "Спам").`,
        [{ text: 'Зрозуміло' }],
      );

    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Помилка реєстрації';
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={{ color: '#fff', fontSize: 24 }}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Реєстрація</Text>
        </View>

        <View style={styles.form}>
          {/* Role selector */}
          <Text style={styles.sectionLabel}>Хто ви?</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => (
              <TouchableOpacity
                key={r.value}
                onPress={() => setRole(r.value as SystemRole.VOLUNTEER | SystemRole.REQUESTER)}
                style={[styles.roleCard, role === r.value && styles.roleCardActive]}
              >
                <Text style={styles.roleIcon}>{r.label.split(' ')[0]}</Text>
                <Text style={[styles.roleLabel, role === r.value && { color: Colors.primary }]}>
                  {r.label.split(' ').slice(1).join(' ')}
                </Text>
                <Text style={styles.roleDesc}>{r.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input label="Повне ім'я" value={fullName} onChangeText={setFullName}
            placeholder="Іван Петренко" autoCapitalize="words" error={errors.fullName} />
          <Input label="Email" value={email} onChangeText={setEmail}
            keyboardType="email-address" autoCapitalize="none"
            placeholder="your@email.com" error={errors.email} />
          <Input label="Телефон (необов'язково)" value={phone} onChangeText={setPhone}
            keyboardType="phone-pad" placeholder="+380501234567" />
          <Input label="Пароль" value={password} onChangeText={setPassword}
            secureTextEntry placeholder="Мін. 8 символів, є цифри та літери"
            error={errors.password} />
          <Input label="Підтвердити пароль" value={confirm} onChangeText={setConfirm}
            secureTextEntry placeholder="••••••••" error={errors.confirm} />

          <Button title="Зареєструватися" onPress={handleRegister}
            loading={loading} size="lg" style={{ marginTop: 4 }} />

          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.goBack()}>
            <Text style={styles.linkText}>
              Вже маєте акаунт? <Text style={styles.link}>Увійти</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: 52, paddingBottom: 20, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  form: { padding: 20 },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  roleCard: {
    flex: 1, borderWidth: 2, borderColor: Colors.border,
    borderRadius: 12, padding: 10, alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  roleCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  roleIcon: { fontSize: 24, marginBottom: 4 },
  roleLabel: { fontSize: 12, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  roleDesc: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 2 },
  linkRow: { alignItems: 'center', marginTop: 20, paddingBottom: 20 },
  linkText: { fontSize: 14, color: Colors.textSecondary },
  link: { color: Colors.primary, fontWeight: '700' },
});
