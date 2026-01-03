## Jellyfin Discord Bot

Jellyfinサーバーの音楽ライブラリからランダム再生を行うDiscord Botです。

## 主な機能

- ✅ Jellyfin APIと連携してプレイリストを取得
- ✅ プレイリストからランダムに音楽を再生
- ✅ Discordの音声チャンネルで音楽をストリーミング
- ✅ 基本的な再生コントロール（再生、停止、スキップ）

## 実装されているファイル

### `src/jellyfin.ts`
Jellyfin APIクライアント
- プレイリストの取得
- プレイリスト内のアイテム（音楽）の取得
- ランダムアイテムの選択
- ストリーミングURL生成

### `src/bot.ts`
Discord Bot本体
- スラッシュコマンドの実装
- 音声チャンネルへの接続
- 音楽の再生管理
- プレイヤーの状態管理

### `src/index.ts`
エントリーポイント
- 環境変数の検証
- Jellyfinクライアントの初期化
- Botの起動

## 利用可能なコマンド

- `/join` - ボイスチャンネルに参加
- `/leave` - ボイスチャンネルから退出
- `/playlists` - 利用可能なプレイリスト一覧を表示
- `/play <playlist>` - プレイリストからランダム再生開始
- `/skip` - 次の曲にスキップ
- `/stop` - 再生を停止
- `/nowplaying` - 現在再生中の曲を表示（開発中）

## セットアップ

1. `.env.example` を `.env` にコピーして環境変数を設定
2. `bun install` で依存パッケージをインストール
3. `bun run dev` で開発モードで起動

## Docker でのデプロイ

```bash
docker compose up -d
```

詳細は [README.md](../README.md) を参照してください。
