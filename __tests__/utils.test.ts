import { getMediaUrl } from '../src/utils/fileUtils';
import { Colors, urgencyColors, statusColors, categoryLabels, clearanceLabels, roleLabels } from '../src/utils/theme';

describe('fileUtils — getMediaUrl', () => {
  it('повертає undefined для null', () => {
    expect(getMediaUrl(null as any)).toBeUndefined();
  });

  it('повертає undefined для undefined', () => {
    expect(getMediaUrl(undefined)).toBeUndefined();
  });

  it('повертає абсолютний https URL без змін', () => {
    expect(getMediaUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
  });

  it('повертає file:// без змін', () => {
    expect(getMediaUrl('file:///data/image.png')).toBe('file:///data/image.png');
  });

  it('додає serverRoot для відносного шляху', () => {
    const result = getMediaUrl('/uploads/test.jpg');
    expect(result).toContain('/test.jpg');
  });
});

describe('theme — кольори та маппінги', () => {
  it('кольорова палітра містить primary', () => {
    expect(Colors.primary).toBe('#1a56db');
  });

  it('urgencyColors має 4 рівні', () => {
    expect(Object.keys(urgencyColors)).toHaveLength(4);
  });

  it('statusColors має 8 ключів', () => {
    expect(Object.keys(statusColors)).toHaveLength(8);
  });

  it('categoryLabels містить medical', () => {
    expect(categoryLabels.medical).toContain('Медична');
  });

  it('clearanceLabels має 3 рівні', () => {
    expect(Object.keys(clearanceLabels)).toHaveLength(3);
  });

  it('roleLabels має 4 ролі', () => {
    expect(Object.keys(roleLabels)).toHaveLength(4);
  });
});