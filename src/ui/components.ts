import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js'
import type { MusicItem } from '../jellyfin.js'
import { logger } from '../logger.js'
import { formatDuration } from '../utils/format.js'

/**
 * 楽曲情報のEmbedを作成
 */
export const createSongEmbed = async (
  song: MusicItem
): Promise<{ embed: EmbedBuilder; attachment: AttachmentBuilder | null }> => {
  const isVideo = song.mediaType === 'video'
  const embed = new EmbedBuilder()
    .setTitle(song.name)
    .addFields({ name: 'Artist', value: song.artist, inline: true }, { name: 'Album', value: song.album, inline: true })
    .setColor(isVideo ? 0x9b59b6 : 0x00ae86)
    .setTimestamp()

  // 再生時間を追加
  if (song.durationSeconds) {
    embed.addFields({
      name: 'Duration',
      value: formatDuration(song.durationSeconds),
      inline: true
    })
  }

  // ディスク番号を追加
  if (song.discNumber) {
    embed.addFields({
      name: 'Disc',
      value: song.discNumber.toString(),
      inline: true
    })
  }

  // トラック番号を追加
  if (song.indexNumber) {
    embed.addFields({
      name: 'Track',
      value: song.indexNumber.toString(),
      inline: true
    })
  }

  // 発売年を追加
  if (song.year) {
    embed.addFields({
      name: 'Year',
      value: song.year.toString(),
      inline: true
    })
  }

  // アルバムアートを取得して添付
  let attachment: AttachmentBuilder | null = null
  if (song.imageUrl) {
    try {
      const imageResponse = await fetch(song.imageUrl)
      if (imageResponse.ok) {
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
        attachment = new AttachmentBuilder(imageBuffer, { name: 'album.jpg' })
        embed.setThumbnail('attachment://album.jpg')
      }
    } catch (error) {
      logger.warn('Failed to fetch album art:', error)
    }
  }

  return { embed, attachment }
}

/**
 * 音楽コントロールボタンを作成
 */
export const createControlButtons = (): ActionRowBuilder<ButtonBuilder> => {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('music_pause').setStyle(ButtonStyle.Secondary).setEmoji('⏸'),
    new ButtonBuilder().setCustomId('music_resume').setStyle(ButtonStyle.Secondary).setEmoji('▶'),
    new ButtonBuilder().setCustomId('music_skip').setStyle(ButtonStyle.Secondary).setEmoji('⏭'),
    new ButtonBuilder().setCustomId('music_stop').setStyle(ButtonStyle.Secondary).setEmoji('⏹')
  )
}

/**
 * プレイリスト選択メニューを作成
 */
export const createPlaylistSelectMenu = (
  playlists: Array<{ id: string; name: string }>
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const options = playlists.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.id))

  const select = new StringSelectMenuBuilder()
    .setCustomId('playlist_select')
    .setPlaceholder('プレイリストを選択')
    .addOptions(options)

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
}
