# Jellyfin Discord Bot

Discord の音声チャンネルで Jellyfin サーバーの音楽ライブラリからランダム再生する Discord Bot です。

## 概要

このボットは以下の機能を提供します:

- Jellyfin サーバーのプレイリストにアクセス
- プレイリストから音楽をランダムに再生
- Discord の音声チャンネルでの音楽ストリーミング
- 基本的な再生コントロール（再生、停止、スキップ）

## 技術スタック

- **Runtime**: [Node.js](https://nodejs.org/) v24+（ビルドには[Bun](https://bun.sh)を使用）
- **言語**: TypeScript
- **主要ライブラリ**:
  - [discord.js](https://discord.js.org/) - Discord API クライアント
  - [@discordjs/voice](https://discordjs.guide/voice/) - 音声機能
  - [@jellyfin/sdk](https://github.com/jellyfin/jellyfin-sdk-typescript) - Jellyfin API クライアント
  - [Zod](https://zod.dev/) - スキーマバリデーション
- **音楽サーバー**: [Jellyfin](https://jellyfin.org/)

## 前提条件

- Docker および Docker Compose がインストールされていること
- Jellyfin サーバーが稼働していること
  - プレイリストが作成されていること
  - API キーが生成されていること
- Discord Bot のトークンを取得済みであること
  - [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
  - Bot を作成してトークンを取得
  - 必要な権限: `Send Messages`, `Connect`, `Speak`, `Use Voice Activity`
  - Privileged Gateway Intents: `MESSAGE CONTENT INTENT` を有効化（オプション）

## セットアップ

### 1. Jellyfin の準備

1. Jellyfin 管理画面にログイン
2. ダッシュボード > API キー から新しい API キーを生成
3. ダッシュボード > ユーザー から使用するユーザーの ID を確認（URL に表示されます）
4. 音楽ライブラリにプレイリストを作成

### 2. 環境変数の設定

`.env.example` をコピーして `.env` ファイルを作成します:

```bash
cp .env.example .env
```

`.env` ファイルを編集して、必要な情報を設定します:

```env
# Discord Bot Token (必須)
DISCORD_TOKEN=your_discord_bot_token_here

# Jellyfin サーバー URL (必須)
JELLYFIN_URL=http://jellyfin:8096

# Jellyfin API キー (必須)
JELLYFIN_API_KEY=your_jellyfin_api_key_here

# Jellyfin ユーザー ID (必須)
JELLYFIN_USER_ID=your_jellyfin_user_id_here
```

### 3. Docker Compose で起動

```bash
docker compose up -d
```

### 4. ログの確認

```bash
docker compose logs -f app
```

## 使い方

### Discord コマンド

Bot を招待したサーバーで以下のスラッシュコマンドが使用できます:

#### `/play`
プレイリスト選択メニューを表示し、選択したプレイリストからランダムに音楽を再生します。
- ボイスチャンネルに参加した状態で実行してください
- Bot は自動的にボイスチャンネルに参加します

#### `/playlists`
Jellyfin サーバーで利用可能なプレイリストを一覧表示します。

#### `/skip`
現在再生中の曲をスキップして次の曲を再生します。

#### `/stop`
音楽の再生を停止します（プレイリストの再生も終了）。

#### `/leave`
ボイスチャンネルから Bot を退出させます。

#### `/nowplaying`
現在再生中の曲の情報を表示します。

### コントロールボタン

曲の再生時に表示される Embed には、以下のコントロールボタンが付いています:

- ⏸ **一時停止** - 再生を一時停止します
- ▶ **再開** - 一時停止した再生を再開します
- ⏭ **スキップ** - 次の曲にスキップします
- ⏹ **停止** - 再生を停止します

### 使用例

1. ボイスチャンネルに参加
2. `/play` でプレイリスト選択メニューを表示
3. プレイリストを選択して再生開始
4. Embed のボタンまたは `/skip` で曲をスキップ
5. `/stop` で再生停止
6. `/leave` で Bot を退出させる

## 開発

### ローカル開発環境

```bash
# 依存パッケージのインストール
bun install

# 開発モードで起動（ホットリロード有効）
bun run dev

# ビルド
bun run build

# 本番モード起動
bun run start
```

### プロジェクト構成

```
├── src/
│   ├── index.ts      # エントリーポイント
│   ├── bot.ts        # Discord Bot実装
│   ├── jellyfin.ts   # Jellyfin APIクライアント
│   └── README.md     # 実装詳細
├── package.json      # 依存関係
├── tsconfig.json     # TypeScript設定
├── Dockerfile        # Dockerイメージ定義
├── compose.yaml      # Docker Compose設定
└── .env.example      # 環境変数サンプル
```

## トラブルシューティング

### Bot がボイスチャンネルに接続できない

- Discord Bot の権限を確認してください（`Connect`, `Speak` 権限が必要）
- Bot をサーバーに招待する際、適切な OAuth2 スコープ（`bot`, `applications.commands`）を選択してください

### Jellyfin サーバーに接続できない

- `JELLYFIN_URL` が正しいか確認してください
- API キーが有効か確認してください
- Jellyfin サーバーが起動しているか確認してください
- Docker Compose を使用している場合、ネットワーク設定を確認してください

### 音楽が再生されない

- プレイリストに音楽が登録されているか確認してください
- Jellyfin サーバーの音楽ファイルが正しくスキャンされているか確認してください
- ffmpeg がインストールされているか確認してください（Docker イメージには含まれています）

## Docker Compose のカスタマイズ例

Jellyfin サーバーも一緒に起動する場合:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      DISCORD_TOKEN: ${DISCORD_TOKEN}
      JELLYFIN_URL: http://jellyfin:8096
      JELLYFIN_API_KEY: ${JELLYFIN_API_KEY}
      JELLYFIN_USER_ID: ${JELLYFIN_USER_ID}
    depends_on:
      - jellyfin
    restart: unless-stopped

  jellyfin:
    image: jellyfin/jellyfin:latest
    ports:
      - "8096:8096"
    volumes:
      - jellyfin-config:/config
      - jellyfin-cache:/cache
      - /path/to/your/media:/media:ro
    restart: unless-stopped

volumes:
  jellyfin-config:
  jellyfin-cache:
```

## ライセンス

MIT

## 貢献

プルリクエストやイシューの報告を歓迎します！

## 参考リンク

- [Discord.js ドキュメント](https://discord.js.org/)
- [Jellyfin API ドキュメント](https://api.jellyfin.org/)
- [Bun ドキュメント](https://bun.sh/docs)
