import { AudioPlayerStatus } from '@discordjs/voice'
import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
  type StringSelectMenuInteraction,
  type TextChannel
} from 'discord.js'
import type { JellyfinClient } from '../jellyfin.js'
import { logger } from '../logger.js'
import type { PlayerService } from '../services/player.js'
import type { VoiceService } from '../services/voice.js'
import { createPlaylistSelectMenu, createSongEmbed } from '../ui/components.js'

/**
 * leaveコマンドのハンドラー
 */
export const handleLeave = async (
  interaction: ChatInputCommandInteraction,
  voiceService: VoiceService,
  playerService: PlayerService
): Promise<void> => {
  const guildId = interaction.guildId
  if (!guildId) return

  const connection = voiceService.getConnection(guildId)

  if (!connection) {
    await interaction.reply({
      content: 'ボイスチャンネルに参加していません。',
      flags: MessageFlags.Ephemeral
    })
    return
  }

  voiceService.disconnect(guildId)
  playerService.cleanup(guildId)

  await interaction.reply('ボイスチャンネルから退出しました')
}

/**
 * playlistsコマンドのハンドラー
 */
export const handlePlaylists = async (
  interaction: ChatInputCommandInteraction,
  jellyfinClient: JellyfinClient
): Promise<void> => {
  await interaction.deferReply()

  try {
    const playlists = await jellyfinClient.getPlaylists()

    if (playlists.length === 0) {
      await interaction.editReply('プレイリストが見つかりませんでした。')
      return
    }

    const playlistList = playlists.map((p, i) => `${i + 1}. **${p.name}** (ID: ${p.id})`).join('\n')

    await interaction.editReply(`利用可能なプレイリスト:\n${playlistList}`)
  } catch (error) {
    logger.error('Error fetching playlists:', error)
    await interaction.editReply('プレイリストの取得に失敗しました。')
  }
}

/**
 * playコマンドのハンドラー
 */
export const handlePlay = async (
  interaction: ChatInputCommandInteraction,
  jellyfinClient: JellyfinClient
): Promise<void> => {
  const member = interaction.member
  const voiceChannel =
    member && typeof member === 'object' && 'voice' in member && member.voice ? member.voice.channel : null

  if (!voiceChannel) {
    await interaction.reply({
      content: 'ボイスチャンネルに参加してからコマンドを実行してください。',
      flags: MessageFlags.Ephemeral
    })
    return
  }

  await interaction.deferReply()

  try {
    const playlists = await jellyfinClient.getPlaylists()

    if (playlists.length === 0) {
      await interaction.editReply('プレイリストが見つかりませんでした。')
      return
    }

    const row = createPlaylistSelectMenu(playlists)

    await interaction.editReply({
      content: '再生するプレイリストを選択してください:',
      components: [row]
    })
  } catch (error) {
    logger.error('Error fetching playlists:', error)
    await interaction.editReply('プレイリストの取得に失敗しました。')
  }
}

/**
 * プレイリスト選択のハンドラー
 */
export const handlePlaylistSelect = async (
  interaction: StringSelectMenuInteraction,
  jellyfinClient: JellyfinClient,
  voiceService: VoiceService,
  playerService: PlayerService
): Promise<void> => {
  await interaction.deferUpdate()

  const playlistId = interaction.values[0]
  const guildId = interaction.guildId
  const member = interaction.member
  const voiceChannel =
    member && typeof member === 'object' && 'voice' in member && member.voice ? member.voice.channel : null

  if (!guildId || !playlistId) {
    return
  }

  if (!voiceChannel) {
    await interaction.followUp({
      content: 'ボイスチャンネルに参加してからコマンドを実行してください。',
      flags: MessageFlags.Ephemeral
    })
    return
  }

  // ボイスチャンネルに自動接続
  const connection = await voiceService.ensureConnection(
    guildId,
    voiceChannel.id,
    interaction.guild?.voiceAdapterCreator
  )

  if (!connection) {
    await interaction.followUp({
      content: 'ボイスチャンネルへの接続に失敗しました。',
      flags: MessageFlags.Ephemeral
    })
    return
  }

  try {
    const playlists = await jellyfinClient.getPlaylists()
    const playlist = playlists.find((p) => p.id === playlistId)

    playerService.setPlaylist(guildId, playlistId)

    // VCのテキストチャットに投稿するため、VoiceChannel自体をテキストチャンネルとして使用
    playerService.setTextChannel(guildId, voiceChannel as unknown as TextChannel)

    await interaction.editReply({
      content: `プレイリスト **${playlist?.name || 'Unknown'}** からランダム再生を開始します`,
      components: []
    })

    // インタラクション応答後に非同期で再生開始（awaitしない）
    playerService.playNextSong(guildId).catch((error) => {
      logger.error('Error starting playback:', error)
    })
  } catch (error) {
    logger.error('Error starting playback:', error)
    try {
      await interaction.followUp({
        content: '再生の開始に失敗しました。',
        flags: MessageFlags.Ephemeral
      })
    } catch {
      // インタラクションが無効な場合は無視
    }
  }
}

/**
 * skipコマンドのハンドラー
 */
export const handleSkip = async (
  interaction: ChatInputCommandInteraction,
  playerService: PlayerService
): Promise<void> => {
  const guildId = interaction.guildId
  if (!guildId) return

  const player = playerService.getPlayer(guildId)

  if (!player) {
    await interaction.reply({
      content: '再生中の曲がありません。',
      flags: MessageFlags.Ephemeral
    })
    return
  }

  player.stop()
  await interaction.reply('スキップしました')
}

/**
 * stopコマンドのハンドラー
 */
export const handleStop = async (
  interaction: ChatInputCommandInteraction,
  playerService: PlayerService
): Promise<void> => {
  const guildId = interaction.guildId
  if (!guildId) return

  const player = playerService.getPlayer(guildId)

  if (!player) {
    await interaction.reply({
      content: '再生中の曲がありません。',
      flags: MessageFlags.Ephemeral
    })
    return
  }

  player.stop()
  playerService.removePlaylist(guildId)
  await interaction.reply('再生を停止しました')
}

/**
 * nowplayingコマンドのハンドラー
 */
export const handleNowPlaying = async (
  interaction: ChatInputCommandInteraction,
  playerService: PlayerService
): Promise<void> => {
  const guildId = interaction.guildId
  if (!guildId) return

  const song = playerService.getCurrentSong(guildId)

  if (!song) {
    await interaction.reply({
      content: '現在再生中の曲がありません。',
      flags: MessageFlags.Ephemeral
    })
    return
  }

  const { embed, attachment } = await createSongEmbed(song)

  await interaction.reply({
    embeds: [embed],
    files: attachment ? [attachment] : []
  })
}

/**
 * ボタンインタラクションのハンドラー
 */
export const handleButton = async (interaction: ButtonInteraction, playerService: PlayerService): Promise<void> => {
  const guildId = interaction.guildId
  if (!guildId) return

  const player = playerService.getPlayer(guildId)

  try {
    // インタラクションを確認（メッセージは送信しない）
    await interaction.deferUpdate()

    switch (interaction.customId) {
      case 'music_pause': {
        if (player && player.state.status === AudioPlayerStatus.Playing) {
          player.pause()
        }
        break
      }
      case 'music_resume': {
        if (player && player.state.status === AudioPlayerStatus.Paused) {
          player.unpause()
        }
        break
      }
      case 'music_skip': {
        if (player) {
          player.stop()
        }
        break
      }
      case 'music_stop': {
        if (player) {
          player.stop()
          playerService.removePlaylist(guildId)
        }
        break
      }
      default:
        break
    }
  } catch (error) {
    logger.error('Error handling button interaction:', error)
  }
}
