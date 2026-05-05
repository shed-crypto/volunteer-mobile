import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Input } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { authApi } from '../../api/auth.api';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ResetPassword'>;
type Route = RouteProp<AuthStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const token = route.params?.token;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      Alert.alert('Помилка', 'Недійсний токен');
      navigation.goBack();
    }
  }, [token]);

  const handleSubmit = async () => {
    if (!token) return;
    if (!password.trim() || !confirmPassword.trim()) {
      Alert.alert('Помилка', 'Заповніть всі поля');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Помилка', 'Паролі не співпадають');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Помилка', 'Пароль має бути мінімум 6 символів');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.resetPassword(token, password);
      Alert.alert('Успіх', response.message);
      navigation.navigate('Login');
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Не вдалося скинути пароль';
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text style={styles.formTitle}>Встановлення пароля</Text>
          <Text style={styles.subtitle}>Введіть новий пароль для вашого акаунту.</Text>

          <Input
            label="Новий пароль"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />

          <Input
            label="Підтвердження"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
          />

          <Button
            title="Змінити пароль"
            onPress={handleSubmit}
            loading={loading}
            size="lg"
            style={{ marginTop: 20 }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background, padding: 24, justifyContent: 'center' },
  form: { backgroundColor: Colors.surface, padding: 24, borderRadius: 16 },
  formTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 12 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 20 },
});
