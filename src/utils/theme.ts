export const Colors = {
  primary: '#1a56db',
  primaryDark: '#1347b8',
  primaryLight: '#e8f0fe',
  secondary: '#0e9f6e',
  secondaryLight: '#def7ec',
  danger: '#e02424',
  dangerLight: '#fde8e8',
  warning: '#c27803',
  warningLight: '#fdf6b2',
  success: '#0e9f6e',
  successLight: '#def7ec',
  error: '#e02424',
  text: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  border: '#e5e7eb',
  borderLight: '#f3f4f6',
  background: '#f9fafb',
  surface: '#ffffff',
  overlay: 'rgba(0,0,0,0.5)',
};

export const urgencyColors: Record<string, { bg: string; text: string; label: string }> = {
  low:      { bg: '#f3f4f6', text: '#374151',  label: 'Низька' },
  medium:   { bg: '#fdf6b2', text: '#92400e',  label: 'Середня' },
  high:     { bg: '#fde8e8', text: '#c81e1e',  label: 'Висока' },
  critical: { bg: '#fde8e8', text: '#7e1d1d',  label: 'КРИТИЧНА' },
};

export const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  open:            { bg: '#e8f0fe', text: '#1347b8', label: 'Відкрита' },
  in_progress:     { bg: '#def7ec', text: '#03543f', label: 'Виконується' },
  partially_done:  { bg: '#fdf6b2', text: '#92400e', label: 'Частково' },
  pending_review:  { bg: '#fde8e8', text: '#9b1c1c', label: 'На перевірці' },
  completed:       { bg: '#f3f4f6', text: '#374151', label: 'Завершена' },
  cancelled:       { bg: '#f3f4f6', text: '#9ca3af', label: 'Скасована' },
  todo:            { bg: '#f3f4f6', text: '#374151', label: 'До виконання' },
  done:            { bg: '#def7ec', text: '#03543f', label: 'Виконано' },
};

export const categoryLabels: Record<string, string> = {
  medical:       '🏥 Медична',
  evacuation:    '🚗 Евакуація',
  logistics:     '📦 Логістика',
  military:      '🪖 Військо',
  humanitarian:  '🤝 Гуманітарна',
  shelter:       '🏠 Житло',
  psychological: '🧠 Психологічна',
  other:         '📋 Інше',
};

export const clearanceLabels: Record<string, string> = {
  local:         '📍 Локальний',
  international: '🌍 Міжнародний',
  frontline:     '⚔️ Фронтовий',
};

export const roleLabels: Record<string, string> = {
  admin:       '👑 Адміністратор',
  coordinator: '🎯 Координатор',
  volunteer:   '🙋 Волонтер',
  requester:   '📨 Потребуючий',
};
