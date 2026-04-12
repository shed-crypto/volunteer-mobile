// Повністю використовуємо legacy API — новий File/Directory поки не підтримує
// Sharing та простий download у форматі, сумісному з expo-sharing.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

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
};
