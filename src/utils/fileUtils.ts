// Повністю використовуємо legacy API — новий File/Directory поки не підтримує
// Sharing та простий download у форматі, сумісному з expo-sharing.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert, Linking, Platform } from 'react-native';
import { API_BASE_URL } from '../api/axios';

export function getMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|file:|content:|data:)/i.test(url)) return url;

  const serverRoot = API_BASE_URL.replace(/\/api\/?$/, '');
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${serverRoot}${normalizedPath}`;
}

/**
 * Нормалізує URL: якщо відносний шлях — додає базову URL сервера.
 */
export function normalizeAttachmentUrl(url: string): string {
  if (/^(https?:|file:|content:|data:)/i.test(url)) return url;
  const serverRoot = API_BASE_URL.replace(/\/api\/?$/, '');
  const clean = url.startsWith('/') ? url : `/${url}`;
  return `${serverRoot}${clean}`;
}

/**
 * Глобальний lock, щоб уникнути race condition в Sharing.shareAsync.
 * Android не дозволяє два одночасні share діалоги.
 */
let _isSharing = false;

/**
 * Завантажує файл у кеш та відкриває системним діалогом вибору програми (ACTION_VIEW).
 * На Android це показує діалог "Відкрити за допомогою...", а не "Поширити".
 */
async function downloadAndOpenWithViewer(url: string, filename: string, mimeType: string = 'application/octet-stream'): Promise<void> {
  if (_isSharing) {
    console.warn('[downloadAndShare] already sharing, skipping');
    return;
  }

  _isSharing = true;
  try {
    const fileUri = `${FileSystem.cacheDirectory}${filename}`;

    // Видаляємо старий файл, якщо є
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
      Alert.alert('Помилка', 'Відкриття файлів не підтримується на цьому пристрої');
    }
  } finally {
    _isSharing = false;
  }
}

/**
 * Завантажує файл з URL у кеш та повертає локальний шлях.
 */
async function downloadToCache(url: string, filename: string): Promise<string | null> {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  const info = await FileSystem.getInfoAsync(fileUri);
  if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });
  const download = FileSystem.createDownloadResumable(url, fileUri);
  const result = await download.downloadAsync();
  return result?.uri || null;
}

/**
 * Відкриває файл через системний діалог "Відкрити за допомогою..." (ACTION_VIEW).
 * Працює для PDF, DOCX, зображень тощо.
 */
async function openWithViewer(uri: string, mimeType: string): Promise<void> {
  if (Platform.OS === 'android') {
    // На Android використовуємо content:// URI для доступу інших програм до файлу
    try {
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await Linking.openURL(contentUri);
      return;
    } catch (err) {
      console.warn('[openWithViewer] getContentUri failed, fallback to share:', err);
    }
  }
  // Fallback: відкрити через системний діалог "Поділитися"
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'Відкрити файл' });
  }
}

export const fileUtils = {
  /**
   * Завантажує файл та відкриває системним діалогом вибору програми (ACTION_VIEW).
   * При натисканні на PDF пропонує програми для перегляду, а не "Поширити".
   */
  openWithSystemApp: async (url: string, filename: string, mimeType: string = 'application/octet-stream') => {
    const fullUrl = normalizeAttachmentUrl(url);
    console.log('[openWithSystemApp] downloading:', { url: fullUrl, filename, mimeType });
    try {
      const localUri = await downloadToCache(fullUrl, filename);
      if (localUri) {
        await openWithViewer(localUri, mimeType);
      }
    } catch (error) {
      console.error('[openWithSystemApp] error:', error);
      Alert.alert('Помилка', 'Не вдалося відкрити файл');
    }
  },

  // Завантаження та відкриття файлу через системний діалог
  downloadAndOpenFile: async (
    url: string,
    filename: string,
    mimeType: string = 'application/octet-stream',
  ) => {
    try {
      const fullUrl = normalizeAttachmentUrl(url);
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      // Якщо файл вже є — видаляємо, щоб не відкрити старий
      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });

      const download = FileSystem.createDownloadResumable(fullUrl, fileUri);
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
      const fullUrl = normalizeAttachmentUrl(url);
      const filename = fullUrl.split('/').pop() || `image_${Date.now()}.jpg`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });

      const download = FileSystem.createDownloadResumable(fullUrl, fileUri);
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
      const fullUrl = normalizeAttachmentUrl(url);
      const fileUri = `${FileSystem.documentDirectory}${filename}`;

      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });

      const download = FileSystem.createDownloadResumable(fullUrl, fileUri);
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
   * Універсальна нормалізація URI файлу.
   * Якщо URI починається з content:// (Android), копіює у file:// кеш.
   * Може використовуватись для будь-яких типів файлів (зображення, документи тощо).
   */
  normalizeFileUri: async (
    uri: string,
    fileName: string,
    mimeType?: string | null,
  ): Promise<{ uri: string; name: string; mimeType: string }> => {
    let finalUri = uri;
    const finalName = fileName;
    let finalMime = mimeType || 'application/octet-stream';

    console.log('[normalizeFileUri] input:', { uri, fileName, mimeType, isContentUri: uri.startsWith('content://') });

    // Android: content:// URI неможливо передати у FormData/fetch — копіюємо в кеш
    if (uri.startsWith('content://')) {
      const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
      const cacheUri = `${FileSystem.cacheDirectory}${safeName}`;
      console.log('[normalizeFileUri] copying content:// to:', cacheUri);
      try {
        await FileSystem.copyAsync({ from: uri, to: cacheUri });
        const info = await FileSystem.getInfoAsync(cacheUri);
        const size = (info as any).size;
        console.log('[normalizeFileUri] copy result exists:', info.exists, 'size:', size);
        if (info.exists) {
          finalUri = cacheUri;
        } else {
          console.warn('[normalizeFileUri] copy completed but file does not exist at destination, trying readAsStringAsync fallback');
          // Fallback: читаємо як base64 і зберігаємо
          try {
            const base64 = await FileSystem.readAsStringAsync(uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await FileSystem.writeAsStringAsync(cacheUri, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const retryInfo = await FileSystem.getInfoAsync(cacheUri);
            if (retryInfo.exists) {
              finalUri = cacheUri;
              console.log('[normalizeFileUri] base64 fallback succeeded');
            }
          } catch (base64Err) {
            console.error('[normalizeFileUri] base64 fallback also failed:', base64Err);
          }
        }
      } catch (copyErr: any) {
        console.error('[normalizeFileUri] copyAsync failed:', copyErr.message);
        // Спроба прочитати через base64 напряму
        try {
          const safeNameBase64 = `${Date.now()}_fallback_${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
          const fallbackUri = `${FileSystem.cacheDirectory}${safeNameBase64}`;
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await FileSystem.writeAsStringAsync(fallbackUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const fbInfo = await FileSystem.getInfoAsync(fallbackUri);
          if (fbInfo.exists) {
            finalUri = fallbackUri;
            console.log('[normalizeFileUri] base64 fallback (catch path) succeeded');
          }
        } catch (base64Err) {
          console.error('[normalizeFileUri] all fallbacks failed, using original URI:', base64Err);
        }
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
        pdf: 'application/pdf', doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        txt: 'text/plain', csv: 'text/csv',
        zip: 'application/zip', rar: 'application/vnd.rar',
        '7z': 'application/x-7z-compressed',
      };
      finalMime = MIME_BY_EXT[ext] || 'application/octet-stream';
    }

    console.log('[normalizeFileUri] output:', { uri: finalUri, name: finalName, mimeType: finalMime });
    return { uri: finalUri, name: finalName, mimeType: finalMime };
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
    console.log('[normalizeImagePickerAsset] delegating to normalizeFileUri');
    return fileUtils.normalizeFileUri(uri, fileName, mimeType);
  },
};