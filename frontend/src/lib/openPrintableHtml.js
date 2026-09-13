import { getAccessToken, getApiBase } from "@/lib/api";

export function openBlankTab() {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("Pop-up blocked. Allow pop-ups to open PDF, files, or WhatsApp.");
  }
  try {
    win.opener = null;
  } catch {
    /* ignore */
  }
  return win;
}

function closeTab(win) {
  try {
    if (win && !win.closed) win.close();
  } catch {
    /* ignore */
  }
}

export function writeHtmlToTab(win, html) {
  if (!win || win.closed) {
    throw new Error("Pop-up blocked. Allow pop-ups to view PDF.");
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  try {
    win.focus();
  } catch {
    /* ignore */
  }
}

async function fetchAuthed(path) {
  const token = getAccessToken();
  return fetch(`${getApiBase()}${path}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function openHtmlFromApi(path) {
  const win = openBlankTab();
  try {
    const res = await fetchAuthed(path);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      closeTab(win);
      throw new Error(json.message || "PDF failed");
    }
    const html = await res.text();
    writeHtmlToTab(win, html);
  } catch (err) {
    closeTab(win);
    throw err;
  }
}

export async function openFileFromApi(path) {
  const win = openBlankTab();
  try {
    const res = await fetchAuthed(path);
    if (!res.ok) {
      closeTab(win);
      throw new Error("Could not open file");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    win.location = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    closeTab(win);
    throw err;
  }
}

export async function openJsonUrlFromApi(path, urlKey = "wa_url") {
  const win = openBlankTab();
  try {
    const res = await fetchAuthed(path);
    const json = await res.json().catch(() => ({}));
    const href = json?.[urlKey];
    if (!res.ok || !href) {
      closeTab(win);
      throw new Error(json.message || "Could not open WhatsApp");
    }
    win.location = href;
  } catch (err) {
    closeTab(win);
    throw err;
  }
}
