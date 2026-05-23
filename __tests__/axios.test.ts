globalThis.fetch = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

import {
  checkServerReachable,
  getServerReachable,
  setServerReachable,
} from '../src/api/axios';

describe('axios — checkServerReachable', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when server responds 200', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({ status: 200 });
    setServerReachable(false);
    const result = await checkServerReachable();
    expect(result).toBe(true);
    expect(getServerReachable()).toBe(true);
  });

  it('returns false on network error', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    const result = await checkServerReachable();
    expect(result).toBe(false);
    expect(getServerReachable()).toBe(false);
  });

  it('returns false on non-200 status', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({ status: 404 });
    const result = await checkServerReachable();
    expect(result).toBe(false);
    expect(getServerReachable()).toBe(false);
  });
});