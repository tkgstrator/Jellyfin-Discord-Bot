import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  AttachmentBuilder,
  ChannelType,
  type Interaction,
  type ChatInputCommandInteraction,
  type TextChannel,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
  StreamType,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice';
import { PassThrough, Readable } from 'node:stream';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import { JellyfinClient, type MusicItem } from './jellyfin.js';
import { logger } from './logger.js';

// バッファサイズ（4MB - ロスレスAAC向け、高速ネットワーク環境）
const BUFFER_SIZE = 4 * 1024 * 1024;

/**
 * バイト数を人間が読みやすい形式にフォーマット
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * 指定サイズまでバッファリングしてからストリームを返す
 */
const createBufferedStream = async (url: string): Promise<Readable> => {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch stream: ${response.status}`);
  }

  const reader = response.body.getReader();
  const buffer: Uint8Array[] = [];
  let bufferedSize = 0;

  const startTime = dayjs();
  logger.info(`Buffering started (target: ${formatBytes(BUFFER_SIZE)})`);

  // 初期バッファを確保（awaitでブロック）
  while (bufferedSize < BUFFER_SIZE) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      buffer.push(value);
      bufferedSize += value.length;
      const percent = Math.min(100, (bufferedSize / BUFFER_SIZE) * 100).toFixed(1);
      // キャリッジリターンで同じ行を上書き
      process.stdout.write(`\rBuffering: ${formatBytes(bufferedSize)} / ${formatBytes(BUFFER_SIZE)} (${percent}%)`);
    }
  }

  const elapsed = dayjs().diff(startTime, 'millisecond');
  // 改行してからログ出力
  process.stdout.write('\n');
  logger.info(`Buffering complete: ${formatBytes(bufferedSize)} in ${elapsed}ms`);

  // バッファ済みデータと残りのストリームを結合したReadableを作成
  const readable = new Readable({
    highWaterMark: BUFFER_SIZE,
    async read() {
      // まずバッファ済みデータを返す
      while (buffer.length > 0) {
        const chunk = buffer.shift();
        if (!this.push(chunk)) return; // バックプレッシャー対応
      }

      // 残りのストリームを読み込み
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null); // ストリーム終了
        } else {
          this.push(value);
        }
      } catch (error) {
        this.destroy(error as Error);
      }
    },
  });

  return readable;
};

// dayjsプラグインを有効化
dayjs.extend(duration);

export class MusicBot {
  private client: Client;
  private jellyfinClient: JellyfinClient;
  private connections: Map<string, VoiceConnection> = new Map();
  private players: Map<string, AudioPlayer> = new Map();
  private currentPlaylists: Map<string, string> = new Map(); // guildId -> playlistId
  private queues: Map<string, MusicItem[]> = new Map(); // guildId -> queue
  private textChannels: Map<string, TextChannel> = new Map(); // guildId -> textChannel
  private currentSongs: Map<string, MusicItem> = new Map(); // guildId -> current song

  constructor(
    token: string,
    jellyfinClient: JellyfinClient
  ) {
    this.jellyfinClient = jellyfinClient;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    this.setupEventHandlers();
    this.client.login(token);
  }

  /**
   * 秒数を MM:SS または HH:MM:SS 形式にフォーマット
   */
  private formatDuration(seconds: number): string {
    const d = dayjs.duration(seconds, 'seconds');
    if (d.hours() > 0) {
      return d.format('H:mm:ss');
    }
    return d.format('m:ss');
  }

  private setupEventHandlers() {
    this.client.once(Events.ClientReady, (client) => {
      logger.info(`Logged in as ${client.user.tag}`);
      this.registerCommands();
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleCommand(interaction);
        } else if (interaction.isStringSelectMenu()) {
          await this.handleSelectMenu(interaction);
        } else if (interaction.isButton()) {
          await this.handleButton(interaction);
        }
      } catch (error) {
        logger.error('Error handling interaction:', error);
      }
    });
  }

  private async handleSelectMenu(interaction: StringSelectMenuInteraction) {
    try {
      if (interaction.customId === 'playlist_select') {
        await this.handlePlaylistSelect(interaction);
      }
    } catch (error) {
      logger.error('Error handling select menu:', error);
    }
  }

  /**
   * ボタンインタラクションのハンドラー
   */
  private async handleButton(interaction: ButtonInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const player = this.players.get(guildId);

    try {
      // インタラクションを確認（メッセージは送信しない）
      await interaction.deferUpdate();

      switch (interaction.customId) {
        case 'music_pause': {
          if (player && player.state.status === AudioPlayerStatus.Playing) {
            player.pause();
          }
          break;
        }
        case 'music_resume': {
          if (player && player.state.status === AudioPlayerStatus.Paused) {
            player.unpause();
          }
          break;
        }
        case 'music_skip': {
          if (player) {
            player.stop();
          }
          break;
        }
        case 'music_stop': {
          if (player) {
            player.stop();
            this.currentPlaylists.delete(guildId);
          }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      logger.error('Error handling button interaction:', error);
    }
  }

  private async registerCommands() {
    const commands = [
      {
        name: 'leave',
        description: 'ボイスチャンネルから退出します',
      },
      {
        name: 'playlists',
        description: '利用可能なプレイリストを表示します',
      },
      {
        name: 'play',
        description: 'プレイリストを選択してランダム再生を開始します',
      },
      {
        name: 'skip',
        description: '次の曲にスキップします',
      },
      {
        name: 'stop',
        description: '再生を停止します',
      },
      {
        name: 'nowplaying',
        description: '現在再生中の曲を表示します',
      },
    ];

    try {
      await this.client.application?.commands.set(commands);
      logger.info('Commands registered successfully');
    } catch (error) {
      logger.error('Error registering commands:', error);
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'leave':
          await this.handleLeave(interaction);
          break;
        case 'playlists':
          await this.handlePlaylists(interaction);
          break;
        case 'play':
          await this.handlePlay(interaction);
          break;
        case 'skip':
          await this.handleSkip(interaction);
          break;
        case 'stop':
          await this.handleStop(interaction);
          break;
        case 'nowplaying':
          await this.handleNowPlaying(interaction);
          break;
      }
    } catch (error) {
      logger.error(`Error handling command ${commandName}:`, error);
      // 既に応答済みの場合はエラーを無視
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply('エラーが発生しました。');
        } else {
          await interaction.reply({
            content: 'エラーが発生しました。',
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // インタラクションが無効な場合は無視
      }
    }
  }

  /**
   * ボイスチャンネルに接続（既存の接続があれば再利用）
   */
  private async ensureVoiceConnection(
    guildId: string,
    channelId: string,
    adapterCreator: any
  ): Promise<VoiceConnection | null> {
    // 既存の接続があれば再利用
    const existing = this.connections.get(guildId);
    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      return existing;
    }

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator,
    });

    // 接続状態の監視と再接続ロジック
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // 5秒以内に再接続を試みる
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        logger.info('Voice connection reconnecting...');
      } catch {
        // 再接続失敗時は接続を破棄
        logger.warn('Voice connection disconnected, destroying...');
        connection.destroy();
        this.cleanup(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      logger.info('Voice connection destroyed');
      this.cleanup(guildId);
    });

    // Ready状態になるまで待機
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      connection.destroy();
      return null;
    }

    this.connections.set(guildId, connection);
    return connection;
  }

  /**
   * クリーンアップ処理
   */
  private cleanup(guildId: string) {
    this.connections.delete(guildId);
    this.players.delete(guildId);
    this.currentPlaylists.delete(guildId);
    this.queues.delete(guildId);
    this.currentSongs.delete(guildId);
    this.textChannels.delete(guildId);
  }

  private async handleLeave(interaction: ChatInputCommandInteraction) {
    const connection = this.connections.get(interaction.guildId!);

    if (!connection) {
      await interaction.reply({
        content: 'ボイスチャンネルに参加していません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    connection.destroy();
    this.cleanup(interaction.guildId!);

    await interaction.reply('ボイスチャンネルから退出しました');
  }

  private async handlePlaylists(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const playlists = await this.jellyfinClient.getPlaylists();

      if (playlists.length === 0) {
        await interaction.editReply('プレイリストが見つかりませんでした。');
        return;
      }

      const playlistList = playlists
        .map((p, i) => `${i + 1}. **${p.name}** (ID: ${p.id})`)
        .join('\n');

      await interaction.editReply(`利用可能なプレイリスト:\n${playlistList}`);
    } catch (error) {
      logger.error('Error fetching playlists:', error);
      await interaction.editReply('プレイリストの取得に失敗しました。');
    }
  }

  private async handlePlay(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as any;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: 'ボイスチャンネルに参加してからコマンドを実行してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const playlists = await this.jellyfinClient.getPlaylists();

      if (playlists.length === 0) {
        await interaction.editReply('プレイリストが見つかりませんでした。');
        return;
      }

      const options = playlists.slice(0, 25).map(p =>
        new StringSelectMenuOptionBuilder()
          .setLabel(p.name)
          .setValue(p.id)
      );

      const select = new StringSelectMenuBuilder()
        .setCustomId('playlist_select')
        .setPlaceholder('プレイリストを選択')
        .addOptions(options);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(select);

      await interaction.editReply({
        content: '再生するプレイリストを選択してください:',
        components: [row],
      });
    } catch (error) {
      logger.error('Error fetching playlists:', error);
      await interaction.editReply('プレイリストの取得に失敗しました。');
    }
  }

  private async handlePlaylistSelect(interaction: StringSelectMenuInteraction) {
    await interaction.deferUpdate();

    const playlistId = interaction.values[0];
    const guildId = interaction.guildId;
    const member = interaction.member as any;
    const voiceChannel = member?.voice?.channel;

    if (!guildId || !playlistId) {
      return;
    }

    if (!voiceChannel) {
      await interaction.followUp({
        content: 'ボイスチャンネルに参加してからコマンドを実行してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // ボイスチャンネルに自動接続
    const connection = await this.ensureVoiceConnection(
      guildId,
      voiceChannel.id,
      interaction.guild!.voiceAdapterCreator
    );

    if (!connection) {
      await interaction.followUp({
        content: 'ボイスチャンネルへの接続に失敗しました。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const playlists = await this.jellyfinClient.getPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);

      this.currentPlaylists.set(guildId, playlistId);
      
      // VCに関連するテキストチャンネルを取得
      // 同じカテゴリ内で最初のテキストチャンネルを探す
      let targetChannel: TextChannel | null = null;
      if (voiceChannel.parent) {
        const channelsInCategory = voiceChannel.parent.children.cache;
        const firstTextChannel = channelsInCategory.find(
          ch => ch.type === ChannelType.GuildText
        );
        if (firstTextChannel) {
          targetChannel = firstTextChannel as TextChannel;
        }
      }
      
      // テキストチャンネルが見つからない場合は元のチャンネルを使用
      if (!targetChannel) {
        targetChannel = interaction.channel as TextChannel;
      }
      
      this.textChannels.set(guildId, targetChannel);

      await interaction.editReply({
        content: `プレイリスト **${playlist?.name || 'Unknown'}** からランダム再生を開始します`,
        components: [],
      });

      // インタラクション応答後に非同期で再生開始（awaitしない）
      this.playNextSong(guildId).catch(error => {
        logger.error('Error starting playback:', error);
      });
    } catch (error) {
      logger.error('Error starting playback:', error);
      try {
        await interaction.followUp({
          content: '再生の開始に失敗しました。',
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        // インタラクションが無効な場合は無視
      }
    }
  }

  private async playNextSong(guildId: string) {
    const playlistId = this.currentPlaylists.get(guildId);
    if (!playlistId) return;

    const connection = this.connections.get(guildId);
    if (!connection) return;

    try {
      const song = await this.jellyfinClient.getRandomItemFromPlaylist(playlistId);
      if (!song) {
        logger.warn('No songs found in playlist');
        return;
      }

      // 楽曲情報をコンソールに出力
      const trackInfo = song.indexNumber
        ? song.discNumber
          ? `Disc ${song.discNumber} - Track ${song.indexNumber}`
          : `Track ${song.indexNumber}`
        : null;

      logger.info('Now playing:', {
        title: song.name,
        artist: song.artist,
        album: song.album,
        albumArtist: song.albumArtist,
        duration: song.durationSeconds ? this.formatDuration(song.durationSeconds) : 'Unknown',
        track: trackInfo,
        year: song.year,
        genres: song.genres.length > 0 ? song.genres : null,
        container: song.container,
        bitrate: song.bitrate ? `${Math.round(song.bitrate / 1000)} kbps` : null,
        sampleRate: song.sampleRate ? `${song.sampleRate} Hz` : null,
        channels: song.channels,
      });

      this.currentSongs.set(guildId, song);

      // Embedで楽曲情報を表示
      const textChannel = this.textChannels.get(guildId);
      if (textChannel) {
        const isVideo = song.mediaType === 'video';
        const embed = new EmbedBuilder()
          .setTitle(song.name)
          .addFields(
            { name: 'Artist', value: song.artist, inline: true },
            { name: 'Album', value: song.album, inline: true },
          )
          .setColor(isVideo ? 0x9b59b6 : 0x00ae86)
          .setTimestamp();

        // 再生時間を追加
        if (song.durationSeconds) {
          embed.addFields({
            name: 'Duration',
            value: this.formatDuration(song.durationSeconds),
            inline: true,
          });
        }

        // ディスク番号を追加
        if (song.discNumber) {
          embed.addFields({
            name: 'Disc',
            value: song.discNumber.toString(),
            inline: true,
          });
        }

        // トラック番号を追加
        if (song.indexNumber) {
          embed.addFields({
            name: 'Track',
            value: song.indexNumber.toString(),
            inline: true,
          });
        }

        // 発売年を追加
        if (song.year) {
          embed.addFields({
            name: 'Year',
            value: song.year.toString(),
            inline: true,
          });
        }

        // アルバムアートを取得して添付
        let attachment: AttachmentBuilder | null = null;
        if (song.imageUrl) {
          try {
            const imageResponse = await fetch(song.imageUrl);
            if (imageResponse.ok) {
              const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
              attachment = new AttachmentBuilder(imageBuffer, { name: 'album.jpg' });
              embed.setThumbnail('attachment://album.jpg');
            }
          } catch (error) {
            logger.warn('Failed to fetch album art:', error);
          }
        }

        // コントロールボタンを作成
        const controlRow = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('music_pause')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('⏸'),
            new ButtonBuilder()
              .setCustomId('music_resume')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('▶'),
            new ButtonBuilder()
              .setCustomId('music_skip')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('⏭'),
            new ButtonBuilder()
              .setCustomId('music_stop')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('⏹'),
          );

        await textChannel.send({
          embeds: [embed],
          components: [controlRow],
          files: attachment ? [attachment] : [],
          flags: [MessageFlags.SuppressNotifications],
        });
      }

      // ストリームをバッファリングしてから再生開始
      const bufferedStream = await createBufferedStream(song.streamUrl);

      // createAudioResourceに直接ストリームを渡す（内部でFFmpegが処理）
      const resource = createAudioResource(bufferedStream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });

      // 音量を30%に設定
      resource.volume?.setVolume(0.3);

      let player = this.players.get(guildId);
      if (!player) {
        player = createAudioPlayer({
          behaviors: {
            // サブスクライバーがいない場合は停止
            noSubscriber: NoSubscriberBehavior.Stop,
          },
        });
        this.players.set(guildId, player);
        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
          logger.debug('Song ended, playing next...');
          setTimeout(() => this.playNextSong(guildId), 1000);
        });

        // サブスクライバーがいなくなった場合（VCから全員退出）は退出
        player.on('stateChange', (oldState, newState) => {
          if (
            oldState.status !== AudioPlayerStatus.Idle &&
            newState.status === AudioPlayerStatus.Idle &&
            !this.currentPlaylists.has(guildId)
          ) {
            // 再生リストがない場合は接続を切断
            const conn = this.connections.get(guildId);
            if (conn) {
              logger.info('No subscribers, leaving voice channel');
              conn.destroy();
              this.cleanup(guildId);
            }
          }
        });

        player.on('error', error => {
          logger.error('Audio player error:', error);
          setTimeout(() => this.playNextSong(guildId), 1000);
        });
      }

      // FFmpegがフレームを準備する時間を確保
      await new Promise(resolve => setTimeout(resolve, 500));

      player.play(resource);
    } catch (error) {
      logger.error('Error playing song:', error);
      setTimeout(() => this.playNextSong(guildId), 2000);
    }
  }

  private async handleSkip(interaction: ChatInputCommandInteraction) {
    const player = this.players.get(interaction.guildId!);

    if (!player) {
      await interaction.reply({
        content: '再生中の曲がありません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    player.stop();
    await interaction.reply('スキップしました');
  }

  private async handleStop(interaction: ChatInputCommandInteraction) {
    const player = this.players.get(interaction.guildId!);

    if (!player) {
      await interaction.reply({
        content: '再生中の曲がありません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    player.stop();
    this.currentPlaylists.delete(interaction.guildId!);
    await interaction.reply('再生を停止しました');
  }

  private async handleNowPlaying(interaction: ChatInputCommandInteraction) {
    const song = this.currentSongs.get(interaction.guildId!);

    if (!song) {
      await interaction.reply({
        content: '現在再生中の曲がありません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isVideo = song.mediaType === 'video';
    const embed = new EmbedBuilder()
      .setTitle(song.name)
      .addFields(
        { name: 'Artist', value: song.artist, inline: true },
        { name: 'Album', value: song.album, inline: true },
      )
      .setColor(isVideo ? 0x9b59b6 : 0x00ae86)
      .setTimestamp();

    // 再生時間を追加
    if (song.durationSeconds) {
      embed.addFields({
        name: 'Duration',
        value: this.formatDuration(song.durationSeconds),
        inline: true,
      });
    }

    // ディスク番号を追加
    if (song.discNumber) {
      embed.addFields({
        name: 'Disc',
        value: song.discNumber.toString(),
        inline: true,
      });
    }

    // トラック番号を追加
    if (song.indexNumber) {
      embed.addFields({
        name: 'Track',
        value: song.indexNumber.toString(),
        inline: true,
      });
    }

    // 発売年を追加
    if (song.year) {
      embed.addFields({
        name: 'Year',
        value: song.year.toString(),
        inline: true,
      });
    }

    // アルバムアートを取得して添付
    let attachment: AttachmentBuilder | null = null;
    if (song.imageUrl) {
      try {
        const imageResponse = await fetch(song.imageUrl);
        if (imageResponse.ok) {
          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          attachment = new AttachmentBuilder(imageBuffer, { name: 'album.jpg' });
          embed.setThumbnail('attachment://album.jpg');
        }
      } catch (error) {
        logger.warn('Failed to fetch album art:', error);
      }
    }

    await interaction.reply({
      embeds: [embed],
      files: attachment ? [attachment] : [],
    });
  }
}
