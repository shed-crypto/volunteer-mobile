import React, { useState, useEffect } from 'react';
import { Modal, View, Image, TouchableOpacity, StyleSheet, Text, ActivityIndicator, Alert } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

interface MediaViewerProps {
  visible: boolean;
  url: string;
  type: 'image' | 'video' | 'document';
  onClose: () => void;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({ visible, url, type, onClose }) => {
  const [saving, setSaving] = useState(false);

  const handleOpen = async () => {
    try {
      const filename = url.split('/').pop() || 'file';
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      const downloadRes = await FileSystem.downloadAsync(url, localUri);
      await Sharing.shareAsync(downloadRes.uri);
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося відкрити файл');
    }
  };

  const handleSaveToDevice = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const filename = url.split('/').pop() || 'file';
      const localUri = `${FileSystem.documentDirectory}${filename}`;
      const downloadRes = await FileSystem.downloadAsync(url, localUri);
      Alert.alert('✅', `Файл збережено на пристрій\n${localUri}`);
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося зберегти файл на пристрій');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent={true} animationType="fade">
      <View style={styles.container}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>

        {type === 'image' && (
          <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
        )}
        {type === 'video' && (
          <Video
            source={{ uri: url }}
            style={styles.image}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay
          />
        )}
        {type === 'document' && (
          <View style={styles.docPlaceholder}>
            <Text style={{ fontSize: 60 }}>📄</Text>
            <TouchableOpacity style={styles.downloadBtn} onPress={handleOpen}>
              <Text style={styles.downloadText}>Відкрити файл</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.downloadBtn, saving && { opacity: 0.5 }]}
              onPress={handleSaveToDevice}
              disabled={saving}
            >
              <Text style={styles.downloadText}>
                {saving ? 'Збереження...' : 'Зберегти на пристрій'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

export const VideoThumbnail: React.FC<{ uri: string, onPress: () => void }> = ({ uri, onPress }) => {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function generate() {
      try {
        const { uri: thumb } = await VideoThumbnails.getThumbnailAsync(uri);
        setThumbnail(thumb);
      } catch (e) {
        console.warn('Thumbnail error', e);
      } finally {
        setLoading(false);
      }
    }
    generate();
  }, [uri]);

  return (
    <TouchableOpacity onPress={onPress} style={styles.thumbContainer}>
      {loading ? (
        <ActivityIndicator />
      ) : thumbnail ? (
        <Image source={{ uri: thumbnail }} style={styles.thumb} />
      ) : (
        <Text style={styles.thumbPlaceholder}>🎥</Text>
      )}
      <View style={styles.playIcon}>
        <Text style={{ fontSize: 20 }}>▶️</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '80%' },
  closeBtn: { position: 'absolute', top: 50, right: 20, zIndex: 1, padding: 10 },
  closeText: { color: '#fff', fontSize: 30 },
  thumbContainer: { width: 220, height: 160, borderRadius: 10, marginBottom: 6, backgroundColor: '#eee', justifyContent: 'center', alignItems: 'center' },
  thumb: { width: '100%', height: '100%', borderRadius: 10 },
  thumbPlaceholder: { fontSize: 40 },
  playIcon: { position: 'absolute' },
  docPlaceholder: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  downloadBtn: { marginTop: 8, padding: 14, backgroundColor: '#fff', borderRadius: 10, minWidth: 200, alignItems: 'center' },
  downloadText: { color: '#000', fontWeight: 'bold', fontSize: 14 },
});