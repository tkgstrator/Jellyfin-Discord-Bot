import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  MessageFlags,
  type StringSelectMenuInteraction
} from 'discord.js'
import {
  handleButton,
  handleLeave,
  handleNowPlaying,
  handlePlay,
  handlePlaylistSelect,
  handlePlaylists,
  handleSkip,
  handleStop
} from './handlers/commands.js'
import type { JellyfinClient } from './jellyfin.js'
import { logger } from './logger.js'
import { PlayerService } from './services/player.js'
import { VoiceService } from './services/voice.js'

/**
 * 音楽Botのメインクラス
 */
export class MusicBot {
  private client: Client
  private jellyfinClient: JellyfinClient
  private voiceService: VoiceService
  private playerService: PlayerService

  constructor(token: string, jellyfinClient: JellyfinClient) {
    this.jellyfinClient = jellyfinClient
    this.voiceService = new VoiceService()
    this.playerService = new PlayerService(jellyfinClient, this.voiceService.getConnections())

    // VoiceService破棄時のコールバック設定
    this.voiceService.setOnDestroyCallback((guildId) => {
      this.playerService.cleanup(guildId)
    })

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    })

    this.setupEventHandlers()
    this.client.login(token)
  }

  /**
   * イベントハンドラーの設定
   */
  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (client) => {
      logger.info(`Logged in as ${client.user.tag}`)
      this.registerCommands()
    })

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleCommand(interaction)
        } else if (interaction.isStringSelectMenu()) {
          await this.handleSelectMenu(interaction)
        } else if (interaction.isButton()) {
          await handleButton(interaction, this.playerService)
        }
      } catch (error) {
        logger.error('Error handling interaction:', error)
      }
    })
  }

  /**
   * コマンドの登録
   */
  private async registerCommands(): Promise<void> {
    const commands = [
      {
        name: 'leave',
        description: 'ボイスチャンネルから退出します'
      },
      {
        name: 'playlists',
        description: '利用可能なプレイリストを表示します'
      },
      {
        name: 'play',
        description: 'プレイリストを選択してランダム再生を開始します'
      },
      {
        name: 'skip',
        description: '次の曲にスキップします'
      },
      {
        name: 'stop',
        description: '再生を停止します'
      },
      {
        name: 'nowplaying',
        description: '現在再生中の曲を表示します'
      }
    ]

    try {
      await this.client.application?.commands.set(commands)
      logger.info('Commands registered successfully')
    } catch (error) {
      logger.error('Error registering commands:', error)
    }
  }

  /**
   * コマンドハンドラー
   */
  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction

    try {
      switch (commandName) {
        case 'leave':
          await handleLeave(interaction, this.voiceService, this.playerService)
          break
        case 'playlists':
          await handlePlaylists(interaction, this.jellyfinClient)
          break
        case 'play':
          await handlePlay(interaction, this.jellyfinClient)
          break
        case 'skip':
          await handleSkip(interaction, this.playerService)
          break
        case 'stop':
          await handleStop(interaction, this.playerService)
          break
        case 'nowplaying':
          await handleNowPlaying(interaction, this.playerService)
          break
      }
    } catch (error) {
      logger.error(`Error handling command ${commandName}:`, error)
      // 既に応答済みの場合はエラーを無視
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply('エラーが発生しました。')
        } else {
          await interaction.reply({
            content: 'エラーが発生しました。',
            flags: MessageFlags.Ephemeral
          })
        }
      } catch {
        // インタラクションが無効な場合は無視
      }
    }
  }

  /**
   * セレクトメニューハンドラー
   */
  private async handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    try {
      if (interaction.customId === 'playlist_select') {
        await handlePlaylistSelect(interaction, this.jellyfinClient, this.voiceService, this.playerService)
      }
    } catch (error) {
      logger.error('Error handling select menu:', error)
    }
  }
}
