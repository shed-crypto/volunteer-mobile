import React, { useState, useEffect } from 'react';
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
import { useBiometrics } from '../../hooks/useBiometrics';
import { authApi } from '../../api/auth.api';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export default function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { login } = useAuth();
  const biometrics = useBiometrics();

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [errors, setErrors]       = useState<{ email?: string; password?: string }>({});

  // Перевіряємо чи є збережена біометрія при завантаженні
  useEffect(() => {
    biometrics.isBiometricEnabled().then(setBioEnabled);
  }, []);

  const validate = () => {
    const e: typeof errors = {};
    if (!email.trim()) e.email = 'Введіть email';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Невірний формат email';
    if (!password) e.password = 'Введіть пароль';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Невірний email або пароль';
      Alert.alert('Помилка входу', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Вхід через біометрію ────────────────────────────────────────────────
  const handleBiometricLogin = async () => {
    setBioLoading(true);
    try {
      const credentials = await biometrics.authenticateWithBiometric();
      if (!credentials) return; // скасовано або не підтримується

      await login(credentials.email, credentials.password);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Помилка авторизації';
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setBioLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>🇺🇦</Text>
          <Text style={styles.heroTitle}>Волонтерська{'\n'}допомога</Text>
          <Text style={styles.heroSub}>Координація. Безпека. Довіра.</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.formTitle}>Увійти</Text>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="your@email.com"
            error={errors.email}
          />
          <Input
            label="Пароль"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
            error={errors.password}
          />

          <Button
            title="Увійти"
            onPress={handleLogin}
            loading={loading}
            size="lg"
            style={{ marginTop: 4 }}
          />

          {/* Кнопка біометрії — показуємо якщо раніше була ввімкнена */}
          {bioEnabled && (
            <TouchableOpacity
              style={styles.biometricBtn}
              onPress={handleBiometricLogin}
              disabled={bioLoading}
            >
              <Text style={styles.biometricIcon}>
                {Platform.OS === 'ios' ? '🔒' : '👆'}
              </Text>
              <Text style={styles.biometricText}>
                {bioLoading ? 'Перевірка...' : 'Увійти через відбиток/Face ID'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Register')}>
            <Text style={styles.linkText}>Немає акаунту? <Text style={styles.link}>Зареєструватися</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background },
  hero: {
    backgroundColor: Colors.primary,
    alignItems: 'center',
    paddingTop: 80,
    paddingBottom: 48,
    paddingHorizontal: 24,
  },
  heroIcon: { fontSize: 64, marginBottom: 16 },
  heroTitle: {
    color: '#fff', fontSize: 32, fontWeight: '800',
    textAlign: 'center', lineHeight: 38,
  },
  heroSub: { color: 'rgba(255,255,255,0.8)', fontSize: 15, marginTop: 8 },
  form: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    marginTop: -16,
    padding: 24,
    flex: 1,
  },
  formTitle: {
    fontSize: 22, fontWeight: '800', color: Colors.text,
    marginBottom: 20,
  },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
  },
  biometricIcon: { fontSize: 22 },
  biometricText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  linkRow: { alignItems: 'center', marginTop: 20 },
  linkText: { fontSize: 14, color: Colors.textSecondary },
  link: { color: Colors.primary, fontWeight: '700' },
});
