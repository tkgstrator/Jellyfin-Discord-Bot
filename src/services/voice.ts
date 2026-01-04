import {
  type DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
  VoiceConnectionStatus
} from '@discordjs/voice'
import { logger } from '../logger.js'

/**
 * ボイスチャンネル接続管理サービス
 */
export class VoiceService {
  private connections: Map<string, VoiceConnection> = new Map()
  private onDestroyCallback?: (guildId: string) => void

  /**
   * 接続破棄時のコールバックを設定
   */
  setOnDestroyCallback(callback: (guildId: string) => void): void {
    this.onDestroyCallback = callback
  }

  /**
   * 接続を取得
   */
  getConnection(guildId: string): VoiceConnection | undefined {
    return this.connections.get(guildId)
  }

  /**
   * 全接続を取得
   */
  getConnections(): Map<string, VoiceConnection> {
    return this.connections
  }

  /**
   * ボイスチャンネルに接続（既存の接続があれば再利用）
   */
  async ensureConnection(
    guildId: string,
    channelId: string,
    adapterCreator: DiscordGatewayAdapterCreator | undefined
  ): Promise<VoiceConnection | null> {
    if (!adapterCreator) return null
    // 既存の接続があれば再利用
    const existing = this.connections.get(guildId)
    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      return existing
    }

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator
    })

    // 接続状態の監視と再接続ロジック
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // 5秒以内に再接続を試みる
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
        ])
        logger.info('Voice connection reconnecting...')
      } catch {
        // 再接続失敗時は接続を破棄
        logger.warn('Voice connection disconnected, destroying...')
        connection.destroy()
        this.cleanup(guildId)
      }
    })

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      logger.info('Voice connection destroyed')
      this.cleanup(guildId)
    })

    // Ready状態になるまで待機
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
    } catch {
      connection.destroy()
      return null
    }

    this.connections.set(guildId, connection)
    return connection
  }

  /**
   * 接続を切断
   */
  disconnect(guildId: string): void {
    const connection = this.connections.get(guildId)
    if (connection) {
      connection.destroy()
      this.cleanup(guildId)
    }
  }

  /**
   * クリーンアップ
   */
  private cleanup(guildId: string): void {
    this.connections.delete(guildId)
    if (this.onDestroyCallback) {
      this.onDestroyCallback(guildId)
    }
  }
}
