import { Jellyfin } from '@jellyfin/sdk';
import { getItemsApi, getPlaylistsApi } from '@jellyfin/sdk/lib/utils/api/index.js';
import type { Api } from '@jellyfin/sdk/lib/api.js';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/index.js';
import { logger } from './logger.js';
import {
  JellyfinConfigSchema,
  PlaylistItemSchema,
  MediaItemSchema,
  type JellyfinConfig,
  type PlaylistItem,
  type MediaItem,
  type MediaType,
} from './schemas/jellyfin.dto.js';

// 型を再エクスポート（後方互換性のためMusicItemも含む）
export type { JellyfinConfig, PlaylistItem, MediaItem };
export type MusicItem = MediaItem;

export class JellyfinClient {
  private config: JellyfinConfig;
  private jellyfin: Jellyfin;
  private api: Api;

  constructor(config: JellyfinConfig) {
    this.config = JellyfinConfigSchema.parse(config);

    // Jellyfinクライアントを初期化
    this.jellyfin = new Jellyfin({
      clientInfo: {
        name: 'Discord Music Bot',
        version: '1.0.0',
      },
      deviceInfo: {
        name: 'Discord Bot',
        id: 'discord-bot-1',
      },
    });

    // APIインスタンスを作成
    this.api = this.jellyfin.createApi(this.config.serverUrl);

    // APIキーで認証を設定
    this.api.accessToken = this.config.apiKey;
  }

  /**
   * すべてのプレイリストを取得
   */
  async getPlaylists(): Promise<PlaylistItem[]> {
    try {
      const itemsApi = getItemsApi(this.api);
      const response = await itemsApi.getItems({
        userId: this.config.userId,
        includeItemTypes: ['Playlist'],
        recursive: true,
      });

      logger.debug('Playlists response:', JSON.stringify(response.data, null, 2));

      const items = response.data.Items || [];
      return items.map((item) =>
        PlaylistItemSchema.parse({
          id: item.Id,
          name: item.Name || 'Unknown',
          type: item.Type || 'Unknown',
        })
      );
    } catch (error) {
      logger.error('Error fetching playlists:', error);
      throw error;
    }
  }

  /**
   * 指定したプレイリストのアイテムを取得
   */
  async getPlaylistItems(playlistId: string): Promise<MediaItem[]> {
    try {
      const playlistsApi = getPlaylistsApi(this.api);
      const response = await playlistsApi.getPlaylistItems({
        playlistId,
        userId: this.config.userId,
      });

      logger.debug('Playlist items response:', JSON.stringify(response.data, null, 2));

      const items = response.data.Items || [];
      return items.map((item) => {
        const mediaType = this.getMediaType(item as BaseItemDto);
        // RunTimeTicksは100ナノ秒単位なので秒に変換
        const durationSeconds = item.RunTimeTicks
          ? Math.floor(item.RunTimeTicks / 10_000_000)
          : null;

        // MediaStreamsから技術情報を取得
        const audioStream = item.MediaStreams?.find((s) => s.Type === 'Audio');

        return MediaItemSchema.parse({
          // 基本情報
          id: item.Id,
          name: item.Name || 'Unknown',
          artist: item.AlbumArtist || item.Artists?.[0] || 'Unknown Artist',
          album: item.Album || 'Unknown Album',
          streamUrl: this.getStreamUrl(item.Id as string, mediaType),
          imageUrl: this.getImageUrl(item as BaseItemDto),
          mediaType,

          // 再生情報
          durationSeconds,

          // トラック情報
          indexNumber: item.IndexNumber ?? null,
          discNumber: item.ParentIndexNumber ?? null,

          // アーティスト情報
          albumArtist: item.AlbumArtist ?? null,
          artists: item.Artists ?? [],
          composers: [], // Jellyfinではアイテムレベルでは取得不可
          genres: item.Genres ?? [],

          // メタデータ
          year: item.ProductionYear ?? null,
          premiereDate: item.PremiereDate ?? null,
          communityRating: item.CommunityRating ?? null,
          officialRating: item.OfficialRating ?? null,

          // 技術情報
          container: item.Container ?? null,
          bitrate: audioStream?.BitRate ?? null,
          sampleRate: audioStream?.SampleRate ?? null,
          channels: audioStream?.Channels ?? null,

          // 追加情報
          overview: item.Overview ?? null,
          sortName: item.SortName ?? null,
        });
      });
    } catch (error) {
      logger.error('Error fetching playlist items:', error);
      throw error;
    }
  }

  /**
   * プレイリストからランダムにアイテムを取得
   */
  async getRandomItemFromPlaylist(playlistId: string): Promise<MediaItem | null> {
    const items = await this.getPlaylistItems(playlistId);
    if (items.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * items.length);
    return items[randomIndex] || null;
  }

  /**
   * アイテムのメディアタイプを判定
   */
  private getMediaType(item: BaseItemDto): MediaType {
    // Video, Movie, Episode, MusicVideoなどは動画として扱う
    const videoTypes = ['Video', 'Movie', 'Episode', 'MusicVideo', 'Trailer'];
    if (item.Type && videoTypes.includes(item.Type)) {
      return 'video';
    }
    // MediaTypeがVideoの場合も動画
    if (item.MediaType === 'Video') {
      return 'video';
    }
    return 'audio';
  }

  /**
   * ストリーミングURLを生成
   * トランスコードなしで元ファイルを直接ストリーミング
   */
  private getStreamUrl(itemId: string, _mediaType: MediaType): string {
    // static=trueで元ファイルをそのまま配信（トランスコードなし）
    return `${this.config.serverUrl}/Audio/${itemId}/stream?static=true&api_key=${this.config.apiKey}`;
  }

  /**
   * アルバムアート画像URLを生成
   * AlbumPrimaryImageTagがある場合はアルバムの画像を、なければアイテム自体の画像を使用
   */
  private getImageUrl(item: BaseItemDto): string | null {
    // アルバムのプライマリ画像がある場合
    if (item.AlbumId && item.AlbumPrimaryImageTag) {
      return `${this.config.serverUrl}/Items/${item.AlbumId}/Images/Primary?api_key=${this.config.apiKey}`;
    }
    // アイテム自体のプライマリ画像がある場合
    if (item.ImageTags?.Primary) {
      return `${this.config.serverUrl}/Items/${item.Id}/Images/Primary?api_key=${this.config.apiKey}`;
    }
    return null;
  }

  /**
   * 直接ストリーミングURL（認証付き）を取得
   */
  getDirectStreamUrl(itemId: string): string {
    return `${this.config.serverUrl}/Audio/${itemId}/stream?static=true&api_key=${this.config.apiKey}`;
  }
}
