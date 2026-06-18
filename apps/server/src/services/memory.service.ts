import { newId } from "@ss/shared";
import { and, asc, eq } from "drizzle-orm";

import type { Memory } from "../chat/memory.js";
import type { Db } from "../db/index.js";
import { aiMemories } from "../db/schema/index.js";

// Per-org assistant memory store (ai-assistant-roadmap.md). Keyed upsert so
// re-remembering a key updates in place, capped so the auto-injected prompt block
// stays small. Org-scoped throughout — callers pass the resolved orgId.

export const MEMORY_MAX = 50;
const KEY_MAX = 80;
const CONTENT_MAX = 500;

export interface MemoryResult {
  ok: boolean;
  message: string;
}

export async function listMemories(db: Db, orgId: string): Promise<Memory[]> {
  return db
    .select({ key: aiMemories.key, content: aiMemories.content })
    .from(aiMemories)
    .where(eq(aiMemories.organizationId, orgId))
    .orderBy(asc(aiMemories.key));
}

/** Upsert a memory by (org, key). Validates + enforces the per-org cap; returns a
 *  user-facing message rather than throwing, so the chat tool can relay it. */
export async function rememberMemory(
  db: Db,
  orgId: string,
  keyRaw: unknown,
  contentRaw: unknown,
): Promise<MemoryResult> {
  const key = typeof keyRaw === "string" ? keyRaw.trim().slice(0, KEY_MAX) : "";
  const content = typeof contentRaw === "string" ? contentRaw.trim() : "";
  if (!key || !content) return { ok: false, message: "A memory needs both a key and content." };
  if (content.length > CONTENT_MAX) {
    return { ok: false, message: `Memory content must be ${CONTENT_MAX} characters or fewer.` };
  }

  const existing = (
    await db
      .select({ id: aiMemories.id })
      .from(aiMemories)
      .where(and(eq(aiMemories.organizationId, orgId), eq(aiMemories.key, key)))
      .limit(1)
  )[0];

  if (!existing) {
    const all = await db
      .select({ id: aiMemories.id })
      .from(aiMemories)
      .where(eq(aiMemories.organizationId, orgId));
    if (all.length >= MEMORY_MAX) {
      return {
        ok: false,
        message: `Memory is full (${MEMORY_MAX} items). Ask the user which one to forget first.`,
      };
    }
  }

  await db
    .insert(aiMemories)
    .values({ id: newId("mem"), organizationId: orgId, key, content })
    .onConflictDoUpdate({
      target: [aiMemories.organizationId, aiMemories.key],
      set: { content, updatedAt: new Date() },
    });
  return { ok: true, message: `Remembered "${key}".` };
}

export async function forgetMemory(db: Db, orgId: string, keyRaw: unknown): Promise<MemoryResult> {
  // Slice the same way remember does, so a key truncated on write is still forgettable.
  const key = typeof keyRaw === "string" ? keyRaw.trim().slice(0, KEY_MAX) : "";
  if (!key) return { ok: false, message: "Tell me which memory key to forget." };
  const deleted = await db
    .delete(aiMemories)
    .where(and(eq(aiMemories.organizationId, orgId), eq(aiMemories.key, key)))
    .returning({ id: aiMemories.id });
  return deleted.length
    ? { ok: true, message: `Forgot "${key}".` }
    : { ok: false, message: `No memory named "${key}".` };
}
