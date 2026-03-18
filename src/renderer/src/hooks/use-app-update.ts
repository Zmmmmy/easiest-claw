/**
 * use-app-update — 监听主进程的应用更新事件，用 Sonner toast 通知用户
 *
 * 事件流：
 *   checking → available / not-available
 *   available → (用户点击下载) → downloading → downloaded
 *   downloaded → (用户点击重启) → quitAndInstall
 */

import { useEffect } from 'react'
import { toast } from 'sonner'

const UPDATE_TOAST_ID = 'app-update'

export function useAppUpdate(): void {
  useEffect(() => {
    const unsubscribe = window.ipc.onAppUpdateStatus((s) => {
      if (s.status === 'available' && s.version) {
        toast.info(`发现新版本 v${s.version}`, {
          id: UPDATE_TOAST_ID,
          duration: 5_000,
          description: '前往设置 → 关于 下载安装',
        })
      }

      if (s.status === 'downloading') {
        // 下载进度在设置 → 关于页面显示，toast 侧静默关闭
        toast.dismiss(UPDATE_TOAST_ID)
      }

      if (s.status === 'downloaded' && s.version) {
        toast.success(`v${s.version} 已下载完成`, {
          id: UPDATE_TOAST_ID,
          duration: Infinity,
          description: '点击重启以安装新版本',
          action: {
            label: '重启更新',
            onClick: () => window.ipc.appInstallUpdate(),
          },
        })
      }

      if (s.status === 'error') {
        toast.error('检查更新失败', {
          id: UPDATE_TOAST_ID,
          description: s.error,
          duration: 5000,
        })
      }
    })

    return () => { unsubscribe() }
  }, [])
}
