"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getChatSocket, subscribeChatEvents } from "@/lib/chatRealtime";
import styles from "./chatPage.module.css";

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function initials(first, last) {
  const a = (first || "").trim()[0] || "";
  const b = (last || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}

export default function ChatPage() {
  useAuth();
  const [loadError, setLoadError] = useState("");
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [msgError, setMsgError] = useState(null);
  const [meDbId, setMeDbId] = useState(null);
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [typing, setTyping] = useState({});
  const [users, setUsers] = useState([]);
  const [activeDetails, setActiveDetails] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newKind, setNewKind] = useState("direct");
  const [groupTitle, setGroupTitle] = useState("New group");
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const refreshTimer = useRef(null);

  const activeThread = useMemo(
    () => threads.find((t) => Number(t.id) === Number(activeId)) || null,
    [threads, activeId]
  );

  const dedupeThreads = useCallback((list) => {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      const id = Number(item?.id || 0);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
    return out;
  }, []);

  const updateThreadPreview = useCallback((prev, threadId, message, opts = {}) => {
    const tid = Number(threadId || 0);
    if (!tid) return prev;
    const idx = prev.findIndex((t) => Number(t.id) === tid);
    if (idx < 0) return prev;
    const row = prev[idx];
    const senderId = Number(message?.sender_id || 0);
    const mine = senderId && Number(meDbId || 0) === senderId;
    const unread = opts.markRead
      ? 0
      : (Number(row.unread_count || 0) + (mine ? 0 : (opts.bumpUnread ? 1 : 0)));
    const nextRow = {
      ...row,
      last_message_body: message?.body ?? row.last_message_body,
      last_message_at: message?.created_at ?? row.last_message_at,
      last_message_id: Number(message?.id || row.last_message_id || 0),
      unread_count: Math.max(0, unread),
    };
    const copy = [...prev];
    copy.splice(idx, 1);
    return [nextRow, ...copy];
  }, [meDbId]);

  const fetchThreads = useCallback(async () => {
    try {
      const r = await apiFetch("/v2/chat-threads");
      const j = await r.json();
      if (j?.success) {
        setThreads(dedupeThreads(j.data || []));
        setLoadError("");
      } else {
        setLoadError(j?.message || "Failed to load chats");
      }
    } catch (err) {
      console.error("fetchThreads error:", err);
      setLoadError("Failed to load chats");
    }
  }, [dedupeThreads]);

  const queueThreadRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void fetchThreads();
    }, 220);
  }, [fetchThreads]);

  const fetchUsers = useCallback(async () => {
    try {
      const r = await apiFetch("/v2/chat-users");
      const j = await r.json();
      if (j?.success) {
        setUsers(j.data || []);
        setLoadError("");
      } else {
        setLoadError(j?.message || "Failed to load chat users");
      }
    } catch (err) {
      console.error("fetchUsers error:", err);
      setLoadError("Failed to load chat users");
    }
  }, []);

  const ensureMeDbId = useCallback(async () => {
    try {
      const r = await apiFetch("/users/me");
      const j = await r.json();
      if (j?.success) {
        setMeDbId(j.data?.id || null);
        setLoadError("");
      } else {
        setLoadError(j?.message || "Failed to load profile");
      }
    } catch (err) {
      console.error("ensureMeDbId error:", err);
      setLoadError("Failed to load profile");
    }
  }, []);

  const fetchMessages = useCallback(async (threadId) => {
    setLoadingMessages(true);
    setMsgError(null);
    try {
      const r = await apiFetch(`/v2/chat-threads/${threadId}/messages?limit=80`);

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        let errMsg = `Failed to load messages (${r.status})`;
        try {
          const j = JSON.parse(text);
          if (j?.message) errMsg = j.message;
        } catch (parseErr) {
          console.warn("message parse failed", parseErr);
        }
        errMsg = `${errMsg} [${r.url}]`;
        setMsgError(errMsg);
        console.error("fetchMessages API error:", r.status, text);
        return;
      }

      const j = await r.json();
      if (j?.success) {
        setMessages(j.data || []);
        setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), 50);
        const last = (j.data || []).at(-1);
        if (last?.id) {
          void apiFetch(`/v2/chat-threads/${threadId}/read`, {
            method: "POST",
            body: JSON.stringify({ message_id: last.id }),
          }).catch((err) => console.error("markRead error:", err));
        }
      } else {
        setMsgError(j?.message || "Failed to load messages");
      }
    } catch (err) {
      console.error("fetchMessages error:", err);
      setMsgError("Network error. Check your connection.");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const fetchThreadDetails = useCallback(async (threadId) => {
    try {
      const r = await apiFetch(`/v2/chat-threads/${threadId}`);
      const j = await r.json();
      if (j?.success) setActiveDetails(j.data || null);
    } catch (err) {
      console.error("fetchThreadDetails error:", err);
    }
  }, []);

  useEffect(() => {
    void ensureMeDbId();
    void fetchThreads();
    void fetchUsers();
  }, [ensureMeDbId, fetchThreads, fetchUsers]);

  useEffect(() => {
    if (!activeId) return;
    setMessages([]);
    setMsgError(null);
    void fetchMessages(activeId);
    void fetchThreadDetails(activeId);
    (async () => {
      try {
        const s = await getChatSocket();
        s?.emit("chat:join", { threadId: activeId });
      } catch (err) {
        console.warn("chat:join failed", err);
      }
    })();
    return () => {
      (async () => {
        try {
          const s = await getChatSocket();
          s?.emit("chat:leave", { threadId: activeId });
        } catch (err) {
          console.warn("chat:leave failed", err);
        }
      })();
    };
  }, [activeId, fetchMessages, fetchThreadDetails]);

  useEffect(() => {
    const unsub = subscribeChatEvents((type, payload) => {
      if (type === "threads") {
        const reason = payload?.reason;
        const tid = Number(payload?.threadId || 0);
        if (reason === "deleted" && tid) {
          setThreads((prev) => prev.filter((t) => Number(t.id) !== tid));
          if (Number(activeId) === tid) {
            setActiveId(null);
            setMessages([]);
            setActiveDetails(null);
          }
          return;
        }
        queueThreadRefresh();
      }
      if (type === "message") {
        const tid = Number(payload?.threadId);
        const msg = payload?.message;
        if (!tid || !msg?.id) return;
        setThreads((prev) =>
          updateThreadPreview(prev, tid, msg, {
            bumpUnread: Number(activeId) !== tid,
            markRead: Number(activeId) === tid,
          })
        );
        if (Number(activeId) !== tid) {
          return;
        }
        if (Number(msg.sender_id || 0) === Number(meDbId || 0)) return;
        setMessages((prev) => {
          if (prev.some((m) => Number(m.id) === Number(msg.id))) return prev;
          const next = [...prev, msg];
          setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 20);
          return next;
        });
        queueThreadRefresh();
        void apiFetch(`/v2/chat-threads/${tid}/read`, {
          method: "POST",
          body: JSON.stringify({ message_id: msg.id }),
        }).catch((err) => console.error("markRead error:", err));
      }
      if (type === "typing") {
        const tid = Number(payload?.threadId);
        if (Number(activeId) !== tid) return;
        const uid = Number(payload?.userId);
        if (!uid) return;
        setTyping((prev) => ({ ...prev, [uid]: !!payload?.isTyping }));
        setTimeout(() => {
          setTyping((prev) => ({ ...prev, [uid]: false }));
        }, 2500);
      }
    });
    return unsub;
  }, [activeId, meDbId, queueThreadRefresh, updateThreadPreview]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = dedupeThreads(threads);
    if (!q) return source;
    return source.filter((t) => {
      const name =
        t.thread_type === "group"
          ? String(t.title || "")
          : [t.direct_other_first_name, t.direct_other_last_name].filter(Boolean).join(" ");
      const prev = String(t.last_message_body || "");
      return `${name} ${prev}`.toLowerCase().includes(q);
    });
  }, [threads, search, dedupeThreads]);

  const typingLabel = useMemo(() => {
    const ids = Object.entries(typing)
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
      .filter(Boolean);
    if (ids.length === 0) return "";
    const u = users.find((x) => Number(x.id) === ids[0]);
    const n = u ? [u.first_name, u.last_name].filter(Boolean).join(" ") : "Someone";
    return `${n} is typing...`;
  }, [typing, users]);

  async function onSend() {
    if (!activeId) return;
    const text = composer.trim();
    if (!text) return;
    setComposer("");
    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      thread_id: activeId,
      sender_id: meDbId,
      body: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 20);
    setThreads((prev) => updateThreadPreview(prev, activeId, optimistic, { markRead: true }));

    try {
      const resp = await apiFetch(`/v2/chat-threads/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      const json = await resp.json();
      if (!json?.success) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return;
      }
      if (json?.data?.id) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: json.data.id } : m)));
      }
    } catch (err) {
      console.error("onSend error:", err);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  }

  async function createNewThread() {
    try {
      if (newKind === "direct") {
        const other = selectedUserIds[0];
        if (!other) return;
        const r = await apiFetch("/v2/chat-threads", {
          method: "POST",
          body: JSON.stringify({ thread_type: "direct", other_user_id: other }),
        });
        const j = await r.json();
        if (j?.success) {
          setModalOpen(false);
          setSelectedUserIds([]);
          await fetchThreads();
          setActiveId(j.data?.id || null);
        }
        return;
      }
      const ids = selectedUserIds.slice(0, 50);
      if (ids.length === 0) return;
      const r = await apiFetch("/v2/chat-threads", {
        method: "POST",
        body: JSON.stringify({ thread_type: "group", title: groupTitle, member_ids: ids }),
      });
      const j = await r.json();
      if (j?.success) {
        setModalOpen(false);
        setSelectedUserIds([]);
        await fetchThreads();
        setActiveId(j.data?.id || null);
      }
    } catch (err) {
      console.error("createNewThread error:", err);
    }
  }

  async function emitTyping(isTyping) {
    if (!activeId) return;
    try {
      const s = await getChatSocket();
      s?.emit("chat:typing", { threadId: activeId, isTyping });
    } catch (err) {
      console.warn("emitTyping failed", err);
    }
  }

  async function onDeleteActiveThread() {
    if (!activeThread?.can_delete) return;
    const isGroup = activeThread.thread_type === "group";
    const ok = window.confirm(
      isGroup
        ? "Delete this group for all members? This cannot be undone."
        : "Delete this direct chat? This cannot be undone."
    );
    if (!ok) return;

    const tid = Number(activeThread.id);
    try {
      const r = await apiFetch(`/v2/chat-threads/${tid}`, { method: "DELETE" });
      const j = await r.json();
      if (!j?.success) return;
      setThreads((prev) => prev.filter((t) => Number(t.id) !== tid));
      setActiveId(null);
      setMessages([]);
      setActiveDetails(null);
    } catch (err) {
      console.error("deleteThread error:", err);
    }
  }

  return (
    <div className={styles.wrap}>
      <aside className={styles.left}>
        {loadError ? (
          <div className={styles.globalError}>
            <span>{loadError}</span>
            <button
              className={styles.emptyBtn}
              onClick={() => {
                void fetchThreads();
                void fetchUsers();
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
        <div className={styles.leftTop}>
          <div className={styles.pill}><i className="fas fa-comments" /></div>
          <div className={styles.title}>Chat</div>
          <div className={styles.actions}>
            <button className={styles.iconBtn} onClick={() => setModalOpen(true)} title="New chat / group" aria-label="New chat">
              <i className="fas fa-plus" />
            </button>
            <button className={styles.iconBtn} onClick={() => void fetchThreads()} title="Refresh" aria-label="Refresh">
              <i className="fas fa-rotate" />
            </button>
          </div>
        </div>

        <div className={styles.searchRow}>
          <input
            className={styles.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or start a new chat"
          />
        </div>

        <div className={styles.threads}>
          {filteredThreads.map((t) => {
            const isGroup = t.thread_type === "group";
            const name = isGroup
              ? (t.title || "Group")
              : [t.direct_other_first_name, t.direct_other_last_name].filter(Boolean).join(" ") || "User";
            const prev = t.last_message_body || "";
            const groupMeta = `${Number(t.participant_count || 0)} members${t.participant_preview ? ` • ${t.participant_preview}` : ""}`;
            const unread = Number(t.unread_count || 0);
            return (
              <div
                key={t.id}
                className={[styles.thread, Number(activeId) === Number(t.id) ? styles.threadActive : ""].filter(Boolean).join(" ")}
                onClick={() => setActiveId(Number(t.id))}
              >
                <div className={styles.avatar}>
                  {isGroup ? <i className="fas fa-users" /> : initials(t.direct_other_first_name, t.direct_other_last_name)}
                </div>
                <div className={styles.meta}>
                  <div className={styles.nameRow}>
                    <div className={styles.name}>{name}</div>
                    {unread > 0 && <div className={styles.badge}>{unread}</div>}
                  </div>
                  <div className={styles.preview}>
                    {prev || (isGroup ? groupMeta : (t.last_message_id ? "" : "No messages yet"))}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredThreads.length === 0 && (
            <div style={{ padding: 14, opacity: 0.7, fontSize: 13 }}>No chats found</div>
          )}
        </div>
      </aside>

      <section className={styles.right}>
        <div className={styles.notice}>
          Messages older than 60 days are deleted, Media after 15 days not be available
        </div>

        {activeThread ? (
          <>
            <div className={styles.convTop}>
              <div className={styles.pill}>
                <i className={activeThread.thread_type === "group" ? "fas fa-users" : "fas fa-user"} />
              </div>
              <div>
                <div className={styles.convTitle}>
                  {activeThread.thread_type === "group"
                    ? (activeThread.title || "Group")
                    : [activeThread.direct_other_first_name, activeThread.direct_other_last_name].filter(Boolean).join(" ") || "Chat"}
                </div>
                <div className={styles.convSub}>{typingLabel || " "}</div>
                {activeThread.thread_type === "group" && (
                  <div className={styles.convSub}>
                    {(activeDetails?.members || [])
                      .map((m) => [m.first_name, m.last_name].filter(Boolean).join(" ") || "User")
                      .join(", ")}
                  </div>
                )}
              </div>
              {activeThread?.can_delete && (
                <div style={{ marginLeft: "auto" }}>
                  <button
                    className={styles.iconBtn}
                    onClick={onDeleteActiveThread}
                    title={activeThread.thread_type === "group" ? "Delete group" : "Delete chat"}
                    aria-label="Delete chat"
                  >
                    <i className="fas fa-trash" />
                  </button>
                </div>
              )}
            </div>

            <div className={styles.messages} ref={listRef}>
              {loadingMessages && (
                <div className={styles.empty}>
                  <div style={{ opacity: 0.6, fontSize: 13 }}>Loading messages...</div>
                </div>
              )}

              {!loadingMessages && msgError && (
                <div className={styles.empty}>
                  <div className={styles.emptyCard}>
                    <div className={styles.emptyIcon}>
                      <i className="fas fa-triangle-exclamation" style={{ fontSize: 28, color: "#ef4444" }} />
                    </div>
                    <div style={{ fontWeight: 700, color: "#ef4444" }}>Failed to load messages</div>
                    <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>{msgError}</div>
                    <button className={styles.emptyBtn} onClick={() => void fetchMessages(activeId)}>
                      Retry
                    </button>
                  </div>
                </div>
              )}

              {!loadingMessages && !msgError && messages.length === 0 && (
                <div className={styles.empty}>
                  <div className={styles.emptyCard}>
                    <div className={styles.emptyIcon}><i className="far fa-comment" style={{ fontSize: 28 }} /></div>
                    <div style={{ fontWeight: 700 }}>No messages yet</div>
                    <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>Say something to start the conversation.</div>
                  </div>
                </div>
              )}

              {!loadingMessages && !msgError && messages.map((m) => {
                const mine = Number(m.sender_id) === Number(meDbId);
                return (
                  <div key={m.id} className={[styles.msgRow, mine ? styles.msgMe : ""].join(" ")}>
                    <div className={[styles.bubble, mine ? styles.bubbleMe : ""].join(" ")}>
                      <div className={styles.msgText}>{m.body}</div>
                      <div className={styles.msgMeta}>{fmtTime(m.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.composer}>
              <textarea
                className={styles.input}
                rows={1}
                value={composer}
                onChange={(e) => {
                  setComposer(e.target.value);
                  if (typingTimer.current) clearTimeout(typingTimer.current);
                  void emitTyping(true);
                  typingTimer.current = setTimeout(() => void emitTyping(false), 900);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void emitTyping(false);
                    void onSend();
                  }
                }}
                placeholder="Type a message"
              />
              <button className={styles.sendBtn} onClick={onSend} disabled={!composer.trim()} aria-label="Send">
                <i className="fas fa-paper-plane" />
              </button>
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyCard}>
              <div className={styles.emptyIcon}><i className="far fa-comment" style={{ fontSize: 28 }} /></div>
              <div style={{ fontWeight: 800, color: "rgba(30,41,59,1)" }}>Start Conversation</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
                Select a chat on the left or create a new one.
              </div>
              <button className={styles.emptyBtn} onClick={() => setModalOpen(true)}>
                New chat / group
              </button>
            </div>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTop}>
              <div className={styles.modalTitle}>Create new</div>
              <button className={styles.modalClose} onClick={() => setModalOpen(false)} aria-label="Close">
                <i className="fas fa-xmark" />
              </button>
            </div>

            <div className={styles.modalGrid}>
              <div className={styles.field}>
                <div className={styles.label}>Type</div>
                <select className={styles.text} value={newKind} onChange={(e) => {
                  setNewKind(e.target.value);
                  setSelectedUserIds([]);
                }}>
                  <option value="direct">Direct message</option>
                  <option value="group">Group</option>
                </select>
              </div>

              {newKind === "group" ? (
                <div className={styles.field}>
                  <div className={styles.label}>Group title</div>
                  <input className={styles.text} value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} />
                </div>
              ) : (
                <div className={styles.field}>
                  <div className={styles.label}>Pick 1 user</div>
                  <input className={styles.text} value=" " readOnly />
                </div>
              )}

              <div className={styles.usersList}>
                {users.map((u) => {
                  const sel = selectedUserIds.includes(u.id);
                  const canSelect = newKind === "group" || selectedUserIds.length === 0 || sel;
                  return (
                    <div
                      key={u.id}
                      className={[styles.userRow, sel ? styles.userRowSelected : ""].join(" ")}
                      style={{ opacity: canSelect ? 1 : 0.5 }}
                      onClick={() => {
                        if (!canSelect) return;
                        setSelectedUserIds((prev) => {
                          if (newKind === "direct") {
                            return prev.includes(u.id) ? [] : [u.id];
                          }
                          return prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id];
                        });
                      }}
                    >
                      <div className={styles.avatar}>{initials(u.first_name, u.last_name)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className={styles.userName}>
                          {[u.first_name, u.last_name].filter(Boolean).join(" ") || "User"}
                        </div>
                        <div className={styles.userEmail}>{u.email}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={() => setModalOpen(false)}>Cancel</button>
              <button
                className={[styles.btn, styles.btnPrimary].join(" ")}
                onClick={createNewThread}
                disabled={selectedUserIds.length === 0 || (newKind === "direct" && selectedUserIds.length !== 1)}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}