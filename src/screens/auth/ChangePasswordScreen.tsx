import React, { useState } from 'react';
import { View, Text, Alert, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Input } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { MainStackParamList } from '../../navigation/MainNavigator';
import { authApi } from '../../api/auth.api';

type Nav = NativeStackNavigationProp<MainStackParamList, 'ChangePassword'>;

export default function ChangePasswordScreen() {
  const navigation = useNavigation<Nav>();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (newPassword !== confirmPassword) {
      Alert.alert('Помилка', 'Нові паролі не збігаються');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Помилка', 'Пароль повинен бути щонайменше 8 символів');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.changePassword(oldPassword, newPassword);
      Alert.alert('Успіх', response.message);
      navigation.goBack();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Не вдалося змінити пароль';
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text style={styles.formTitle}>Зміна пароля</Text>

          <Input
            label="Старий пароль"
            value={oldPassword}
            onChangeText={setOldPassword}
            secureTextEntry
            placeholder="••••••••"
          />
          <Input
            label="Новий пароль"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            placeholder="••••••••"
          />
          <Input
            label="Підтвердження"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="••••••••"
          />

          <Button
            title="Зберегти"
            onPress={handleChange}
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
  formTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 20 },
});
