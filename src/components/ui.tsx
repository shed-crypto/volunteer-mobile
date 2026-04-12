import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle,
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

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: Colors.borderLight }, style]}>
      {children}
    </View>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

interface BadgeProps {
  label: string;
  colorScheme?: 'urgency' | 'status' | 'neutral';
  value?: string;
  size?: 'sm' | 'md';
  /** Direct hex color — overrides colorScheme */
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

// ─── Screen Header ────────────────────────────────────────────────────────────

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Either a ReactNode or a shorthand { icon, onPress } object */
  rightAction?: React.ReactNode | { icon: string; onPress: () => void };
}

export function ScreenHeader({ title, subtitle, onBack, rightAction }: HeaderProps) {
  // Resolve rightAction: if it's a plain object with icon+onPress, render an icon button
  let rightNode: React.ReactNode = null;
  if (rightAction) {
    if (
      typeof rightAction === 'object' &&
      'icon' in (rightAction as any) &&
      'onPress' in (rightAction as any)
    ) {
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

// ─── Empty State ──────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
      <Text style={{ fontSize: 56, marginBottom: 16 }}>{icon}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: Colors.text, textAlign: 'center' }}>{title}</Text>
      {subtitle && <Text style={{ fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 8 }}>{subtitle}</Text>}
    </View>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

import { TextInput, TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, hint, containerStyle, style, ...props }: InputProps) {
  return (
    <View style={[{ marginBottom: 16 }, containerStyle]}>
      {label && <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 6 }}>{label}</Text>}
      <TextInput
        placeholderTextColor={Colors.textMuted}
        style={[{
          borderWidth: 1.5,
          borderColor: error ? Colors.danger : Colors.border,
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          backgroundColor: Colors.surface,
          color: Colors.text,
        }, style]}
        {...props}
      />
      {error && <Text style={{ color: Colors.danger, fontSize: 12, marginTop: 4 }}>{error}</Text>}
      {hint && !error && <Text style={{ color: Colors.textMuted, fontSize: 12, marginTop: 4 }}>{hint}</Text>}
    </View>
  );
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

export function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

export function ProgressBar({ value, total, color = Colors.primary }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min((value / total) * 100, 100) : 0;
  return (
    <View style={{ height: 6, backgroundColor: Colors.borderLight, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}
