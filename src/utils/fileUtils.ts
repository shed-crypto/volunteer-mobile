// Повністю використовуємо legacy API — новий File/Directory поки не підтримує
// Sharing та простий download у форматі, сумісному з expo-sharing.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { API_BASE_URL } from '../api/axios';

export function getMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|file:|content:|data:)/i.test(url)) return url;

  const serverRoot = API_BASE_URL.replace(/\/api\/?$/, '');
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${serverRoot}${normalizedPath}`;
}

export const fileUtils = {
  // Завантаження та відкриття файлу через системний діалог
  downloadAndOpenFile: async (
    url: string,
    filename: string,
    mimeType: string = 'application/octet-stream',
  ) => {
    try {
      const fileUri = `${FileSystem.documentDirectory}${filename}`;

      // Якщо файл вже є — видаляємо, щоб не відкрити старий
      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });

      const download = FileSystem.createDownloadResumable(url, fileUri);
      const result = await download.downloadAsync();

      if (result?.uri) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, {
            mimeType,
            dialogTitle: 'Відкрити файл',
          });
        } else {
          Alert.alert('Помилка', 'Відкриття файлів не підтримується на цьому пристрої');
        }
      }
    } catch (error) {
      Alert.alert('Помилка', 'Не вдалося завантажити файл');
      console.error('Download error:', error);
    }
  },

  // Перегляд зображення через системний діалог
  previewImage: async (url: string) => {
    try {
      const filename = url.split('/').pop() || `image_${Date.now()}.jpg`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });

      const download = FileSystem.createDownloadResumable(url, fileUri);
      const result = await download.downloadAsync();

      if (result?.uri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'image/*',
          dialogTitle: 'Перегляд зображення',
        });
      } else {
        Alert.alert('Помилка', 'Перегляд зображень не підтримується');
      }
    } catch (error) {
      Alert.alert('Помилка', 'Не вдалося відкрити зображення');
      console.error('Preview error:', error);
    }
  },

  // Відкриття довільного файлу в зовнішній програмі
  openFileExternally: async (url: string, filename: string, mimeType: string) => {
    try {
      const fileUri = `${FileSystem.documentDirectory}${filename}`;

      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });

      const download = FileSystem.createDownloadResumable(url, fileUri);
      const result = await download.downloadAsync();

      if (result?.uri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(result.uri, {
          mimeType,
          dialogTitle: 'Відкрити файл',
        });
      } else {
        Alert.alert('Помилка', 'Відкриття файлів не підтримується');
      }
    } catch (error) {
      Alert.alert('Помилка', 'Не вдалося відкрити файл');
      console.error('Open externally error:', error);
    }
  },

  /**
   * Нормалізує asset з expo-image-picker:
   * — якщо URI content:// (Android), копіює у file:// кеш
   * — якщо mimeType відсутній, визначає за розширенням
   */
  normalizeImagePickerAsset: async (
    uri: string,
    fileName: string,
    mimeType?: string | null,
  ): Promise<{ uri: string; name: string; mimeType: string }> => {
    let finalUri = uri;
    let finalName = fileName;
    let finalMime = mimeType || 'application/octet-stream';

    console.log('[normalizeImagePickerAsset] input:', { uri, fileName, mimeType });

    // Android: content:// URI неможливо передати у FormData/fetch — копіюємо в кеш
    if (uri.startsWith('content://')) {
      const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
      const cacheUri = `${FileSystem.cacheDirectory}${safeName}`;
      console.log('[normalizeImagePickerAsset] copying content:// to:', cacheUri);
      try {
        await FileSystem.copyAsync({ from: uri, to: cacheUri });
        const info = await FileSystem.getInfoAsync(cacheUri);
        console.log('[normalizeImagePickerAsset] copy result exists:', info.exists, 'size:', (info as any).size);
        finalUri = cacheUri;
      } catch (copyErr: any) {
        console.error('[normalizeImagePickerAsset] copyAsync failed:', copyErr.message);
        // Якщо копіювання не вдалося, повертаємо оригінальний URI — можливо він і так працює
      }
    }

    // Fallback MIME за розширенням
    if (!finalMime || finalMime === 'application/octet-stream') {
      const ext = finalName.split('.').pop()?.toLowerCase() || '';
      const MIME_BY_EXT: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        heic: 'image/heic', heif: 'image/heif', tiff: 'image/tiff',
        mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
        mkv: 'video/x-matroska', m4v: 'video/x-m4v', wmv: 'video/x-ms-wmv',
      };
      finalMime = MIME_BY_EXT[ext] || 'application/octet-stream';
    }

    console.log('[normalizeImagePickerAsset] output:', { uri: finalUri, name: finalName, mimeType: finalMime });
    return { uri: finalUri, name: finalName, mimeType: finalMime };
  },
};
