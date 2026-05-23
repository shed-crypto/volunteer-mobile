import { getMediaUrl } from '../src/utils/fileUtils';
import { Colors, urgencyColors, statusColors, categoryLabels, clearanceLabels, roleLabels } from '../src/utils/theme';
import { OfflineLogger } from '../src/utils/offlineLogger';

describe('fileUtils — getMediaUrl', () => {
  it('returns undefined for null', () => {
    expect(getMediaUrl(null as any)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(getMediaUrl(undefined)).toBeUndefined();
  });

  it('returns absolute https URL unchanged', () => {
    expect(getMediaUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
  });

  it('returns file:// unchanged', () => {
    expect(getMediaUrl('file:///data/image.png')).toBe('file:///data/image.png');
  });

  it('prepends serverRoot for relative path', () => {
    const result = getMediaUrl('/uploads/test.jpg');
    expect(result).toContain('/test.jpg');
  });
});

describe('theme — colors & mappings', () => {
  it('palette contains primary', () => {
    expect(Colors.primary).toBe('#1a56db');
  });

  it('urgencyColors has 4 levels', () => {
    expect(Object.keys(urgencyColors)).toHaveLength(4);
  });

  it('statusColors has 8 keys', () => {
    expect(Object.keys(statusColors)).toHaveLength(8);
  });

  it('categoryLabels contains medical', () => {
    expect(categoryLabels.medical).toContain('Медична');
  });

  it('clearanceLabels has 3 levels', () => {
    expect(Object.keys(clearanceLabels)).toHaveLength(3);
  });

  it('roleLabels has 4 roles', () => {
    expect(Object.keys(roleLabels)).toHaveLength(4);
  });
});

describe('OfflineLogger', () => {
  afterEach(() => {
    OfflineLogger.clear();
    jest.clearAllMocks();
  });

  it('log stores a record', () => {
    OfflineLogger.log('AUTH', 'login', { user: 'test' });
    expect(OfflineLogger.getLogs()).toHaveLength(1);
    expect(OfflineLogger.getLogs()[0].category).toBe('AUTH');
  });

  it('auth, network, sync shortcuts work', () => {
    OfflineLogger.auth('auth-msg');
    OfflineLogger.network('net-msg');
    OfflineLogger.sync('sync-msg');
    expect(OfflineLogger.getLogs()).toHaveLength(3);
  });

  it('getLogsSummary formats output', () => {
    OfflineLogger.log('SYNC', 'synced', {});
    const summary = OfflineLogger.getLogsSummary();
    expect(summary).toContain('[SYNC]');
    expect(summary).toContain('synced');
  });

  it('clear flushes logs', () => {
    OfflineLogger.log('DB', 'query');
    expect(OfflineLogger.getLogs()).toHaveLength(1);
    OfflineLogger.clear();
    expect(OfflineLogger.getLogs()).toHaveLength(0);
  });

  it('cache, nav, db shortcuts work', () => {
    OfflineLogger.cache('cached');
    OfflineLogger.nav('navigated');
    OfflineLogger.db('query');
    expect(OfflineLogger.getLogs()).toHaveLength(3);
    expect(OfflineLogger.getLogs()[0].category).toBe('CACHE');
    expect(OfflineLogger.getLogs()[1].category).toBe('NAV');
    expect(OfflineLogger.getLogs()[2].category).toBe('DB');
  });
});