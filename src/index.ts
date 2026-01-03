import { z } from 'zod';
import { JellyfinClient } from './jellyfin.js';
import { MusicBot } from './bot.js';
import { logger } from './logger.js';

// 環境変数のスキーマ定義
const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  JELLYFIN_URL: z.string().url('JELLYFIN_URL must be a valid URL'),
  JELLYFIN_API_KEY: z.string().min(1, 'JELLYFIN_API_KEY is required'),
  JELLYFIN_USER_ID: z.string().min(1, 'JELLYFIN_USER_ID is required'),
});

async function main() {
  logger.info('Starting Jellyfin Discord Bot...');

  // 環境変数の検証
  const env = envSchema.parse({
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    JELLYFIN_URL: process.env.JELLYFIN_URL,
    JELLYFIN_API_KEY: process.env.JELLYFIN_API_KEY,
    JELLYFIN_USER_ID: process.env.JELLYFIN_USER_ID,
  });

  // Jellyfinクライアントの初期化
  const jellyfinClient = new JellyfinClient({
    serverUrl: env.JELLYFIN_URL,
    apiKey: env.JELLYFIN_API_KEY,
    userId: env.JELLYFIN_USER_ID,
  });

  logger.info('Jellyfin client initialized');

  // Discord Botの起動
  const bot = new MusicBot(env.DISCORD_TOKEN, jellyfinClient);

  logger.info('Bot started successfully');
}

// エラーハンドリング
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
