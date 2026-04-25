import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class ChatModel extends Model {
  static table = 'chats';

  // @ts-ignore — WatermelonDB decorator
  @field('server_id') serverId!: string;
  // @ts-ignore — WatermelonDB decorator
  @field('name') name!: string | null;
  // @ts-ignore — WatermelonDB decorator
  @field('type') type!: string;
  // @ts-ignore — WatermelonDB decorator
  @field('participants_raw') participantsRaw!: string | null;
  // @ts-ignore — WatermelonDB decorator
  @field('last_message_raw') lastMessageRaw!: string | null;
  // @ts-ignore — WatermelonDB decorator
  @field('unread_count') unreadCount!: number;
  // @ts-ignore — WatermelonDB decorator
  @field('updated_at') updatedAt!: number;
  // @ts-ignore — WatermelonDB decorator
  @field('is_synced') isSynced!: boolean;
  // @ts-ignore — WatermelonDB decorator
  @field('last_synced_at') lastSyncedAt!: number | null;

  get participants(): any[] {
    try {
      return JSON.parse(this.participantsRaw || '[]');
    } catch {
      return [];
    }
  }

  get lastMessage(): any | null {
    try {
      return this.lastMessageRaw ? JSON.parse(this.lastMessageRaw) : null;
    } catch {
      return null;
    }
  }
}
