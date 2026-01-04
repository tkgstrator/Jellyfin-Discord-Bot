import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration.js'

// dayjsプラグインを有効化
dayjs.extend(duration)

/**
 * バイト数を人間が読みやすい形式にフォーマット
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * 秒数を MM:SS または HH:MM:SS 形式にフォーマット
 */
export const formatDuration = (seconds: number): string => {
  const d = dayjs.duration(seconds, 'seconds')
  if (d.hours() > 0) {
    return d.format('H:mm:ss')
  }
  return d.format('m:ss')
}
