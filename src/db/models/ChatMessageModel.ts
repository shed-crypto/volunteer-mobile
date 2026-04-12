import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель повідомлення чату.
 * Повідомлення, надіслані без мережі, потрапляють у чергу (is_synced=false, pending_action='send')
 * і відправляються автоматично при відновленні підключення.
 */
export class ChatMessageModel extends Model {
  static table = 'chat_messages';

  @field('server_id')      serverId!: string | null;
  @field('chat_id')        chatId!: string;
  @field('sender_id')      senderId!: string;
  @field('sender_name')    senderName!: string | null;
  @field('content')        content!: string;
  @field('sent_at')        sentAt!: number;           // timestamp ms
  @field('is_synced')      isSynced!: boolean;
  @field('pending_action') pendingAction!: string | null; // 'send'
}
