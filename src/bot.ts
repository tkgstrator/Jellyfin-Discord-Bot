import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Interaction,
  type ChatInputCommandInteraction,
  type TextChannel,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import { JellyfinClient, type MusicItem } from './jellyfin.js';
import { logger } from './logger.js';

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
      if (interaction.isChatInputCommand()) {
        await this.handleCommand(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await this.handleSelectMenu(interaction);
      }
    });
  }

  private async handleSelectMenu(interaction: StringSelectMenuInteraction) {
    if (interaction.customId === 'playlist_select') {
      await this.handlePlaylistSelect(interaction);
    }
  }

  private async registerCommands() {
    const commands = [
      {
        name: 'join',
        description: 'ボイスチャンネルに参加します',
      },
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
        case 'join':
          await this.handleJoin(interaction);
          break;
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
      await interaction.reply({
        content: 'エラーが発生しました。',
        ephemeral: true,
      });
    }
  }

  private async handleJoin(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as any;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: 'ボイスチャンネルに参加してからコマンドを実行してください。',
        ephemeral: true,
      });
      return;
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild!.voiceAdapterCreator as any,
    });

    this.connections.set(interaction.guildId!, connection);
    await interaction.reply(`${voiceChannel.name} に参加しました`);
  }

  private async handleLeave(interaction: ChatInputCommandInteraction) {
    const connection = this.connections.get(interaction.guildId!);

    if (!connection) {
      await interaction.reply({
        content: 'ボイスチャンネルに参加していません。',
        ephemeral: true,
      });
      return;
    }

    connection.destroy();
    this.connections.delete(interaction.guildId!);
    this.players.delete(interaction.guildId!);
    this.currentPlaylists.delete(interaction.guildId!);
    this.queues.delete(interaction.guildId!);

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
    await interaction.deferReply();

    const connection = this.connections.get(interaction.guildId!);
    if (!connection) {
      await interaction.editReply('先に `/join` でボイスチャンネルに参加してください。');
      return;
    }

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

    if (!guildId || !playlistId) {
      return;
    }

    const connection = this.connections.get(guildId);
    if (!connection) {
      await interaction.followUp({
        content: 'ボイスチャンネルに接続されていません。',
        ephemeral: true,
      });
      return;
    }

    try {
      const playlists = await this.jellyfinClient.getPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);

      this.currentPlaylists.set(guildId, playlistId);
      this.textChannels.set(guildId, interaction.channel as TextChannel);

      await interaction.editReply({
        content: `プレイリスト **${playlist?.name || 'Unknown'}** からランダム再生を開始します`,
        components: [],
      });

      await this.playNextSong(guildId);
    } catch (error) {
      logger.error('Error starting playback:', error);
      await interaction.followUp({
        content: '再生の開始に失敗しました。',
        ephemeral: true,
      });
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

      logger.info(`Playing: ${song.name} by ${song.artist}`);
      this.currentSongs.set(guildId, song);

      // Embedで楽曲情報を表示
      const textChannel = this.textChannels.get(guildId);
      if (textChannel) {
        const isVideo = song.mediaType === 'video';
        const embed = new EmbedBuilder()
          .setTitle(isVideo ? 'Now Playing (Video)' : 'Now Playing')
          .addFields(
            { name: 'Title', value: song.name, inline: true },
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

        // アルバムアートを設定
        if (song.imageUrl) {
          embed.setThumbnail(song.imageUrl);
        }

        await textChannel.send({ embeds: [embed] });
      }

      const resource = createAudioResource(song.streamUrl, {
        inlineVolume: true,
      });

      // 音量を30%に設定
      resource.volume?.setVolume(0.3);

      let player = this.players.get(guildId);
      if (!player) {
        player = createAudioPlayer();
        this.players.set(guildId, player);
        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
          logger.debug('Song ended, playing next...');
          setTimeout(() => this.playNextSong(guildId), 1000);
        });

        player.on('error', error => {
          logger.error('Audio player error:', error);
          setTimeout(() => this.playNextSong(guildId), 1000);
        });
      }

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
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const isVideo = song.mediaType === 'video';
    const embed = new EmbedBuilder()
      .setTitle(isVideo ? 'Now Playing (Video)' : 'Now Playing')
      .addFields(
        { name: 'Title', value: song.name, inline: true },
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

    // アルバムアートを設定
    if (song.imageUrl) {
      embed.setThumbnail(song.imageUrl);
    }

    await interaction.reply({ embeds: [embed] });
  }
}
