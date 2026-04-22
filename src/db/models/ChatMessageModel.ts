import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель повідомлення чату.
 * Повідомлення, надіслані без мережі, потрапляють у чергу (isSynced=false, pending_action='send')
 * і відправляються автоматично при відновленні підключення.
 */
export class ChatMessageModel extends Model {
  static table = 'chat_messages';

  @field('server_id') serverId!: string | null;
  @field('chat_id') chatId!: string;
  @field('sender_id') senderId!: string;
  @field('sender_name') senderName!: string | null;
  @field('content') content!: string;
  @field('sent_at') sentAt!: number; // timestamp ms
  @field('is_synced') isSynced!: boolean;
  @field('pending_action') pendingAction!: string | null; // 'send'
  
  // Нові поля для статусів повідомлень
  @field('message_status') messageStatus!: string | null; // 'sent' | 'delivered' | 'read' | 'pending' | 'failed'
  @field('read_by_raw') readByRaw!: string | null; // JSON array of user IDs who read the message
  @field('delivered_to_raw') deliveredToRaw!: string | null; // JSON array of user IDs message was delivered to
  @field('last_synced_at') lastSyncedAt!: number | null;

  /** Зручний геттер для десеріалізованих ID користувачів, які прочитали повідомлення */
  get readBy(): string[] {
    try {
      return JSON.parse(this.readByRaw || '[]');
    } catch {
      return [];
    }
  }
  
  /** Зручний геттер для десеріалізованих ID користувачів, яким доставлено повідомлення */
  get deliveredTo(): string[] {
    try {
      return JSON.parse(this.deliveredToRaw || '[]');
    } catch {
      return [];
    }
  }
}
