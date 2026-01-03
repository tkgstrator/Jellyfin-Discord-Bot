import { z } from 'zod';

// Jellyfin設定スキーマ
export const JellyfinConfigSchema = z.object({
  serverUrl: z.string().url(),
  apiKey: z.string().min(1),
  userId: z.string().min(1),
});

// プレイリストアイテムスキーマ
export const PlaylistItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

// メディアタイプ
export const MediaTypeSchema = z.enum(['audio', 'video']);

// メディアアイテムスキーマ（音楽・動画共通）
export const MediaItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
  streamUrl: z.string(),
  imageUrl: z.string().nullable(),
  mediaType: MediaTypeSchema,
});

// 後方互換性のためのエイリアス
export const MusicItemSchema = MediaItemSchema;

// 型定義のエクスポート
export type JellyfinConfig = z.infer<typeof JellyfinConfigSchema>;
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;
export type MediaType = z.infer<typeof MediaTypeSchema>;
export type MediaItem = z.infer<typeof MediaItemSchema>;
export type MusicItem = MediaItem;
