import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ScrollView, TextInput, Image, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Colors } from '../utils/theme';
import { ScreenHeader, Button } from './ui';

interface Attachment {
  uri: string;
  name: string;
  type: string;
}

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (comment: string, attachments: Attachment[]) => void;
  loading: boolean;
}

// Таблиця MIME-типів по розширенню файлу
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  heic: 'image/heic', heif: 'image/heif', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', m4v: 'video/x-m4v', wmv: 'video/x-ms-wmv',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Визначає MIME-тип надійно: спочатку з asset.mimeType,
 * якщо порожньо — з розширення URI/імені файлу.
 */
function resolveMime(mimeType: string | undefined, uri: string, fileName: string): string {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  const source = fileName || uri;
  const ext = source.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export const TaskReportModal = ({ visible, onClose, onSubmit, loading }: ReportModalProps) => {
  const [comment, setComment] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handleAttach = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Потрібен дозвіл', 'Нам потрібен доступ до вашої галереї, щоб додати файли.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // ВИПРАВЛЕННЯ: MediaTypeOptions застарілий — використовуємо масив MediaType
      mediaTypes: ['images', 'videos'] as any,
      allowsEditing: false,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });

    if (result.canceled) return;

    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    const newAttachments: Attachment[] = [];

    for (const asset of result.assets) {
      if ((asset.fileSize ?? 0) > MAX_SIZE_BYTES) {
        Alert.alert('Помилка', `Файл "${asset.fileName ?? 'file'}" занадто великий (макс. 10 МБ).`);
        continue;
      }

      // Ім'я файлу: беремо з метаданих або витягуємо з URI
      const fileName = asset.fileName || asset.uri.split('/').pop() || `file_${Date.now()}`;

      // MIME: resolveMime перевіряє asset.mimeType, потім розширення
      const mimeType = resolveMime(asset.mimeType, asset.uri, fileName);

      newAttachments.push({ uri: asset.uri, name: fileName, type: mimeType });
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleAttachDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const MAX_SIZE_BYTES = 25 * 1024 * 1024;

      if ((asset.size ?? 0) > MAX_SIZE_BYTES) {
        Alert.alert('Помилка', `Документ "${asset.name}" занадто великий (макс. 25 МБ).`);
        return;
      }

      const mimeType = resolveMime(asset.mimeType ?? undefined, asset.uri, asset.name);

      setAttachments((prev) => [
        ...prev,
        { uri: asset.uri, name: asset.name, type: mimeType },
      ]);
    } catch (error) {
      console.error('Document picker error:', error);
      Alert.alert('Помилка', 'Не вдалося додати документ. Спробуйте ще раз.');
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    onSubmit(comment, attachments);
    setComment('');
    setAttachments([]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <ScreenHeader title="Звіт про виконання" onBack={onClose} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <TextInput
            value={comment}
            onChangeText={setComment}
            multiline
            placeholder="Опишіть, як пройшла задача..."
            style={styles.input}
          />

          {attachments.length > 0 && (
            <ScrollView
              horizontal
              contentContainerStyle={{ gap: 8 }}
              style={{ height: 104 }}
            >
              {attachments.map((a, i) => {
                const isImage = a.type.startsWith('image/');
                const isVideo = a.type.startsWith('video/');
                return (
                  <View key={i} style={styles.attachmentWrapper}>
                    {isImage ? (
                      <Image source={{ uri: a.uri }} style={styles.thumbnail} />
                    ) : (
                      <View style={[styles.thumbnail, styles.placeholder]}>
                        <Text style={styles.placeholderText}>{isVideo ? '🎥' : '📄'}</Text>
                      </View>
                    )}
                    <Text style={styles.fileName} numberOfLines={1}>{a.name}</Text>
                    <TouchableOpacity onPress={() => removeAttachment(i)} style={styles.deleteButton}>
                      <Text style={styles.deleteText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <Button title="Додати медіа" variant="outline" onPress={handleAttach} />
          <Button title="Додати файл" variant="outline" onPress={handleAttachDocument} />
          <Button title="Надіслати звіт" onPress={handleSubmit} loading={loading} />
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  input: {
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 8,
    minHeight: 120,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
  },
  thumbnail: { width: 80, height: 80, borderRadius: 8 },
  attachmentWrapper: { width: 80, alignItems: 'center', gap: 4 },
  placeholder: {
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { fontSize: 32 },
  fileName: {
    fontSize: 10,
    color: Colors.textSecondary,
    width: '100%',
    textAlign: 'center',
  },
  deleteButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: Colors.error,
    borderRadius: 12,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { color: Colors.background, fontWeight: 'bold', fontSize: 12 },
});
