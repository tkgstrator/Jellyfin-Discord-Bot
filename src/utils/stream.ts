import { Readable } from 'node:stream'
import dayjs from 'dayjs'
import { logger } from '../logger.js'
import { formatBytes } from './format.js'

// バッファサイズ（4MB - ロスレスAAC向け、高速ネットワーク環境）
const BUFFER_SIZE = 4 * 1024 * 1024

/**
 * 指定サイズまでバッファリングしてからストリームを返す
 */
export const createBufferedStream = async (url: string): Promise<Readable> => {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch stream: ${response.status}`)
  }

  const reader = response.body.getReader()
  const buffer: Uint8Array[] = []
  let bufferedSize = 0

  const startTime = dayjs()
  logger.info(`Buffering started (target: ${formatBytes(BUFFER_SIZE)})`)

  // 初期バッファを確保（awaitでブロック）
  while (bufferedSize < BUFFER_SIZE) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      buffer.push(value)
      bufferedSize += value.length
      const percent = Math.min(100, (bufferedSize / BUFFER_SIZE) * 100).toFixed(1)
      // キャリッジリターンで同じ行を上書き
      process.stdout.write(`\rBuffering: ${formatBytes(bufferedSize)} / ${formatBytes(BUFFER_SIZE)} (${percent}%)`)
    }
  }

  const elapsed = dayjs().diff(startTime, 'millisecond')
  // 改行してからログ出力
  process.stdout.write('\n')
  logger.info(`Buffering complete: ${formatBytes(bufferedSize)} in ${elapsed}ms`)

  // バッファ済みデータと残りのストリームを結合したReadableを作成
  const readable = new Readable({
    highWaterMark: BUFFER_SIZE,
    async read() {
      // まずバッファ済みデータを返す
      while (buffer.length > 0) {
        const chunk = buffer.shift()
        if (!this.push(chunk)) return // バックプレッシャー対応
      }

      // 残りのストリームを読み込み
      try {
        const { done, value } = await reader.read()
        if (done) {
          this.push(null) // ストリーム終了
        } else {
          this.push(value)
        }
      } catch (error) {
        this.destroy(error as Error)
      }
    }
  })

  return readable
}
