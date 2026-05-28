import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Конвертує content:// URI у file:// URI, використовуючи expo-file-system.
 * Це необхідно, оскільки React Native XMLHttpRequest/FormData не можуть
 * прочитати content:// URI на Android.
 */
async function ensureFileUri(uri: string): Promise<string> {
  if (!uri.startsWith('content://')) {
    return uri;
  }
  try {
    const cacheDir = FileSystem.cacheDirectory || `${FileSystem.documentDirectory}cache/`;
    const safeName = `upload_${Date.now()}.bin`;
    const dest = `${cacheDir}${safeName}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists) {
      console.log('[uploadFormData] content:// copied to:', dest);
      return dest;
    }
  } catch (err) {
    console.warn('[uploadFormData] could not copy content://, trying original URI:', err);
  }
  return uri;
}

export async function uploadFormData<T>(
  url: string,
  formData: FormData,
  onProgress?: (progress: number) => void,
  abortSignal?: { aborted: boolean; onAbort?: () => void },
): Promise<T> {
  const token = await SecureStore.getItemAsync('accessToken');
  const parts: [string, any][] = (formData as any)._parts || [];
  const filePart = parts.find(([, value]) => value && typeof value === 'object' && value.uri);

  if (filePart) {
    const [fieldName, file] = filePart;
    const fileUri = await ensureFileUri(file.uri);
    const headers: Record<string, string> = {};
    const parameters: Record<string, string> = {};

    if (token) headers.Authorization = `Bearer ${token}`;

    for (const [key, value] of parts) {
      if (key === fieldName) continue;
      if (value !== undefined && value !== null) {
        parameters[key] = String(value);
      }
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const task = FileSystem.createUploadTask(
        url,
        fileUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName,
          mimeType: file.type || 'application/octet-stream',
          parameters,
          headers,
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        },
        (data) => {
          if (!onProgress || data.totalBytesExpectedToSend <= 0) return;
          const pct = Math.round((data.totalBytesSent / data.totalBytesExpectedToSend) * 100);
          onProgress(Math.min(pct, 99));
        },
      );

      if (abortSignal) {
        abortSignal.onAbort = () => {
          if (settled) return;
          settled = true;
          task.cancelAsync().catch(() => undefined);
          reject(new Error('Upload cancelled'));
        };
      }

      task.uploadAsync()
        .then((result) => {
          if (settled) return;
          settled = true;
          if (!result) {
            reject(new Error('Upload cancelled'));
            return;
          }
          const body = result.body || '';
          if (result.status < 200 || result.status >= 300) {
            reject(new Error(`Upload failed: ${result.status} ${body}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : ({} as T));
          } catch (err) {
            reject(err);
          }
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          reject(abortSignal?.aborted ? new Error('Upload cancelled') : err);
        });
    });
  }
  // Перевіряємо, чи є в FormData файли з content:// URI і конвертуємо їх
  // (звичайний спосіб — через formData.entries/set — не працює в RN,
  // тому покладаємося на те, що викликаючий код вже нормалізував URI)

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    // Прогрес завантаження
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(Math.min(pct, 99)); // ніколи не показуємо 100% — 100% лише після відповіді сервера
        }
      };
    }

    // Підтримка скасування
    if (abortSignal) {
      abortSignal.onAbort = () => {
        xhr.abort();
      };
    }

    xhr.timeout = 600000; // 10 хвилин

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.onload = () => {
      const body = xhr.responseText || '';
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed: ${xhr.status} ${body}`));
        return;
      }

      try {
        resolve(body ? JSON.parse(body) : ({} as T));
      } catch (err) {
        reject(err);
      }
    };

    xhr.onerror = (e) => {
      console.error('[uploadFormData] XHR error event:', {
        readyState: xhr.readyState,
        status: xhr.status,
        statusText: xhr.statusText,
        responseText: xhr.responseText?.substring(0, 200),
      });
      reject(new TypeError('Network request failed'));
    };

    xhr.onabort = () => {
      reject(new Error('Upload cancelled'));
    };

    xhr.ontimeout = () => {
      console.error('[uploadFormData] XHR timeout after 600000ms');
      reject(new Error('Upload timed out'));
    };

    // Додаткове логування: дамп вмісту FormData (доступно лише через entries в дебаг-режимі)
    if (false && __DEV__) try {
      console.log('[uploadFormData] sending to:', url, 'FormData entries:');
      // @ts-ignore - _parts є внутрішнім полем FormData в React Native
      const parts = (formData as any)._parts || [];
      parts.forEach(([key, value]: [string, any]) => {
        if (typeof value === 'object' && value?.uri) {
          console.log(`  ${key}: { uri: ${value.uri?.substring(0, 100)}, name: ${value.name}, type: ${value.type} }`);
        } else {
          console.log(`  ${key}: ${typeof value === 'string' ? value.substring(0, 100) : JSON.stringify(value).substring(0, 100)}`);
        }
      });
    } catch (logErr) {
      // ігноруємо помилки логування
    }

    xhr.send(formData);
  });
}
