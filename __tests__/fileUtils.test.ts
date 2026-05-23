jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///data/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  createDownloadResumable: jest.fn().mockReturnValue({
    downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///data/dl.jpg' }),
  }),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ uri: 'asset.jpg' }) },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({ uri: 'resized.jpg' }),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'picked.jpg' }] }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'camera.jpg' }] }),
  MediaTypeOptions: { Images: 'Images' },
}));

import { fileUtils } from '../src/utils/fileUtils';

describe('fileUtils — normalizeImagePickerAsset', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('повертає нормалізований URI для звичайного шляху', async () => {
    const result = await fileUtils.normalizeImagePickerAsset('https://example.com/image.png', 'test.png', 'image/png');
    expect(result.uri).toBe('https://example.com/image.png');
    expect(result.mimeType).toBe('image/png');
  });

  it('визначає MIME за розширенням при відсутньому mimeType', async () => {
    const result = await fileUtils.normalizeImagePickerAsset('file.jpg', 'file.jpg');
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('обробляє content:// URI', async () => {
    const result = await fileUtils.normalizeImagePickerAsset('content://data/image.jpg', 'image.jpg');
    expect(result.uri.startsWith('file:///cache/')).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
  });
});