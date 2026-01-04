import {
  type AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  type VoiceConnection
} from '@discordjs/voice'
import { MessageFlags, type TextChannel } from 'discord.js'
import type { JellyfinClient, MusicItem } from '../jellyfin.js'
import { logger } from '../logger.js'
import { createControlButtons, createSongEmbed } from '../ui/components.js'
import { formatDuration } from '../utils/format.js'
import { createBufferedStream } from '../utils/stream.js'

/**
 * 音楽プレイヤー管理サービス
 */
export class PlayerService {
  private players: Map<string, AudioPlayer> = new Map()
  private currentPlaylists: Map<string, string> = new Map()
  private currentSongs: Map<string, MusicItem> = new Map()
  private textChannels: Map<string, TextChannel> = new Map()
  private jellyfinClient: JellyfinClient
  private connections: Map<string, VoiceConnection>

  constructor(jellyfinClient: JellyfinClient, connections: Map<string, VoiceConnection>) {
    this.jellyfinClient = jellyfinClient
    this.connections = connections
  }

  /**
   * プレイリストIDを設定
   */
  setPlaylist(guildId: string, playlistId: string): void {
    this.currentPlaylists.set(guildId, playlistId)
  }

  /**
   * テキストチャンネルを設定
   */
  setTextChannel(guildId: string, channel: TextChannel): void {
    this.textChannels.set(guildId, channel)
  }

  /**
   * 現在再生中の楽曲を取得
   */
  getCurrentSong(guildId: string): MusicItem | undefined {
    return this.currentSongs.get(guildId)
  }

  /**
   * プレイヤーを取得
   */
  getPlayer(guildId: string): AudioPlayer | undefined {
    return this.players.get(guildId)
  }

  /**
   * 次の曲を再生
   */
  async playNextSong(guildId: string): Promise<void> {
    const playlistId = this.currentPlaylists.get(guildId)
    if (!playlistId) return

    const connection = this.connections.get(guildId)
    if (!connection) return

    try {
      const song = await this.jellyfinClient.getRandomItemFromPlaylist(playlistId)
      if (!song) {
        logger.warn('No songs found in playlist')
        return
      }

      // 楽曲情報をコンソールに出力
      const trackInfo = song.indexNumber
        ? song.discNumber
          ? `Disc ${song.discNumber} - Track ${song.indexNumber}`
          : `Track ${song.indexNumber}`
        : null

      logger.info('Now playing:', {
        title: song.name,
        artist: song.artist,
        album: song.album,
        albumArtist: song.albumArtist,
        duration: song.durationSeconds ? formatDuration(song.durationSeconds) : 'Unknown',
        track: trackInfo,
        year: song.year,
        genres: song.genres.length > 0 ? song.genres : null,
        container: song.container,
        bitrate: song.bitrate ? `${Math.round(song.bitrate / 1000)} kbps` : null,
        sampleRate: song.sampleRate ? `${song.sampleRate} Hz` : null,
        channels: song.channels
      })

      this.currentSongs.set(guildId, song)

      // Embedで楽曲情報を表示
      const textChannel = this.textChannels.get(guildId)
      if (textChannel) {
        const { embed, attachment } = await createSongEmbed(song)
        const controlRow = createControlButtons()

        await textChannel.send({
          embeds: [embed],
          components: [controlRow],
          files: attachment ? [attachment] : [],
          flags: [MessageFlags.SuppressNotifications]
        })
      }

      // ストリームをバッファリングしてから再生開始
      const bufferedStream = await createBufferedStream(song.streamUrl)

      // createAudioResourceに直接ストリームを渡す（内部でFFmpegが処理）
      const resource = createAudioResource(bufferedStream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      })

      // 音量を30%に設定
      resource.volume?.setVolume(0.3)

      let player = this.players.get(guildId)
      if (!player) {
        player = createAudioPlayer({
          behaviors: {
            // サブスクライバーがいない場合は停止
            noSubscriber: NoSubscriberBehavior.Stop
          }
        })
        this.players.set(guildId, player)
        connection.subscribe(player)

        player.on(AudioPlayerStatus.Idle, () => {
          logger.debug('Song ended, playing next...')
          setTimeout(() => this.playNextSong(guildId), 1000)
        })

        // サブスクライバーがいなくなった場合（VCから全員退出）は退出
        player.on('stateChange', (oldState, newState) => {
          if (
            oldState.status !== AudioPlayerStatus.Idle &&
            newState.status === AudioPlayerStatus.Idle &&
            !this.currentPlaylists.has(guildId)
          ) {
            // 再生リストがない場合は接続を切断
            const conn = this.connections.get(guildId)
            if (conn) {
              logger.info('No subscribers, leaving voice channel')
              conn.destroy()
            }
          }
        })

        player.on('error', (error) => {
          logger.error('Audio player error:', error)
          setTimeout(() => this.playNextSong(guildId), 1000)
        })
      }

      // FFmpegがフレームを準備する時間を確保
      await new Promise((resolve) => setTimeout(resolve, 500))

      player.play(resource)
    } catch (error) {
      logger.error('Error playing song:', error)
      setTimeout(() => this.playNextSong(guildId), 2000)
    }
  }

  /**
   * プレイリストを削除
   */
  removePlaylist(guildId: string): void {
    this.currentPlaylists.delete(guildId)
  }

  /**
   * クリーンアップ
   */
  cleanup(guildId: string): void {
    this.players.delete(guildId)
    this.currentPlaylists.delete(guildId)
    this.currentSongs.delete(guildId)
    this.textChannels.delete(guildId)
  }
}
