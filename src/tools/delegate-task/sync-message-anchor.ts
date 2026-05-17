import type { SessionMessage } from "./executor-types"

export interface SyncMessageAnchor {
  count: number
  lastMessageID?: string
  lastMessageCreatedAt?: number
}

function findMessageIndexByID(messages: SessionMessage[], messageID: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info?.id === messageID) {
      return i
    }
  }

  return -1
}

export function createSyncMessageAnchor(messages: SessionMessage[]): SyncMessageAnchor {
  const lastMessage = messages.at(-1)
  const lastMessageCreatedAt = lastMessage?.info?.time?.created

  return {
    count: messages.length,
    lastMessageID: lastMessage?.info?.id,
    lastMessageCreatedAt: typeof lastMessageCreatedAt === "number" ? lastMessageCreatedAt : undefined,
  }
}

export function getMessagesAfterAnchor(
  messages: SessionMessage[],
  anchor?: SyncMessageAnchor | number,
): SessionMessage[] {
  if (anchor === undefined) {
    return messages
  }

  if (typeof anchor === "number") {
    return messages.slice(anchor)
  }

  if (anchor.lastMessageID) {
    const anchorIndex = findMessageIndexByID(messages, anchor.lastMessageID)
    if (anchorIndex >= 0) {
      return messages.slice(anchorIndex + 1)
    }
  }

  if (typeof anchor.lastMessageCreatedAt === "number") {
    const messagesAfterTime = messages.filter((message) => {
      const createdAt = message.info?.time?.created
      return typeof createdAt === "number" && createdAt > anchor.lastMessageCreatedAt!
    })

    if (messagesAfterTime.length > 0) {
      return messagesAfterTime
    }
  }

  if (messages.length > anchor.count) {
    return messages.slice(anchor.count)
  }

  return []
}
