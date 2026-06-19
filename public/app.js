const state = {
  sessions: [],
  folders: [],
  selectedFolder: "",
  query: "",
  selectedId: null,
  deleteMode: "archive",
  sessionDetails: {},
  detailLoading: {},
  promptIndexBySession: {},
  pendingDelete: null,
};

const elements = {
  search: document.querySelector("#searchInput"),
  rows: document.querySelector("#sessionRows"),
  status: document.querySelector("#statusText"),
  mainTitle: document.querySelector("#mainTitle"),
  subtitle: document.querySelector("#subtitle"),
  folderList: document.querySelector("#folderList"),
  visibleCount: document.querySelector("#visibleCount"),
  folderCount: document.querySelector("#folderCount"),
  detail: document.querySelector("#detailPanel"),
  refresh: document.querySelector("#refreshButton"),
  modal: document.querySelector("#confirmModal"),
  chatModal: document.querySelector("#chatModal"),
  chatTitle: document.querySelector("#chatTitle"),
  chatMeta: document.querySelector("#chatMeta"),
  chatTranscript: document.querySelector("#chatTranscript"),
  closeChat: document.querySelector("#closeChat"),
  confirmText: document.querySelector("#confirmText"),
  cancelDelete: document.querySelector("#cancelDelete"),
  confirmDelete: document.querySelector("#confirmDelete"),
};

const icons = {
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 0 1-9 9 8.7 8.7 0 0 1-6.1-2.5"/><path d="M3 12a9 9 0 0 1 15.1-6.6"/><path d="M3 19v-5h5"/><path d="M21 5v5h-5"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m7 8 4 4-4 4"/><path d="M13 16h4"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icons[node.dataset.icon] || "";
  });
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function promptsForSession(session) {
  if (Array.isArray(session.userMessages) && session.userMessages.length > 0) {
    return session.userMessages;
  }
  return [session.lastUserMessage || session.firstUserMessage || "-"];
}

function responsesForSession(session) {
  if (Array.isArray(session.aiResponses) && session.aiResponses.length > 0) {
    return session.aiResponses;
  }
  return [];
}

function sessionById(id) {
  return state.sessionDetails[id] || state.sessions.find((item) => item.id === id);
}

function selectedSession() {
  return state.selectedId ? sessionById(state.selectedId) : null;
}

function promptIndexForSession(session) {
  const prompts = promptsForSession(session);
  const stored = state.promptIndexBySession[session.id];
  if (Number.isInteger(stored) && stored >= 0 && stored < prompts.length) {
    return stored;
  }
  return Math.max(prompts.length - 1, 0);
}

function setPromptIndex(sessionId, index) {
  state.promptIndexBySession[sessionId] = index;
  renderDetail();
  renderIcons();
}

function setStatus(text) {
  elements.status.textContent = text;
}

async function loadSessionDetail(id) {
  if (!id || state.sessionDetails[id] || state.detailLoading[id]) {
    return;
  }
  state.detailLoading[id] = true;

  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load session detail");
    }
    state.sessionDetails[id] = payload;
  } catch (error) {
    state.sessionDetails[id] = {
      ...(state.sessions.find((item) => item.id === id) || { id }),
      aiResponses: [`Failed to load AI response: ${error.message}`],
    };
  } finally {
    state.detailLoading[id] = false;
    if (state.selectedId === id) {
      renderRows();
      renderDetail();
      renderIcons();
    }
  }
}

async function loadSessions() {
  setStatus("Loading");
  const params = new URLSearchParams({ query: state.query });
  if (state.selectedFolder) {
    params.set("folder", state.selectedFolder);
  }
  const response = await fetch(`/api/sessions?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load sessions");
  }

  state.sessions = payload.sessions;
  state.folders = payload.folders;
  state.deleteMode = payload.deleteMode || "archive";
  if (!state.selectedId || !state.sessions.some((session) => session.id === state.selectedId)) {
    state.selectedId = state.sessions[0]?.id || null;
  }

  elements.visibleCount.textContent = String(payload.total);
  elements.folderCount.textContent = String(payload.folders.length);
  elements.mainTitle.textContent = titleForFolder();
  elements.subtitle.textContent = subtitleForFolder();
  render();
  loadSessionDetail(state.selectedId);
  setStatus("Ready");
}

function titleForFolder() {
  if (!state.selectedFolder) {
    return "All sessions";
  }
  const folder = state.folders.find((item) => item.path === state.selectedFolder);
  return folder?.label || "Selected folder";
}

function subtitleForFolder() {
  if (!state.selectedFolder) {
    return "Browse every local AI session, then narrow by folder or search.";
  }
  const folder = state.folders.find((item) => item.path === state.selectedFolder);
  return folder ? `${folder.count} sessions in this folder.` : "Sessions in selected folder.";
}

function render() {
  renderFolders();
  renderRows();
  renderDetail();
  renderIcons();
}

function renderFolders() {
  const allActive = state.selectedFolder ? "" : " active";
  const allCount = state.folders.reduce((sum, folder) => sum + folder.count, 0);
  const folderButtons = state.folders.map((folder) => {
    const active = folder.path === state.selectedFolder ? " active" : "";
    return `
      <button class="folder-item${active}" type="button" data-folder="${escapeHtml(folder.path)}" title="${escapeHtml(folder.path || folder.label)}">
        <span class="folder-name">
          <span class="icon" data-icon="folder"></span>
          <strong>${escapeHtml(folder.label)}</strong>
        </span>
        <span class="folder-count">${escapeHtml(String(folder.count))}</span>
      </button>
    `;
  }).join("");

  elements.folderList.innerHTML = `
    <button class="folder-item${allActive}" type="button" data-folder="">
      <span class="folder-name">
        <span class="icon" data-icon="folder"></span>
        <strong>All sessions</strong>
      </span>
      <span class="folder-count">${escapeHtml(String(allCount))}</span>
    </button>
    ${folderButtons}
  `;
}

function renderRows() {
  if (state.sessions.length === 0) {
    elements.rows.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon icon" data-icon="terminal"></span>
        <h2>No sessions</h2>
        <p>No AI sessions match the current filter.</p>
      </div>
    `;
    return;
  }

  elements.rows.innerHTML = state.sessions.map((session) => {
    const rowSession = sessionById(session.id);
    const isActive = rowSession.id === state.selectedId ? " active" : "";
    const prompt = rowSession.lastUserMessage || rowSession.firstUserMessage || rowSession.cwd || rowSession.id;
    const shortId = rowSession.id.slice(0, 8);
    return `
      <div class="session-row${isActive}" role="button" tabindex="0" data-select="${escapeHtml(rowSession.id)}">
        <span class="row-icon icon" data-icon="file"></span>
        <span class="title-stack">
          <strong>${escapeHtml(rowSession.title)}</strong>
          <span>${escapeHtml(prompt)}</span>
        </span>
        <span class="date-cell"><span class="icon inline-icon" data-icon="clock"></span>${escapeHtml(formatDate(rowSession.updatedAt))}</span>
        <span class="count-cell">${escapeHtml(String(rowSession.userMessageCount))} prompts</span>
        <span class="id-cell">${escapeHtml(shortId)}</span>
        <span class="row-actions">
          <button class="icon-button row-open" type="button" title="Open chat preview" data-chat="${escapeHtml(rowSession.id)}">
            <span class="icon" data-icon="expand"></span>
          </button>
          <button class="icon-button row-delete" type="button" title="Delete session" data-delete="${escapeHtml(rowSession.id)}">
            <span class="icon" data-icon="trash"></span>
          </button>
        </span>
      </div>
    `;
  }).join("");
}

function renderDetail() {
  const session = selectedSession();
  if (!session) {
    elements.detail.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon icon" data-icon="terminal"></span>
        <h2>Select a session</h2>
        <p>Choose a row to inspect its path, prompt preview, file size, and delete action.</p>
      </div>
    `;
    return;
  }

  const prompts = promptsForSession(session);
  const responses = responsesForSession(session);
  const promptIndex = promptIndexForSession(session);
  const activePrompt = prompts[promptIndex] || "-";
  const hasDetail = Boolean(state.sessionDetails[session.id]);
  const activeResponse = hasDetail
    ? responses[promptIndex] || "No AI response preview found for this prompt."
    : "Loading AI response...";
  const canGoPrevious = promptIndex > 0;
  const canGoNext = promptIndex < prompts.length - 1;

  elements.detail.innerHTML = `
    <div class="detail-header">
      <span class="label">Session inspector</span>
      <h2 class="detail-title">${escapeHtml(session.title)}</h2>
      <p class="detail-muted">${escapeHtml(session.id.slice(0, 8))} · ${escapeHtml(formatDate(session.updatedAt))}</p>
    </div>
    <div class="detail-actions">
      <button class="button danger detail-delete" type="button" data-delete="${escapeHtml(session.id)}">
        <span class="icon" data-icon="trash"></span>
        Delete
      </button>
    </div>
    <div class="metric-grid">
      <div><span>Prompts</span><strong>${escapeHtml(String(session.userMessageCount))}</strong></div>
      <div><span>Size</span><strong>${escapeHtml(formatSize(session.fileSize))}</strong></div>
      <div><span>Model</span><strong>${escapeHtml(session.modelProvider || "-")}</strong></div>
      <div><span>CLI</span><strong>${escapeHtml(session.cliVersion || "-")}</strong></div>
    </div>
    <div class="detail-section prompt-section">
      <div class="prompt-toolbar">
        <span class="label">User prompt</span>
        <span id="promptCounter" class="prompt-counter">${escapeHtml(String(promptIndex + 1))} / ${escapeHtml(String(prompts.length))}</span>
      </div>
      <div class="prompt">${escapeHtml(activePrompt)}</div>
      <div class="prompt-toolbar">
        <span class="label">AI response</span>
      </div>
      <div class="response-preview">${escapeHtml(activeResponse)}</div>
      <div class="prompt-actions">
        <button class="button ghost compact" type="button" data-prompt-prev="${escapeHtml(session.id)}" ${canGoPrevious ? "" : "disabled"}>
          Previous
        </button>
        <button class="button ghost compact" type="button" data-prompt-next="${escapeHtml(session.id)}" ${canGoNext ? "" : "disabled"}>
          Next
        </button>
      </div>
    </div>
    <details class="path-details">
      <summary>Paths and timestamps</summary>
      <div class="detail-section path-section">
        <div class="kv"><span>Created</span><span>${escapeHtml(formatDate(session.createdAt))}</span></div>
        <div class="kv"><span>Updated</span><span>${escapeHtml(formatDate(session.updatedAt))}</span></div>
        <div class="kv"><span>Working dir</span><span>${escapeHtml(session.cwd || "-")}</span></div>
        <div class="kv"><span>Session file</span><span>${escapeHtml(session.filePath)}</span></div>
      </div>
    </details>
  `;

  loadSessionDetail(session.id);
}

function askDelete(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) {
    return;
  }
  state.pendingDelete = session;
  elements.confirmText.textContent = state.deleteMode === "hard"
    ? `Permanently delete "${session.title}" and remove it from session index/history? This cannot be recovered from session trash.`
    : `Archive "${session.title}" to session trash and remove it from session index/history?`;
  elements.modal.classList.remove("hidden");
  elements.confirmDelete.focus();
}

function renderChat(session) {
  if (!session) {
    elements.chatTitle.textContent = "Chat preview";
    elements.chatMeta.textContent = "";
    elements.chatTranscript.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon icon" data-icon="terminal"></span>
        <h2>Select a session</h2>
        <p>No session selected.</p>
      </div>
    `;
    return;
  }

  const prompts = promptsForSession(session);
  const responses = responsesForSession(session);
  const hasDetail = Boolean(state.sessionDetails[session.id]);
  elements.chatTitle.textContent = session.title;
  elements.chatMeta.textContent = `${session.id.slice(0, 8)} · ${formatDate(session.updatedAt)} · ${prompts.length} prompts`;

  if (!hasDetail) {
    elements.chatTranscript.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon icon" data-icon="terminal"></span>
        <h2>Loading chat</h2>
        <p>Reading session transcript.</p>
      </div>
    `;
    return;
  }

  elements.chatTranscript.innerHTML = prompts.map((prompt, index) => {
    const response = responses[index] || "No AI response preview found for this prompt.";
    return `
      <section class="chat-turn">
        <div class="chat-message user">
          <span class="chat-role">User</span>
          <div>${escapeHtml(prompt)}</div>
        </div>
        <div class="chat-message ai">
          <span class="chat-role">AI</span>
          <div>${escapeHtml(response)}</div>
        </div>
      </section>
    `;
  }).join("");
}

async function openChat(id) {
  const session = sessionById(id);
  if (!session) {
    return;
  }

  elements.chatModal.classList.remove("hidden");
  renderChat(session);
  renderIcons(elements.chatModal);
  elements.closeChat.focus();
  await loadSessionDetail(id);
  renderChat(sessionById(id));
  renderIcons(elements.chatModal);
}

function closeChat() {
  elements.chatModal.classList.add("hidden");
}

async function confirmDelete() {
  if (!state.pendingDelete) {
    return;
  }
  const id = state.pendingDelete.id;
  elements.confirmDelete.disabled = true;
  setStatus("Deleting");

  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Delete failed");
    }
    state.pendingDelete = null;
    elements.modal.classList.add("hidden");
    await loadSessions();
  } catch (error) {
    setStatus("Error");
    elements.confirmText.textContent = error.message;
  } finally {
    elements.confirmDelete.disabled = false;
  }
}

function debounce(fn, delay = 180) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

elements.search.addEventListener("input", debounce((event) => {
  state.query = event.target.value;
  loadSessions().catch((error) => {
    setStatus("Error");
    elements.rows.innerHTML = `<div class="empty-state"><h2>Load failed</h2><p>${escapeHtml(error.message)}</p></div>`;
  });
}));

document.addEventListener("click", (event) => {
  const chatTarget = event.target.closest("[data-chat]");
  if (chatTarget) {
    event.preventDefault();
    event.stopPropagation();
    openChat(chatTarget.dataset.chat);
    return;
  }

  const deleteTarget = event.target.closest("[data-delete]");
  if (deleteTarget) {
    event.preventDefault();
    event.stopPropagation();
    askDelete(deleteTarget.dataset.delete);
    return;
  }

  const previousPromptTarget = event.target.closest("[data-prompt-prev]");
  if (previousPromptTarget) {
    const session = sessionById(previousPromptTarget.dataset.promptPrev);
    if (session) {
      setPromptIndex(session.id, Math.max(promptIndexForSession(session) - 1, 0));
    }
    return;
  }

  const nextPromptTarget = event.target.closest("[data-prompt-next]");
  if (nextPromptTarget) {
    const session = sessionById(nextPromptTarget.dataset.promptNext);
    if (session) {
      const prompts = promptsForSession(session);
      setPromptIndex(session.id, Math.min(promptIndexForSession(session) + 1, prompts.length - 1));
    }
    return;
  }

  const selectTarget = event.target.closest("[data-select]");
  if (selectTarget) {
    state.selectedId = selectTarget.dataset.select;
    render();
    loadSessionDetail(state.selectedId);
    return;
  }

  const folderTarget = event.target.closest("[data-folder]");
  if (folderTarget) {
    state.selectedFolder = folderTarget.dataset.folder;
    state.selectedId = null;
    loadSessions().catch((error) => {
      setStatus("Error");
      elements.rows.innerHTML = `<div class="empty-state"><h2>Load failed</h2><p>${escapeHtml(error.message)}</p></div>`;
    });
  }
});

elements.closeChat.addEventListener("click", closeChat);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.chatModal.classList.contains("hidden")) {
    closeChat();
  }
});

elements.refresh.addEventListener("click", () => {
  loadSessions().catch((error) => {
    setStatus("Error");
    elements.rows.innerHTML = `<div class="empty-state"><h2>Load failed</h2><p>${escapeHtml(error.message)}</p></div>`;
  });
});

elements.cancelDelete.addEventListener("click", () => {
  state.pendingDelete = null;
  elements.modal.classList.add("hidden");
});

elements.confirmDelete.addEventListener("click", confirmDelete);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.modal.classList.contains("hidden")) {
    state.pendingDelete = null;
    elements.modal.classList.add("hidden");
  }

  const selectTarget = event.target.closest?.("[data-select]");
  if (selectTarget && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    state.selectedId = selectTarget.dataset.select;
    render();
  }
});

renderIcons();
loadSessions().catch((error) => {
  setStatus("Error");
  elements.rows.innerHTML = `<div class="empty-state"><h2>Load failed</h2><p>${escapeHtml(error.message)}</p></div>`;
});
