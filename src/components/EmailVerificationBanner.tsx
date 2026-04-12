import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { authApi } from '../api/auth.api';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../utils/theme';

/**
 * EmailVerificationBanner — банер підтвердження пошти.
 *
 * Показується на головному екрані якщо emailVerified === false.
 * Дозволяє повторно надіслати лист верифікації.
 */
export function EmailVerificationBanner() {
  const { emailVerified } = useAuth();
  const [sending, setSending]   = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (emailVerified || dismissed) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      const res = await authApi.resendVerification();
      Alert.alert('✅ Надіслано', res.message);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Помилка надсилання';
      Alert.alert('Помилка', msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.banner}>
      <View style={styles.row}>
        <Text style={styles.icon}>📧</Text>
        <View style={styles.textBlock}>
          <Text style={styles.title}>Підтвердіть електронну пошту</Text>
          <Text style={styles.desc}>
            Перевірте вхідні або папку «Спам» і натисніть посилання в листі.
          </Text>
        </View>
        <TouchableOpacity onPress={() => setDismissed(true)} style={styles.closeBtn}>
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.resendBtn}
        onPress={handleResend}
        disabled={sending}
      >
        {sending
          ? <ActivityIndicator size="small" color={Colors.primary} />
          : <Text style={styles.resendText}>Надіслати повторно</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FFF8E1',
    borderLeftWidth: 4,
    borderLeftColor: '#F6AD55',
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    padding: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { fontSize: 22, marginTop: 1 },
  textBlock: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', color: '#744210', marginBottom: 3 },
  desc:  { fontSize: 12, color: '#975A16', lineHeight: 17 },
  closeBtn: { padding: 4 },
  closeIcon: { fontSize: 16, color: '#975A16' },
  resendBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 16,
    backgroundColor: '#FEFCBF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F6AD55',
    minWidth: 60,
    alignItems: 'center',
  },
  resendText: { fontSize: 13, fontWeight: '700', color: '#744210' },
});
