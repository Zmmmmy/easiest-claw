import Dexie, { type Table } from "dexie"
import type { ChatAttachment } from "@/types"

interface AttachmentCacheEntry {
  id?: number
  convId: string    // 对话 ID，indexed
  text: string      // 消息文本，用于匹配
  attachments: ChatAttachment[]
  createdAt: number // Date.now()，用于清理旧数据
}

class AppDb extends Dexie {
  attachmentCache!: Table<AttachmentCacheEntry>

  constructor() {
    super("easiest-claw-db")
    this.version(1).stores({
      // ++id = autoIncrement PK；convId 单字段索引；[convId+text] 复合索引
      attachmentCache: "++id, convId, [convId+text]",
    })
  }
}

export const db = new AppDb()

// 每个对话最多保留的缓存条目数
const MAX_ENTRIES_PER_CONV = 100
// 单条缓存超过此大小则跳过（防止 IndexedDB 存储压力过大）
const MAX_ENTRY_BYTES = 800 * 1024

/**
 * 保存图片附件缓存。
 * - 单条序列化后超 800KB 则跳过
 * - 每个对话超过 100 条时清理最旧的条目
 */
export async function saveAttachmentCacheDb(
  convId: string,
  text: string,
  attachments: ChatAttachment[]
): Promise<void> {
  try {
    const entry: AttachmentCacheEntry = { convId, text, attachments, createdAt: Date.now() }
    if (JSON.stringify(entry).length > MAX_ENTRY_BYTES) return
    await db.attachmentCache.add(entry)
    // 超出条数时清理最旧的
    const total = await db.attachmentCache.where("convId").equals(convId).count()
    if (total > MAX_ENTRIES_PER_CONV) {
      const oldest = await db.attachmentCache
        .where("convId").equals(convId)
        .sortBy("createdAt")
      const toDelete = oldest.slice(0, total - MAX_ENTRIES_PER_CONV).map((e) => e.id!)
      await db.attachmentCache.bulkDelete(toDelete)
    }
  } catch {
    // IndexedDB 不可用时静默失败
  }
}

/**
 * 按 convId + text 匹配并返回第一条缓存的附件。
 * 不删除缓存条目，以便应用重启后仍能恢复图片。
 * 找不到则返回空数组。
 */
export async function getAttachmentCacheDb(
  convId: string,
  text: string
): Promise<ChatAttachment[]> {
  try {
    const entry = await db.attachmentCache
      .where("[convId+text]")
      .equals([convId, text])
      .first()
    if (!entry?.id) return []
    return entry.attachments
  } catch {
    return []
  }
}
