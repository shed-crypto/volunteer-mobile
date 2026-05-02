import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle, TextInput, TextInputProps, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, urgencyColors, statusColors } from '../utils/theme';

// ─── Button ───────────────────────────────────────────────────────────────────

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({
  title, onPress, variant = 'primary', size = 'md',
  loading, disabled, style,
}: ButtonProps) {
  const bg: Record<string, string> = {
    primary: Colors.primary, secondary: Colors.secondary,
    danger: Colors.danger, outline: 'transparent', ghost: 'transparent',
  };
  const fg: Record<string, string> = {
    primary: '#fff', secondary: '#fff',
    danger: '#fff', outline: Colors.primary, ghost: Colors.textSecondary,
  };
  const border: Record<string, string> = {
    primary: Colors.primary, secondary: Colors.secondary,
    danger: Colors.danger, outline: Colors.primary, ghost: 'transparent',
  };
  const pad: Record<string, { paddingVertical: number; paddingHorizontal: number }> = {
    sm: { paddingVertical: 6, paddingHorizontal: 12 },
    md: { paddingVertical: 12, paddingHorizontal: 20 },
    lg: { paddingVertical: 16, paddingHorizontal: 28 },
  };
  const fontSize: Record<string, number> = { sm: 13, md: 15, lg: 17 };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        {
          backgroundColor: disabled ? Colors.borderLight : bg[variant],
          borderWidth: 1.5,
          borderColor: disabled ? Colors.border : border[variant],
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          ...pad[size],
        },
        style,
      ]}
    >
      {loading && <ActivityIndicator size="small" color={fg[variant]} />}
      <Text style={{ color: disabled ? Colors.textMuted : fg[variant], fontWeight: '600', fontSize: fontSize[size] }}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

// ─── ConfirmDeleteModal ──────────────────────────────────────────────────────

interface ConfirmDeleteModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  targetName: string;
  title?: string;
  description?: string;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ 
  visible, onClose, onConfirm, targetName, 
  title = 'Видалити?', 
  description = `Введіть "${targetName}" для підтвердження` 
}) => {
  const [text, setText] = useState('');

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={modalStyles.overlay}>
        <View style={modalStyles.container}>
          <Text style={modalStyles.title}>{title}</Text>
          <Text style={modalStyles.desc}>{description}</Text>
          <TextInput 
            style={modalStyles.input} 
            value={text} 
            onChangeText={setText} 
            placeholder="Введіть назву тут..."
          />
          <View style={modalStyles.buttons}>
            <TouchableOpacity style={[modalStyles.button, modalStyles.cancel]} onPress={onClose}>
              <Text>Скасувати</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[modalStyles.button, modalStyles.confirm, text !== targetName && modalStyles.disabled]} 
              onPress={() => { onConfirm(); setText(''); }}
              disabled={text !== targetName}
            >
              <Text style={modalStyles.confirmText}>Видалити</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  container: { backgroundColor: '#fff', padding: 20, borderRadius: 12 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  desc: { marginBottom: 15, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 20 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8 },
  cancel: { backgroundColor: '#eee' },
  confirm: { backgroundColor: Colors.danger },
  disabled: { opacity: 0.5 },
  confirmText: { color: '#fff', fontWeight: '600' }
});

// ─── Other Components ──────────────────────────────────────────────────────

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: Colors.borderLight }, style]}>
      {children}
    </View>
  );
}

interface BadgeProps {
  label: string;
  colorScheme?: 'urgency' | 'status' | 'neutral';
  value?: string;
  size?: 'sm' | 'md';
  color?: string;
}

export function Badge({ label, colorScheme = 'neutral', value, size = 'md', color }: BadgeProps) {
  let bg = Colors.borderLight;
  let fg = Colors.textSecondary;

  if (color) {
    bg = color + '22';
    fg = color;
  } else if (colorScheme === 'urgency' && value && urgencyColors[value]) {
    bg = urgencyColors[value].bg;
    fg = urgencyColors[value].text;
  } else if (colorScheme === 'status' && value && statusColors[value]) {
    bg = statusColors[value].bg;
    fg = statusColors[value].text;
  }

  return (
    <View style={{ backgroundColor: bg, paddingVertical: size === 'sm' ? 2 : 4, paddingHorizontal: size === 'sm' ? 6 : 10, borderRadius: 20, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: size === 'sm' ? 11 : 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode | { icon: string; onPress: () => void };
}

export function ScreenHeader({ title, subtitle, onBack, rightAction }: HeaderProps) {
  let rightNode: React.ReactNode = null;
  if (rightAction) {
    if (typeof rightAction === 'object' && 'icon' in (rightAction as any) && 'onPress' in (rightAction as any)) {
      const { icon, onPress } = rightAction as { icon: string; onPress: () => void };
      rightNode = (
        <TouchableOpacity onPress={onPress} style={{ padding: 6 }}>
          <Ionicons name={icon as any} size={24} color="#fff" />
        </TouchableOpacity>
      );
    } else {
      rightNode = rightAction as React.ReactNode;
    }
  }

  return (
    <View style={{ backgroundColor: Colors.primary, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={{ padding: 4, marginRight: 4 }}>
          <Text style={{ color: '#fff', fontSize: 24 }}>←</Text>
        </TouchableOpacity>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{title}</Text>
        {subtitle && <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      {rightNode}
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
      <Text style={{ fontSize: 56, marginBottom: 16 }}>{icon}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: Colors.text, textAlign: 'center' }}>{title}</Text>
      {subtitle && <Text style={{ fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 8 }}>{subtitle}</Text>}
    </View>
  );
}

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, hint, containerStyle, style, ...props }: InputProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isPassword = props.secureTextEntry;

  return (
    <View style={[{ marginBottom: 16 }, containerStyle]}>
      {label && <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 6 }}>{label}</Text>}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: error ? Colors.danger : Colors.border,
        borderRadius: 10,
        backgroundColor: Colors.surface,
      }}>
        <TextInput
          placeholderTextColor={Colors.textMuted}
          style={[{
            flex: 1,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            color: Colors.text,
          }, style]}
          {...props}
          secureTextEntry={isPassword && !isPasswordVisible}
        />
        {isPassword && (
          <TouchableOpacity
            onPress={() => setIsPasswordVisible(!isPasswordVisible)}
            style={{ padding: 12 }}
          >
            <Ionicons
              name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={{ color: Colors.danger, fontSize: 12, marginTop: 4 }}>{error}</Text>}
      {hint && !error && <Text style={{ color: Colors.textMuted, fontSize: 12, marginTop: 4 }}>{hint}</Text>}
    </View>
  );
}

export function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

export function ProgressBar({ value, total, color = Colors.primary }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min((value / total) * 100, 100) : 0;
  return (
    <View style={{ height: 6, backgroundColor: Colors.borderLight, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}