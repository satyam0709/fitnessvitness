const { pool } = require("../config/database");
const { emitChatThreadChanged, emitChatMessageCreated } = require("../realtime/meetingsRealtime");
const { createUserNotification } = require("../services/notificationService");

function directPairKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  const lo = Math.min(x, y);
  const hi = Math.max(x, y);
  return `u:${lo}:u:${hi}`;
}

function getMeId(req) {
  const id = Number(req.user?.id || 0);
  return id || null;
}

async function listChatUsers(req, res) {
  try {
    const meId = getMeId(req);
    const tenantId = req.user?.tenant_id ?? req.user?.tenantId ?? null;
    if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });

    const [rows] = await pool.execute(
      `SELECT id, first_name, last_name, email, role
       FROM users
       WHERE is_active = 1 AND id <> ? AND tenant_id = ?
       ORDER BY first_name ASC, last_name ASC, id ASC`,
      [meId, tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listThreads(req, res) {
  try {
    const meId = getMeId(req);
    if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const [rows] = await pool.execute(
      `
      SELECT
        t.id,
        t.thread_type,
        t.title,
        t.created_by,
        t.updated_at,
        memb.member_role,
        (
          SELECT COUNT(*)
          FROM chat_thread_members cmx
          WHERE cmx.thread_id = t.id
        ) AS participant_count,
        (
          SELECT GROUP_CONCAT(TRIM(CONCAT(COALESCE(ux.first_name, ''), ' ', COALESCE(ux.last_name, ''))) SEPARATOR ', ')
          FROM (
            SELECT cm2.user_id
            FROM chat_thread_members cm2
            WHERE cm2.thread_id = t.id AND cm2.user_id <> ?
            ORDER BY cm2.user_id ASC
            LIMIT 3
          ) topm
          JOIN users ux ON ux.id = topm.user_id
        ) AS participant_preview,
        lm.id AS last_message_id,
        lm.body AS last_message_body,
        lm.attachments_json AS last_message_attachments_json,
        lm.created_at AS last_message_at,
        (
          SELECT uo.id
          FROM chat_thread_members mo
          JOIN users uo ON uo.id = mo.user_id
          WHERE mo.thread_id = t.id AND mo.user_id <> ?
          ORDER BY mo.user_id ASC
          LIMIT 1
        ) AS direct_other_user_id,
        (
          SELECT uo.first_name
          FROM chat_thread_members mo
          JOIN users uo ON uo.id = mo.user_id
          WHERE mo.thread_id = t.id AND mo.user_id <> ?
          ORDER BY mo.user_id ASC
          LIMIT 1
        ) AS direct_other_first_name,
        (
          SELECT uo.last_name
          FROM chat_thread_members mo
          JOIN users uo ON uo.id = mo.user_id
          WHERE mo.thread_id = t.id AND mo.user_id <> ?
          ORDER BY mo.user_id ASC
          LIMIT 1
        ) AS direct_other_last_name,
        (
          SELECT COUNT(*)
          FROM chat_thread_messages m
          WHERE m.thread_id = t.id
            AND m.id > COALESCE(memb.last_read_message_id, 0)
            AND m.sender_id <> ?
        ) AS unread_count
      FROM chat_thread_members memb
      JOIN chat_threads t ON t.id = memb.thread_id
      LEFT JOIN chat_thread_messages lm
        ON lm.id = (
          SELECT m2.id
          FROM chat_thread_messages m2
          WHERE m2.thread_id = t.id
          ORDER BY m2.id DESC
          LIMIT 1
        )
      WHERE memb.user_id = ?
      ORDER BY COALESCE(lm.id, 0) DESC, t.updated_at DESC
      LIMIT 200
      `,
      [meId, meId, meId, meId, meId, meId]
    );

    const uniq = [];
    const seen = new Set();
    for (const row of rows) {
      const tid = Number(row?.id || 0);
      if (!tid || seen.has(tid)) continue;
      seen.add(tid);
      const isCreator = Number(row.created_by || 0) === Number(meId);
      uniq.push({
        ...row,
        is_creator: isCreator,
        can_delete: row.thread_type === "direct" ? true : isCreator,
      });
    }

    res.json({ success: true, data: uniq });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getThreadDetails(req, res) {
  try {
    const meId = getMeId(req);
    if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const threadId = Number(req.params.id);
    if (!threadId) return res.status(400).json({ success: false, message: "Invalid thread id" });

    const [[thread]] = await pool.execute(
      `SELECT t.id, t.thread_type, t.title, t.created_by, t.created_at, t.updated_at
       FROM chat_threads t
       JOIN chat_thread_members m ON m.thread_id = t.id
       WHERE t.id = ? AND m.user_id = ?
       LIMIT 1`,
      [threadId, meId]
    );
    if (!thread) return res.status(404).json({ success: false, message: "Thread not found" });

    const [members] = await pool.execute(
      `SELECT u.id, u.first_name, u.last_name, u.email, m.member_role, m.joined_at
       FROM chat_thread_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.thread_id = ?
       ORDER BY u.first_name ASC, u.last_name ASC, u.id ASC`,
      [threadId]
    );

    return res.json({
      success: true,
      data: {
        ...thread,
        participant_count: members.length,
        is_creator: Number(thread.created_by || 0) === Number(meId),
        can_delete: thread.thread_type === "direct" || Number(thread.created_by || 0) === Number(meId),
        members,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function createThread(req, res) {
  const meId = getMeId(req);
  if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });

  const { thread_type, title, member_ids, other_user_id } = req.body || {};
  const type = thread_type === "group" ? "group" : "direct";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (type === "direct") {
      const otherId = Number(other_user_id);
      if (!otherId) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: "other_user_id is required" });
      }

      const pairKey = directPairKey(meId, otherId);
      const [[existing]] = await conn.execute(
        "SELECT thread_id FROM chat_direct_pairs WHERE pair_key = ? LIMIT 1",
        [pairKey]
      );
      if (existing?.thread_id) {
        await conn.commit();
        return res.json({ success: true, data: { id: existing.thread_id, thread_type: "direct" } });
      }

      const [tRes] = await conn.execute(
        "INSERT INTO chat_threads (thread_type, title, created_by) VALUES ('direct', NULL, ?)",
        [meId]
      );
      const threadId = tRes.insertId;

      await conn.execute(
        "INSERT INTO chat_thread_members (thread_id, user_id, member_role) VALUES (?, ?, 'member'), (?, ?, 'member')",
        [threadId, meId, threadId, otherId]
      );
      await conn.execute(
        "INSERT INTO chat_direct_pairs (pair_key, thread_id) VALUES (?, ?)",
        [pairKey, threadId]
      );

      await conn.commit();
      emitChatThreadChanged([meId, otherId], { reason: "thread_created", threadId });
      return res.json({ success: true, data: { id: threadId, thread_type: "direct" } });
    }

    const ids = Array.isArray(member_ids) ? member_ids.map((n) => Number(n)).filter(Boolean) : [];
    const unique = Array.from(new Set([meId, ...ids]));
    if (unique.length < 2) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "member_ids must include at least 1 other user" });
    }

    const placeholders = unique.map(() => "?").join(", ");
    const [validRows] = await conn.execute(
      `SELECT id FROM users WHERE is_active = 1 AND id IN (${placeholders})`,
      unique
    );
    const validSet = new Set(validRows.map((r) => Number(r.id)));
    const finalMembers = unique.filter((id) => validSet.has(Number(id)));
    if (finalMembers.length < 2) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "No valid members selected" });
    }

    const [tRes] = await conn.execute(
      "INSERT INTO chat_threads (thread_type, title, created_by) VALUES ('group', ?, ?)",
      [String(title || "").trim() || "New group", meId]
    );
    const threadId = tRes.insertId;

    const values = finalMembers.map(() => "(?, ?, 'member')").join(", ");
    const params = finalMembers.flatMap((uid) => [threadId, uid]);
    await conn.execute(
      `INSERT INTO chat_thread_members (thread_id, user_id, member_role) VALUES ${values}`,
      params
    );
    await conn.execute(
      "UPDATE chat_thread_members SET member_role = 'admin' WHERE thread_id = ? AND user_id = ?",
      [threadId, meId]
    );

    await conn.commit();
    emitChatThreadChanged(finalMembers, { reason: "thread_created", threadId });
    res.json({ success: true, data: { id: threadId, thread_type: "group" } });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
}

async function listMessages(req, res) {
  try {
    const meId = getMeId(req);
    if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const threadId = parseInt(String(req.params.id || ""), 10);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid thread id" });
    }

    // Use numeric-only interpolation (sanitized integers) to avoid prepared statement edge cases.
    const [membRows] = await pool.query(
      `SELECT user_id, last_read_message_id
       FROM chat_thread_members
       WHERE thread_id = ${threadId} AND user_id = ${meId}
       LIMIT 1`
    );
    const memb = membRows?.[0];
    if (!memb) return res.status(403).json({ success: false, message: "Forbidden" });

    const parsedLimit = parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
    const beforeRaw = req.query.beforeId;
    const parsedBefore = beforeRaw == null ? null : parseInt(String(beforeRaw), 10);
    const beforeId = Number.isFinite(parsedBefore) && parsedBefore > 0 ? parsedBefore : null;

    let sql = `
      SELECT
        m.id, m.thread_id, m.sender_id, m.body, m.attachments_json, m.created_at,
        u.first_name AS sender_first_name, u.last_name AS sender_last_name
      FROM chat_thread_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id = ${threadId}
    `;
    if (beforeId) {
      sql += ` AND m.id < ${beforeId}`;
    }
    sql += ` ORDER BY m.id DESC LIMIT ${limit}`;

    const [rows] = await pool.query(sql);

    res.json({
      success: true,
      data: rows.reverse(),
      meta: { last_read_message_id: memb.last_read_message_id || 0 },
    });
  } catch (err) {
    console.error("listMessages error:", err);
    res.status(500).json({
      success: false,
      message: `listMessages_v2: ${err.message}`,
    });
  }
}

async function sendMessageToThread(req, res) {
  try {
    const meId = getMeId(req);
    if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const threadId = Number(req.params.id);
    if (!threadId) return res.status(400).json({ success: false, message: "Invalid thread id" });

    const body = String(req.body?.body || "").trim();
    const attachments = req.body?.attachments || null;
    if (!body && (!attachments || (Array.isArray(attachments) && attachments.length === 0))) {
      return res.status(400).json({ success: false, message: "Message body or attachments required" });
    }

    const [[memb]] = await pool.execute(
      "SELECT user_id FROM chat_thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1",
      [threadId, meId]
    );
    if (!memb) return res.status(403).json({ success: false, message: "Forbidden" });

    const [result] = await pool.execute(
      "INSERT INTO chat_thread_messages (thread_id, sender_id, body, attachments_json) VALUES (?, ?, ?, ?)",
      [threadId, meId, body || "", attachments ? JSON.stringify(attachments) : null]
    );
    const messageId = result.insertId;

    await pool.execute("UPDATE chat_threads SET updated_at = NOW() WHERE id = ?", [threadId]);

    const [members] = await pool.execute(
      "SELECT user_id FROM chat_thread_members WHERE thread_id = ?",
      [threadId]
    );
    const memberIds = members.map((r) => r.user_id);

    emitChatMessageCreated(threadId, memberIds, {
      id: messageId,
      thread_id: threadId,
      sender_id: meId,
      body: body || "",
      attachments_json: attachments ? attachments : null,
      created_at: new Date().toISOString(),
    });

    const [[threadRow]] = await pool.execute(
      "SELECT title FROM chat_threads WHERE id = ? LIMIT 1",
      [threadId]
    );
    const threadTitle = String(threadRow?.title || "").trim() || "Chat";
    const [[senderRow]] = await pool.execute(
      "SELECT TRIM(CONCAT_WS(' ', first_name, last_name)) AS full_name, email FROM users WHERE id = ? LIMIT 1",
      [meId]
    );
    const senderLabel =
      String(senderRow?.full_name || "").trim() ||
      String(senderRow?.email || "").trim() ||
      "Someone";
    const previewRaw = body || (attachments ? "[attachment]" : "");
    const preview =
      previewRaw.length > 160 ? `${previewRaw.slice(0, 159)}…` : previewRaw;

    for (const uid of memberIds) {
      if (Number(uid) === Number(meId)) continue;
      await createUserNotification({
        userId: uid,
        actorUserId: meId,
        entityType: "chat",
        entityId: threadId,
        title: `New message from ${senderLabel}`,
        body: preview ? `${threadTitle}: ${preview}` : threadTitle,
      }).catch((e) => console.warn("chat notification:", e.message));
    }

    res.json({ success: true, data: { id: messageId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markThreadRead(req, res) {
  try {
    const meId = getMeId(req);
    if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const threadId = Number(req.params.id);
    const messageId = Number(req.body?.message_id || 0);
    if (!threadId || !messageId) {
      return res.status(400).json({ success: false, message: "thread id and message_id required" });
    }

    const [[memb]] = await pool.execute(
      "SELECT user_id, last_read_message_id FROM chat_thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1",
      [threadId, meId]
    );
    if (!memb) return res.status(403).json({ success: false, message: "Forbidden" });

    const next = Math.max(Number(memb.last_read_message_id || 0), messageId);
    await pool.execute(
      "UPDATE chat_thread_members SET last_read_message_id = ?, last_read_at = NOW() WHERE thread_id = ? AND user_id = ?",
      [next, threadId, meId]
    );

    emitChatThreadChanged([meId], { reason: "read", threadId, messageId: next });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteThread(req, res) {
  const meId = getMeId(req);
  if (!meId) return res.status(401).json({ success: false, message: "Unauthorized" });

  const threadId = Number(req.params.id);
  if (!threadId) return res.status(400).json({ success: false, message: "Invalid thread id" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[thread]] = await conn.execute(
      "SELECT id, thread_type, created_by FROM chat_threads WHERE id = ? LIMIT 1",
      [threadId]
    );
    if (!thread) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "Thread not found" });
    }

    const [[member]] = await conn.execute(
      "SELECT user_id FROM chat_thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1",
      [threadId, meId]
    );
    if (!member) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (thread.thread_type === "group" && Number(thread.created_by || 0) !== Number(meId)) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: "Only group creator can delete this group" });
    }

    const [members] = await conn.execute(
      "SELECT user_id FROM chat_thread_members WHERE thread_id = ?",
      [threadId]
    );
    const memberIds = members.map((r) => Number(r.user_id)).filter(Boolean);

    await conn.execute("DELETE FROM chat_threads WHERE id = ?", [threadId]);
    await conn.commit();

    emitChatThreadChanged(memberIds, { reason: "deleted", threadId });
    return res.json({ success: true, data: { id: threadId } });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
}

async function getChatRetentionStatus(_req, res) {
  try {
    const [[tot]] = await pool.execute(
      "SELECT COUNT(*) AS c FROM chat_thread_messages"
    );
    const [[within60]] = await pool.execute(
      "SELECT COUNT(*) AS c FROM chat_thread_messages WHERE created_at >= (NOW() - INTERVAL 60 DAY)"
    );
    const [[older60]] = await pool.execute(
      "SELECT COUNT(*) AS c FROM chat_thread_messages WHERE created_at < (NOW() - INTERVAL 60 DAY)"
    );
    const [[withMedia]] = await pool.execute(
      "SELECT COUNT(*) AS c FROM chat_thread_messages WHERE attachments_json IS NOT NULL"
    );
    const [[oldMedia]] = await pool.execute(
      "SELECT COUNT(*) AS c FROM chat_thread_messages WHERE attachments_json IS NOT NULL AND created_at < (NOW() - INTERVAL 15 DAY)"
    );

    return res.json({
      success: true,
      data: {
        retention: { message_days: 60, media_days: 15 },
        counts: {
          total: Number(tot.c || 0),
          within_60_days: Number(within60.c || 0),
          older_than_60_days: Number(older60.c || 0),
          with_media: Number(withMedia.c || 0),
          old_media_pending_strip: Number(oldMedia.c || 0),
        },
        server_now: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listChatUsers,
  listThreads,
  getThreadDetails,
  createThread,
  listMessages,
  sendMessageToThread,
  markThreadRead,
  deleteThread,
  getChatRetentionStatus,
};