import React, { useState } from 'react';
import { View, Text, Alert, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Input } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { authApi } from '../../api/auth.api';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>;

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequestReset = async () => {
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      Alert.alert('Помилка', 'Введіть коректний email');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.requestPasswordReset(email.trim().toLowerCase());
      Alert.alert('Успіх', response.message);
      navigation.goBack();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Не вдалося надіслати запит';
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text style={styles.formTitle}>Відновлення пароля</Text>
          <Text style={styles.subtitle}>Введіть ваш email, щоб отримати посилання для скидання пароля.</Text>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="your@email.com"
          />

          <Button
            title="Надіслати"
            onPress={handleRequestReset}
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
