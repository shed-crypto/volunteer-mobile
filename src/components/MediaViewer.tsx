import React, { useState } from 'react';
import { Modal, View, Image, TouchableOpacity, StyleSheet, Text, ActivityIndicator, Alert } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Нормалізує URL: якщо це відносний шлях (/uploads/...), додає базову URL сервера.
 */
function normalizeUrl(url: string): string {
  if (/^(https?:|file:|content:|data:)/i.test(url)) return url;
  const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.12:3000/api')
    .replace('/api', '');
  const clean = url.startsWith('/') ? url : `/${url}`;
  return `${base}${clean}`;
}

interface MediaViewerProps {
  visible: boolean;
  url: string;
  type: 'image' | 'video';
  onClose: () => void;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({ visible, url, type, onClose }) => {
  const [saving, setSaving] = useState(false);
  const fullUrl = normalizeUrl(url);

  const handleShare = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const filename = url.split('/').pop() || 'file';
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      const info = await FileSystem.getInfoAsync(localUri);
      if (info.exists) await FileSystem.deleteAsync(localUri, { idempotent: true });
      const downloadRes = await FileSystem.downloadAsync(fullUrl, localUri);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadRes.uri);
      }
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося відкрити файл');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={saving}>
            <Text style={styles.shareText}>{saving ? '⏳' : '⬇'}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mediaContainer}>
          {type === 'image' && (
            <Image source={{ uri: fullUrl }} style={styles.image} resizeMode="contain" />
          )}
          {type === 'video' && (
            <Video
              source={{ uri: fullUrl }}
              style={styles.image}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

/**
 * VideoThumbnail — показує прев'ю відео.
 * Використовує простий підхід: іконка з кнопкою відтворення.
 * Не використовує expo-video-thumbnails через несумісність з поточною версією Expo SDK.
 */
export const VideoThumbnail: React.FC<{ uri: string, onPress: () => void }> = ({ uri, onPress }) => {
  const fullUri = normalizeUrl(uri);

  return (
    <TouchableOpacity onPress={onPress} style={styles.thumbContainer}>
      <Text style={{ fontSize: 48, opacity: 0.3 }}>🎥</Text>
      <View style={styles.playIcon}>
        <Text style={{ fontSize: 40 }}>▶️</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 50, width: '100%' },
  shareBtn: { padding: 10 },
  shareText: { color: '#fff', fontSize: 24 },
  closeBtn: { padding: 10 },
  closeText: { color: '#fff', fontSize: 30 },
  mediaContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: {
    width: '100%',
    height: '100%',
  },
  thumbContainer: {
    width: 220,
    height: 160,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  playIcon: { position: 'absolute' },
});