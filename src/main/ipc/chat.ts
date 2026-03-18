import type { IpcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { gw } from './gw'
import { getOpenclawStateDir } from '../lib/openclaw-config'

/** Parse messages from a JSONL transcript file */
async function parseJsonlMessages(
  filePath: string,
): Promise<Array<{ role: string; content: unknown; timestamp?: number }>> {
  const messages: Array<{ role: string; content: unknown; timestamp?: number }> = []
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type !== 'message') continue

      const msg = parsed.message as Record<string, unknown> | undefined
      if (!msg || typeof msg !== 'object') continue

      const role = msg.role as string | undefined
      if (!role) continue
      if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'toolResult') continue

      messages.push({
        role,
        content: msg.content,
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : undefined,
      })
    } catch {
      // Skip malformed lines
    }
  }

  return messages
}

export const registerChatHandlers = (ipcMain: IpcMain): void => {
  // Send a message to an agent
  ipcMain.handle('chat:send', async (_event, params: {
    agentId: string
    message: string
    sessionKey: string
    idempotencyKey: string
    attachments?: Array<{ type: string; mimeType: string; content: string }>
  }) => {
    // Strip agentId — gateway chat.send only accepts: sessionKey, message, idempotencyKey, attachments
    const { sessionKey, message, idempotencyKey, attachments } = params
    const payload: Record<string, unknown> = { sessionKey, message, idempotencyKey }
    if (attachments && attachments.length > 0) payload.attachments = attachments
    return gw('chat.send', payload)
  })

  // Abort an in-flight run
  ipcMain.handle('chat:abort', async (_event, params: { sessionKey?: string; runId?: string }) => {
    return gw('chat.abort', params)
  })

  // Load chat history for a session
  ipcMain.handle('chat:history', async (_event, params: { agentId: string; sessionKey?: string }) => {
    const sessionKey = params.sessionKey ?? `agent:${params.agentId}:main`
    return gw('chat.history', { sessionKey })
  })

  // List sessions
  ipcMain.handle('sessions:list', async (_event, params?: Record<string, unknown>) => {
    return gw('sessions.list', params ?? {})
  })

  // Reset a session
  ipcMain.handle('sessions:reset', async (_event, params: { sessionKey: string }) => {
    return gw('sessions.reset', params)
  })

  // Patch session settings (e.g. thinking/verbose toggles)
  ipcMain.handle('sessions:patch', async (_event, params: { sessionKey: string; patch: Record<string, unknown> }) => {
    return gw('sessions.patch', params)
  })

  // Read full history from JSONL transcript (includes pre-compaction messages)
  // Accepts either sessionKey (resolved via sessions.list) or sessionId (direct file access)
  ipcMain.handle('chat:history:full', async (_event, params: { agentId: string; sessionKey?: string; sessionId?: string }) => {
    try {
      let sessionId = params.sessionId

      // If no direct sessionId, resolve from sessionKey via sessions.list
      if (!sessionId && params.sessionKey) {
        const listRes = await gw<{ sessions: Array<{ key: string; sessionId: string }> }>('sessions.list', {
          agentId: params.agentId,
        })
        if (!listRes.ok) return { ok: false, error: listRes.error }

        const sessions = listRes.result?.sessions ?? []
        const entry = sessions.find((s: { key: string }) => s.key === params.sessionKey)
        if (!entry?.sessionId) {
          return { ok: false, error: 'Session not found' }
        }
        sessionId = entry.sessionId
      }

      if (!sessionId) {
        return { ok: false, error: 'No sessionId or sessionKey provided' }
      }

      // Locate the JSONL file (could be normal or .reset.* archived)
      const stateDir = getOpenclawStateDir()
      const sessionsDir = path.join(stateDir, 'agents', params.agentId, 'sessions')
      const jsonlPath = path.join(sessionsDir, `${sessionId}.jsonl`)

      // Also check for .reset.* files if the base JSONL doesn't exist
      let targetPath = jsonlPath
      try {
        await fs.promises.access(jsonlPath)
      } catch {
        // Look for archived .reset.* file
        try {
          const files = await fs.promises.readdir(sessionsDir)
          const resetFile = files.find((f) => f.startsWith(`${sessionId}.jsonl.reset.`))
          if (resetFile) {
            targetPath = path.join(sessionsDir, resetFile)
          } else {
            // No JSONL on disk, fall back to gateway API
            if (params.sessionKey) {
              return gw('chat.history', { sessionKey: params.sessionKey })
            }
            return { ok: false, error: 'JSONL file not found' }
          }
        } catch {
          return { ok: false, error: 'Sessions directory not found' }
        }
      }

      // Parse JSONL line by line
      const messages = await parseJsonlMessages(targetPath)
      return { ok: true, result: { messages } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  // Scan filesystem for all sessions of an agent (includes orphaned/reset sessions)
  ipcMain.handle('sessions:list:all', async (_event, params: { agentId: string }) => {
    try {
      const stateDir = getOpenclawStateDir()
      const sessionsDir = path.join(stateDir, 'agents', params.agentId, 'sessions')

      let files: string[]
      try {
        files = await fs.promises.readdir(sessionsDir)
      } catch {
        return { ok: true, result: { sessions: [] } }
      }

      // Get tracked sessions from sessions.json for metadata
      const sessionsJsonPath = path.join(sessionsDir, 'sessions.json')
      let trackedSessions: Record<string, { sessionId?: string; updatedAt?: number; displayName?: string }> = {}
      try {
        const raw = await fs.promises.readFile(sessionsJsonPath, 'utf8')
        trackedSessions = JSON.parse(raw) as typeof trackedSessions
      } catch {
        // No sessions.json
      }

      // Build reverse map: sessionId → sessionKey
      const sessionIdToKey: Record<string, string> = {}
      for (const [key, val] of Object.entries(trackedSessions)) {
        if (val?.sessionId) sessionIdToKey[val.sessionId] = key
      }

      // Collect all JSONL files
      const sessions: Array<{
        sessionId: string
        sessionKey: string | null
        updatedAt: number | null
        displayName: string | null
        isReset: boolean
        resetTimestamp: string | null
        isTracked: boolean
      }> = []

      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') || f.includes('.jsonl.reset.'))

      for (const file of jsonlFiles) {
        const isReset = file.includes('.jsonl.reset.')
        let sessionId: string
        let resetTimestamp: string | null = null

        if (isReset) {
          // Format: <sessionId>.jsonl.reset.<timestamp>
          const match = /^([^.]+)\.jsonl\.reset\.(.+)$/.exec(file)
          if (!match) continue
          sessionId = match[1]
          resetTimestamp = match[2]
        } else {
          // Format: <sessionId>.jsonl
          sessionId = file.replace('.jsonl', '')
        }

        // Skip non-UUID-looking names (like sessions.json parsed wrong)
        if (sessionId.length < 8) continue

        const trackedKey = sessionIdToKey[sessionId] ?? null
        const trackedMeta = trackedKey ? trackedSessions[trackedKey] : null

        // Get file modification time as fallback for updatedAt
        let updatedAt = trackedMeta?.updatedAt ?? null
        if (!updatedAt) {
          try {
            const stat = await fs.promises.stat(path.join(sessionsDir, file))
            updatedAt = stat.mtimeMs
          } catch {
            // ignore
          }
        }

        // Parse reset timestamp for sorting
        if (isReset && resetTimestamp && !updatedAt) {
          // resetTimestamp format: 2026-03-14T10-01-13.144Z
          const isoStr = resetTimestamp.replace(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/, '$1T$2:$3:$4')
          const parsed = Date.parse(isoStr)
          if (!isNaN(parsed)) updatedAt = parsed
        }

        // Read first user message as preview
        let firstUserMessage: string | null = null
        try {
          const filePath = path.join(sessionsDir, file)
          const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
          const rlInner = readline.createInterface({ input: stream, crlfDelay: Infinity })
          for await (const line of rlInner) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>
              if (parsed.type !== 'message') continue
              const msg = parsed.message as Record<string, unknown> | undefined
              if (msg?.role === 'user') {
                const content = msg.content
                if (typeof content === 'string') {
                  firstUserMessage = content.slice(0, 100)
                } else if (Array.isArray(content)) {
                  const textBlock = (content as Array<Record<string, unknown>>).find((b) => b.type === 'text')
                  if (textBlock && typeof textBlock.text === 'string') {
                    // Strip the "Sender (untrusted metadata)" prefix
                    let text = textBlock.text
                    const senderEnd = text.indexOf('\n```\n')
                    if (senderEnd !== -1 && text.startsWith('Sender')) {
                      text = text.slice(senderEnd + 5).trim()
                    }
                    firstUserMessage = text.slice(0, 100)
                  }
                }
                break
              }
            } catch {
              // skip
            }
          }
          rlInner.close()
        } catch {
          // ignore
        }

        sessions.push({
          sessionId,
          sessionKey: trackedKey,
          updatedAt,
          displayName: trackedMeta?.displayName ?? firstUserMessage,
          isReset,
          resetTimestamp,
          isTracked: !!trackedKey,
        })
      }

      // Sort by updatedAt descending
      sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

      return { ok: true, result: { sessions } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })
}
