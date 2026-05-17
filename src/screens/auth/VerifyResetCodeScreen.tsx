import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, Alert, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { authApi } from '../../api/auth.api';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'VerifyResetCode'>;
type Route = RouteProp<AuthStackParamList, 'VerifyResetCode'>;

export default function VerifyResetCodeScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { email } = route.params;

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handleCodeChange = (text: string, index: number) => {
    const newCode = [...code];
    // Беремо тільки останній символ якщо вставили більше
    newCode[index] = text.replace(/[^0-9]/g, '').slice(-1);
    setCode(newCode);

    // Автоматично переходимо до наступного поля
    if (newCode[index] && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      Alert.alert('Помилка', 'Введіть повний 6-значний код');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.verifyResetCode(email, fullCode);
      navigation.replace('CreateNewPassword', { token: response.token });
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Невірний код';
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await authApi.requestPasswordReset(email);
      Alert.alert('Успіх', 'Код надіслано повторно');
    } catch {
      Alert.alert('Помилка', 'Не вдалося надіслати код повторно');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text style={styles.formTitle}>Підтвердження коду</Text>
          <Text style={styles.subtitle}>
            Введіть 6-значний код, який ми надіслали на {'\n'}
            <Text style={styles.emailText}>{email}</Text>
          </Text>

          <View style={styles.codeRow}>
            {code.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => { inputRefs.current[index] = ref; }}
                style={[
                  styles.codeInput,
                  digit ? styles.codeInputFilled : null,
                ]}
                value={digit}
                onChangeText={(text) => handleCodeChange(text, index)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

          <Button
            title="Підтвердити"
            onPress={handleVerify}
            loading={loading}
            size="lg"
            style={{ marginTop: 24 }}
          />

          <TouchableOpacity style={styles.resendBtn} onPress={handleResend}>
            <Text style={styles.resendText}>Надіслати код повторно</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background, padding: 24, justifyContent: 'center' },
  form: { backgroundColor: Colors.surface, padding: 24, borderRadius: 16 },
  formTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 12 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 24, lineHeight: 22 },
  emailText: { fontWeight: '700', color: Colors.primary },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  codeInput: {
    width: 48,
    height: 56,
    borderWidth: 2,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  codeInputFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  resendBtn: { alignItems: 'center', marginTop: 20 },
  resendText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
});