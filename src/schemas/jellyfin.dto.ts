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
  // 基本情報
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
  streamUrl: z.string(),
  imageUrl: z.string().nullable(),
  mediaType: MediaTypeSchema,

  // 再生情報
  durationSeconds: z.number().nullable(),

  // トラック情報
  indexNumber: z.number().nullable(), // トラック番号
  discNumber: z.number().nullable(), // ディスク番号

  // アーティスト情報
  albumArtist: z.string().nullable(),
  artists: z.array(z.string()), // 全アーティスト
  composers: z.array(z.string()), // 作曲者
  genres: z.array(z.string()), // ジャンル

  // メタデータ
  year: z.number().nullable(), // リリース年
  premiereDate: z.string().nullable(), // リリース日
  communityRating: z.number().nullable(), // コミュニティ評価
  officialRating: z.string().nullable(), // 公式レーティング

  // 技術情報
  container: z.string().nullable(), // ファイル形式
  bitrate: z.number().nullable(), // ビットレート（bps）
  sampleRate: z.number().nullable(), // サンプルレート
  channels: z.number().nullable(), // チャンネル数

  // 追加情報
  overview: z.string().nullable(), // 説明文
  sortName: z.string().nullable(), // ソート名
});

// 後方互換性のためのエイリアス
export const MusicItemSchema = MediaItemSchema;

// 型定義のエクスポート
export type JellyfinConfig = z.infer<typeof JellyfinConfigSchema>;
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;
export type MediaType = z.infer<typeof MediaTypeSchema>;
export type MediaItem = z.infer<typeof MediaItemSchema>;
export type MusicItem = MediaItem;
