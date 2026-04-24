// src/utils/offlineLogger.ts
// Система логування для відлагодження офлайн режиму

const ENABLED = __DEV__; // Логи тільки в dev режимі

type LogCategory = 'AUTH' | 'NETWORK' | 'SYNC' | 'CACHE' | 'NAV' | 'DB';

interface LogEntry {
  time: string;
  category: LogCategory;
  message: string;
  data?: any;
}

const logs: LogEntry[] = [];
const MAX_LOGS = 200;

export const OfflineLogger = {
  log(category: LogCategory, message: string, data?: any) {
    if (!ENABLED) return;
    const entry: LogEntry = {
      time: new Date().toISOString().substring(11, 23),
      category,
      message,
      data,
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    
    const dataStr = data !== undefined ? ` | ${JSON.stringify(data)}` : '';
    console.log(`[${entry.time}][${category}] ${message}${dataStr}`);
  },

  getLogs(): LogEntry[] {
    return [...logs];
  },

  getLogsSummary(): string {
    return logs.map(l => `[${l.time}][${l.category}] ${l.message}`).join('\n');
  },

  clear() {
    logs.length = 0;
  },

  // Зручні методи
  auth(msg: string, data?: any) { this.log('AUTH', msg, data); },
  network(msg: string, data?: any) { this.log('NETWORK', msg, data); },
  sync(msg: string, data?: any) { this.log('SYNC', msg, data); },
  cache(msg: string, data?: any) { this.log('CACHE', msg, data); },
  nav(msg: string, data?: any) { this.log('NAV', msg, data); },
  db(msg: string, data?: any) { this.log('DB', msg, data); },
};
