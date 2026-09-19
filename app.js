const state = {
  token: localStorage.getItem("nova_token") || "",
  user: JSON.parse(localStorage.getItem("nova_user") || "null"),
  authMode: "login",
  models: [],
  chats: [],
  activeChatId: null,
  pendingFiles: [],
  temperature: Number(localStorage.getItem("nova_temperature") || "0.7"),
  maxTokens: Number(localStorage.getItem("nova_max_tokens") || "4096"),
  page: "chat",
  googleEnabled: false,
  resetToken: new URLSearchParams(location.search).get("reset_token") || "",
  oauthCode: new URLSearchParams(location.search).get("oauth_code") || "",
  oauthError: new URLSearchParams(location.search).get("oauth_error") || "",
};

// Fallback catalog keeps the UI usable even when /v1/models is temporarily unavailable.
const FALLBACK_MODELS = [
  {id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "groq"},
  {id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", provider: "groq"},
  {id: "qwen/qwen3.6-27b", name: "Qwen 3.6 27B", provider: "groq"},
  {id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", provider: "groq"},
  {id: "deepseek/deepseek-chat", name: "DeepSeek Chat", provider: "openrouter"},
  {id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (Vision)", provider: "openrouter"},
];

const $ = (id) => document.getElementById(id);

function apiErrorMessage(data) {
  if (!data) return "Ошибка запроса";
  if (typeof data.detail === "string") return data.detail;
  try { return JSON.stringify(data.detail); } catch { return "Ошибка запроса"; }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetch(path, {...options, headers});
  } catch (networkError) {
    const error = new Error(
      "Nova AI не может соединиться с сервером. Проверь, что Uvicorn запущен на http://localhost:8000."
    );
    error.cause = networkError;
    error.network = true;
    throw error;
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    if (response.status === 401) {
      logout(false);
    }
    const error = new Error(apiErrorMessage(data));
    error.status = response.status;
    throw error;
  }

  return data;
}

function setToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(setToast.timer);
  setToast.timer = setTimeout(() => toast.classList.add("hidden"), 2300);
}

function saveAuth(payload) {
  state.token = payload.access_token;
  state.user = payload.user || null;
  localStorage.setItem("nova_token", state.token);
  localStorage.setItem("nova_user", JSON.stringify(state.user));
}

function logout(showToast = true) {
  state.token = "";
  state.user = null;
  state.chats = [];
  state.activeChatId = null;
  localStorage.removeItem("nova_token");
  localStorage.removeItem("nova_user");
  renderChats();
  renderMessages([]);
  $("chatTitle").textContent = "Новый чат";
  $("authModal").classList.remove("hidden");
  if (showToast) setToast("Вы вышли из аккаунта");
}

function authModal(open) {
  $("authModal").classList.toggle("hidden", !open);
  if (open) $("emailInput").focus();
}

async function authenticate() {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  $("authError").textContent = "";

  if (!email || !password) {
    $("authError").textContent = "Введите email и пароль.";
    return;
  }

  $("authSubmitBtn").disabled = true;
  $("authSubmitBtn").textContent = state.authMode === "login" ? "Входим..." : "Создаём...";

  try {
    const payload = await api(
      state.authMode === "login" ? "/v1/auth/login" : "/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify({email, password}),
      }
    );
    saveAuth(payload);
    authModal(false);
    await bootApp();
  } catch (error) {
    $("authError").textContent = error.message;
  } finally {
    $("authSubmitBtn").disabled = false;
    $("authSubmitBtn").textContent = state.authMode === "login" ? "Войти" : "Создать аккаунт";
  }
}

function renderModels() {
  const provider = $("providerSelect").value;
  const current = $("modelSelect").value;
  const filtered = state.models.filter(m => String(m.provider || "").toLowerCase() === provider.toLowerCase());
  $("modelSelect").innerHTML = filtered.map(m =>
    `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`
  ).join("");

  if (filtered.some(m => m.id === current)) $("modelSelect").value = current;
  else if (filtered[0]) $("modelSelect").value = filtered[0].id;

  const selected = filtered.find(m => m.id === $("modelSelect").value);
  $("modelCaption").textContent = selected ? `Используется: ${selected.id}` : "";
  $("keyStatus").textContent = provider === "groq"
    ? "Groq подключается на сервере"
    : "OpenRouter подключается на сервере";
}

async function loadModels() {
  try {
    const data = await api("/v1/models");
    state.models = Array.isArray(data?.models) && data.models.length
      ? data.models
      : FALLBACK_MODELS.slice();
  } catch (error) {
    state.models = FALLBACK_MODELS.slice();
    setToast("Каталог моделей сервера недоступен — включён локальный список Groq");
  }
  renderModels();
}

async function loadChats() {
  const data = await api("/v1/chats");
  state.chats = data.chats || [];
  renderChats();

  if (state.activeChatId && state.chats.some(c => c.id === state.activeChatId)) {
    await openChat(state.activeChatId);
    return;
  }

  if (state.chats.length) {
    await openChat(state.chats[0].id);
  } else {
    const newChat = await createChat();
    if (newChat) await openChat(newChat.id);
  }
}

function renderChats() {
  $("chatList").innerHTML = state.chats.map(chat => `
    <button class="chat-item ${chat.id === state.activeChatId ? "active" : ""}" data-id="${escapeHtml(chat.id)}">
      ${escapeHtml(chat.title || "Новый чат")}
    </button>
  `).join("");

  document.querySelectorAll(".chat-item").forEach(btn => {
    btn.addEventListener("click", async () => {
      await openChat(btn.dataset.id);
      closeSidebar();
    });
  });
}

async function createChat() {
  try {
    const data = await api("/v1/chats", {
      method: "POST",
      body: JSON.stringify({title: "Новый чат"}),
    });
    state.chats.unshift(data);
    state.activeChatId = data.id;
    renderChats();
    return data;
  } catch (error) {
    setToast(error.message);
    return null;
  }
}

async function openChat(chatId) {
  state.activeChatId = chatId;
  renderChats();

  try {
    const data = await api(`/v1/chats/${encodeURIComponent(chatId)}`);
    $("chatTitle").textContent = data.chat?.title || "Новый чат";
    renderMessages(data.messages || []);
  } catch (error) {
    setToast(error.message);
  }
}

async function deleteCurrentChat() {
  if (!state.activeChatId) return;
  if (!confirm("Удалить текущий чат?")) return;

  try {
    await api(`/v1/chats/${encodeURIComponent(state.activeChatId)}`, {method: "DELETE"});
    state.chats = state.chats.filter(c => c.id !== state.activeChatId);
    state.activeChatId = null;
    if (!state.chats.length) await createChat();
    const next = state.chats[0];
    await openChat(next.id);
  } catch (error) {
    setToast(error.message);
  }
}

async function clearCurrentChat() {
  if (!state.activeChatId) return;
  if (!confirm("Очистить историю текущего чата?")) return;

  // Backend has no dedicated clear endpoint; remove + recreate to keep the API stable.
  try {
    await api(`/v1/chats/${encodeURIComponent(state.activeChatId)}`, {method: "DELETE"});
    state.chats = state.chats.filter(c => c.id !== state.activeChatId);
    const fresh = await createChat();
    if (fresh) await openChat(fresh.id);
  } catch (error) {
    setToast(error.message);
  }
}

function getTypingPlan(text) {
  const length = String(text || "").length;
  const hasCode = /```/.test(text || "");

  // Natural-feeling simulated typing: code is intentionally slower.
  const charsPerSecond = hasCode ? 34 : 52;
  const duration = Math.min(
    9000,
    Math.max(900, (length / charsPerSecond) * 1000)
  );

  const tickMs = 24;
  const ticks = Math.max(1, Math.ceil(duration / tickMs));
  const step = Math.max(1, Math.ceil(length / ticks));

  return { tickMs, step };
}

function animateAssistantMessage(message, messageIndex) {
  const row = $("messages").querySelector(`[data-message-index="${messageIndex}"]`);
  if (!row) return;

  const target = row.querySelector(".typing-content");
  const indicator = row.querySelector(".typing-indicator");
  if (!target) return;

  const full = String(message.content || "");
  const { tickMs, step } = getTypingPlan(full);
  let position = 0;

  target.innerHTML = "";
  if (indicator) indicator.classList.remove("hidden");

  const timer = setInterval(() => {
    position = Math.min(full.length, position + step);
    target.innerHTML = renderMarkdown(full.slice(0, position));

    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "auto"
      });
    });

    if (position >= full.length) {
      clearInterval(timer);
      target.innerHTML = renderMarkdown(full);
      if (indicator) indicator.classList.add("hidden");
      target.classList.remove("typing-active");

      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth"
        });
      });
    }
  }, tickMs);
}

function renderMessages(messages, options = {}) {
  const box = $("messages");
  const shouldAnimate = Boolean(options.animateLastAssistant);
  const animatedIndex = messages.length - 1;

  $("welcome").classList.toggle("hidden", messages.length > 0);

  box.innerHTML = messages.map((m, i) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    const animateThis = shouldAnimate && i === animatedIndex && role === "assistant";
    const rendered = role === "assistant"
      ? (animateThis
        ? `
          <div class="typing-indicator">
            Nova печатает
            <span class="typing-dots"><i></i><i></i><i></i></span>
          </div>
          <div class="typing-content typing-active"></div>
        `
        : renderMarkdown(m.content || ""))
      : escapeHtml(m.content || "").replace(/\n/g, "<br>");

    return `
      <div class="message-row ${role}" data-message-index="${i}">
        <div class="message-bubble">
          ${rendered}
          ${role === "assistant" ? `
            <div class="message-tools">
              <button class="copy-btn" data-copy-index="${i}">Копировать</button>
            </div>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");

  box.querySelectorAll("[data-copy-index]").forEach(btn => {
    const index = Number(btn.dataset.copyIndex);
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(messages[index]?.content || "");
      setToast("Скопировано");
    });
  });

  window.requestAnimationFrame(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth"
    });
  });

  if (shouldAnimate && animatedIndex >= 0) {
    const animatedMessage = messages[animatedIndex];
    if (animatedMessage?.role === "assistant") {
      animateAssistantMessage(animatedMessage, animatedIndex);
    }
  }
}

function renderPendingFiles() {
  const strip = $("attachmentStrip");
  strip.innerHTML = state.pendingFiles.map((file, index) => `
    <div class="attachment-chip">
      <span>${escapeHtml(file.name)}</span>
      <button class="attachment-remove" data-remove="${index}">×</button>
    </div>
  `).join("");

  strip.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.pendingFiles.splice(Number(btn.dataset.remove), 1);
      renderPendingFiles();
    });
  });
}

async function uploadPendingFiles() {
  const ids = [];
  for (const file of state.pendingFiles) {
    const form = new FormData();
    form.append("file", file);
    const uploaded = await api("/v1/files/upload", {method: "POST", body: form});
    ids.push(uploaded.id);
  }
  return ids;
}

function resizeComposer() {
  const textarea = $("messageInput");
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
}

async function sendMessage() {
  const input = $("messageInput");
  const text = input.value.trim();

  if (!text && state.pendingFiles.length === 0) return;
  if (!state.activeChatId) {
    const fresh = await createChat();
    if (!fresh) return;
  }

  $("sendBtn").disabled = true;

  try {
    const fileIds = await uploadPendingFiles();
    const localText = text || "Проанализируй прикреплённый файл.";

    // Render optimistic user message immediately.
    const existing = await api(`/v1/chats/${encodeURIComponent(state.activeChatId)}`);
    const optimistic = [...(existing.messages || []), {
      role: "user",
      content: localText
    }];
    renderMessages(optimistic);

    input.value = "";
    state.pendingFiles = [];
    renderPendingFiles();
    resizeComposer();

    const selectedProvider = $("providerSelect").value || "groq";
    const selectedModel = $("modelSelect").value || "openai/gpt-oss-120b";

    const payload = await api(
      `/v1/chats/${encodeURIComponent(state.activeChatId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          message: localText,
          model: selectedModel,
          provider: selectedProvider,
          temperature: Number($("temperature").value),
          max_tokens: Number($("maxTokens").value),
          file_ids: fileIds,
        }),
      }
    );

    const refreshed = await api(`/v1/chats/${encodeURIComponent(state.activeChatId)}`);
    $("chatTitle").textContent = refreshed.chat?.title || "Новый чат";
    renderMessages(refreshed.messages || [], {animateLastAssistant: true});

    const index = state.chats.findIndex(c => c.id === state.activeChatId);
    if (index >= 0) {
      state.chats[index] = refreshed.chat;
      renderChats();
    }

    if (payload.warnings?.length) {
      setToast(payload.warnings[0]);
    }
  } catch (error) {
    setToast(error.message || "Не удалось отправить сообщение");
    console.error("Nova AI sendMessage error", error);
  } finally {
    $("sendBtn").disabled = false;
    input.focus();
  }
}

async function downloadMedia() {
  const url = $("mediaUrl").value.trim();
  if (!url) {
    $("mediaStatus").textContent = "Вставьте ссылку.";
    return;
  }

  $("mediaDownloadBtn").disabled = true;
  $("mediaStatus").textContent = "Загружаю...";

  try {
    const response = await fetch("/v1/media/download", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${state.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({url}),
    });

    if (!response.ok) {
      let detail = "Ошибка загрузки";
      try { detail = apiErrorMessage(await response.json()); } catch {}
      throw new Error(detail);
    }

    const blob = await response.blob();
    const filename = parseFilename(response.headers.get("Content-Disposition")) || "nova-media";
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    $("mediaStatus").textContent = `Готово: ${filename}`;
  } catch (error) {
    $("mediaStatus").textContent = error.message;
  } finally {
    $("mediaDownloadBtn").disabled = false;
  }
}

function parseFilename(header) {
  if (!header) return "";
  const match = header.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : "";
}

function toggleMediaPanel() {
  $("mediaPanel").classList.toggle("hidden");
}

function openSidebar() {
  $("sidebar").classList.add("open");
  $("mobileBackdrop").classList.remove("hidden");
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("mobileBackdrop").classList.add("hidden");
}

function useAccount() {
  if (state.user) {
    setToast(state.user.email || "Аккаунт");
  } else {
    authModal(true);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(text) {
  // Small dependency-free renderer for the Nova UI:
  // code fences, inline code, basic links, paragraphs and list items.
  let source = escapeHtml(text);

  const blocks = [];
  source = source.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    const idx = blocks.push(`<pre><code>${code}</code></pre>`) - 1;
    return `@@CODE_${idx}@@`;
  });

  source = source.replace(/`([^`]+)`/g, '<span class="inline-code">$1</span>');
  source = source.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  source = source.replace(/\*(.+?)\*/g, "<em>$1</em>");
  source = source.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = source.split("\n");
  const parts = [];
  let list = [];

  function flushList() {
    if (list.length) {
      parts.push(`<ul>${list.join("")}</ul>`);
      list = [];
    }
  }

  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`);
    } else if (/^\s*\d+\.\s+/.test(line)) {
      list.push(`<li>${line.replace(/^\s*\d+\.\s+/, "")}</li>`);
    } else if (!line.trim()) {
      flushList();
    } else if (/^#{1,3}\s+/.test(line)) {
      flushList();
      const level = Math.min(3, (line.match(/^#+/) || [""])[0].length);
      const body = line.replace(/^#{1,3}\s+/, "");
      parts.push(`<h${level}>${body}</h${level}>`);
    } else {
      flushList();
      parts.push(`<p>${line}</p>`);
    }
  }
  flushList();

  let html = parts.join("");
  html = html.replace(/@@CODE_(\d+)@@/g, (_, index) => blocks[Number(index)]);
  return html;
}


const SUPPORT_TELEGRAM_URL = "https://t.me/NovaAI_HelpBot";

function openSupport() {
  const popup = window.open(SUPPORT_TELEGRAM_URL, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.href = SUPPORT_TELEGRAM_URL;
  }
}

function bindSupportButtons() {
  document.querySelectorAll("[data-support]").forEach((btn) => {
    btn.addEventListener("click", openSupport);
  });
}

function showPage(page) {
  state.page = page;

  const pages = {
    home: $("homePage"),
    chats: $("chatsPage"),
    files: $("filesPage"),
    settings: $("settingsPage"),
    profile: $("profilePage"),
  };

  const chatScroll = $("chatScroll");
  const composer = document.querySelector(".composer-wrap");
  const media = $("mediaPanel");

  Object.entries(pages).forEach(([key, el]) => {
    if (el) el.classList.toggle("hidden", key !== page);
  });

  const isPage = Object.prototype.hasOwnProperty.call(pages, page);
  if (chatScroll) chatScroll.classList.toggle("hidden", isPage);
  if (composer) composer.classList.toggle("hidden", isPage);
  if (media && page !== "chat") media.classList.add("hidden");

  if (!isPage) return;

  if (page === "home") renderHomePage();
  if (page === "chats") renderChatsPage();
  if (page === "files") renderFilesPage();
  if (page === "settings") renderSettingsPage();
  if (page === "profile") renderProfilePage();

  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  closeSidebar();
  window.scrollTo({top: 0, behavior: "smooth"});
}

function pageShell(title, subtitle, body) {
  return `
    <div class="panel-card">
      <div class="page-heading">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      ${body}
    </div>
  `;
}

function renderHomePage() {
  $("homePage").innerHTML = pageShell(
    "Nova AI",
    "Твой AI workspace: идеи, код, файлы, изображения, история и проекты.",
    `
      <div class="profile-hero">
        <div class="profile-avatar">${escapeHtml((state.user?.email || "N").slice(0,1).toUpperCase())}</div>
        <div>
          <div class="profile-email">${escapeHtml(state.user?.email || "Аккаунт")}</div>
          <div class="profile-meta">Синхронизация включена</div>
        </div>
      </div>

      <div class="home-section-title">Быстрые действия</div>
      <div class="card-grid home-card-grid">
        <button class="feature-card" data-home-action="chat"><div class="feature-icon">＋</div><b>Новый чат</b><p>Быстро начать новую задачу.</p></button>
        <button class="feature-card" data-home-action="code"><div class="feature-icon">⌘</div><b>Генерация кода</b><p>Python, JavaScript, Lua и другие языки.</p></button>
        <button class="feature-card" data-home-action="file"><div class="feature-icon">◫</div><b>Анализ файлов</b><p>PDF, TXT, CSV, ZIP и проекты.</p></button>
        <button class="feature-card" data-home-action="image"><div class="feature-icon">▧</div><b>Изображения</b><p>Анализ фото через Vision-модель.</p></button>
        <button class="feature-card" data-home-action="history"><div class="feature-icon">◴</div><b>История</b><p>Все прошлые разговоры в одном месте.</p></button>
        <button class="feature-card" data-home-action="projects"><div class="feature-icon">◈</div><b>Проекты</b><p>Группируй чаты и файлы по задачам.</p></button>
        <button class="feature-card" data-home-action="templates"><div class="feature-icon">▦</div><b>Шаблоны</b><p>Готовые стартовые запросы для работы.</p></button>
        <button class="feature-card" data-home-action="rules"><div class="feature-icon">✓</div><b>Правила Nova</b><p>Настрой стиль, язык и контекст ответов.</p></button>
        <button class="feature-card" data-home-action="media"><div class="feature-icon">▶</div><b>Медиа</b><p>Скачать медиа по ссылке.</p></button>
        <button class="feature-card" data-home-action="profile"><div class="feature-icon">◎</div><b>Профиль</b><p>Безопасность, пароль и аккаунт.</p></button>
      </div>

      <div class="home-section-title" style="margin-top:22px">Шаблоны</div>
      <div class="template-strip">
        <button class="template-btn" data-template="code">💻 Объясни код</button>
        <button class="template-btn" data-template="plan">🧠 Составь план</button>
        <button class="template-btn" data-template="rewrite">✍ Улучши текст</button>
        <button class="template-btn" data-template="debug">🐛 Найди ошибку</button>
        <button class="template-btn" data-template="idea">✨ Придумай идеи</button>
      </div>
    `
  );

  document.querySelectorAll("[data-home-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.homeAction;
      if (action === "chat") {
        const c = await createChat();
        if (c) { showPage("chat"); await openChat(c.id); }
      } else if (action === "file" || action === "image") {
        showPage("chat");
        $("fileInput").click();
      } else if (action === "media") {
        showPage("chat");
        toggleMediaPanel();
      } else if (action === "code") {
        showPage("chat");
        $("messageInput").value = "Помоги написать или исправить код. Укажи язык и требования.\n\n";
        resizeComposer();
        $("messageInput").focus();
      } else if (action === "history") {
        showPage("chats");
      } else if (action === "projects") {
        setToast("Раздел проектов подготовлен в интерфейсе; чаты пока используются как рабочие пространства.");
      } else if (action === "templates") {
        setToast("Выбери шаблон ниже");
      } else if (action === "rules") {
        showPage("settings");
      } else if (action === "profile") {
        showPage("profile");
      }
    });
  });

  document.querySelectorAll("[data-template]").forEach(btn => {
    btn.addEventListener("click", () => {
      const prompts = {
        code: "Объясни следующий код простыми словами и укажи потенциальные проблемы:\n\n",
        plan: "Составь пошаговый план для задачи:\n\n",
        rewrite: "Улучши этот текст, сохранив смысл и стиль:\n\n",
        debug: "Найди и исправь ошибку в коде. Объясни причину:\n\n",
        idea: "Придумай 10 практичных идей для:\n\n",
      };
      showPage("chat");
      $("messageInput").value = prompts[btn.dataset.template] || "";
      resizeComposer();
      $("messageInput").focus();
    });
  });
}


function renderChatsPage() {
  const rows = state.chats.map(c => `
    <button class="settings-row chat-page-row" data-chat-page-id="${escapeHtml(c.id)}">
      <span>
        <b>${escapeHtml(c.title || "Новый чат")}</b>
        <small>${new Date((c.updated_at || 0) * 1000).toLocaleString()}</small>
      </span>
      <span>→</span>
    </button>
  `).join("");

  $("chatsPage").innerHTML = pageShell(
    "Все чаты",
    `${state.chats.length} чатов`,
    `
      <div class="page-actions">
        <button id="pageNewChat" class="primary-btn">＋ Новый чат</button>
      </div>
      <div class="settings-list" style="margin-top:12px">
        ${rows || '<div class="muted small">Пока нет чатов.</div>'}
      </div>
    `
  );

  $("pageNewChat")?.addEventListener("click", async () => {
    const c = await createChat();
    if (c) await openChat(c.id);
    showPage("chat");
  });

  document.querySelectorAll("[data-chat-page-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await openChat(btn.dataset.chatPageId);
      showPage("chat");
    });
  });
}

async function renderFilesPage() {
  let files = [];
  try {
    files = (await api("/v1/files")).files || [];
  } catch (e) {
    setToast(e.message);
  }

  $("filesPage").innerHTML = pageShell(
    "Файлы",
    "Файлы этого аккаунта",
    `
      <div class="page-actions">
        <button id="pageUploadFile" class="primary-btn">＋ Загрузить файл</button>
      </div>
      <div class="settings-list" style="margin-top:12px">
        ${files.map(f => `
          <div class="settings-row">
            <span><b>${escapeHtml(f.original_name || "file")}</b><small>${formatBytes(f.size)} · ${escapeHtml(f.content_type || "")}</small></span>
            <button class="secondary-action" data-delete-file="${escapeHtml(f.id)}">Удалить</button>
          </div>
        `).join("") || '<div class="muted small">Нет загруженных файлов.</div>'}
      </div>
    `
  );

  $("pageUploadFile")?.addEventListener("click", () => $("fileInput").click());
  document.querySelectorAll("[data-delete-file]").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/v1/files/${encodeURIComponent(btn.dataset.deleteFile)}`, {method:"DELETE"});
        renderFilesPage();
      } catch (e) {
        setToast(e.message);
      }
    });
  });
}

function renderSettingsPage() {
  $("settingsPage").innerHTML = pageShell(
    "Настройки",
    "Управление интерфейсом, чатом и аккаунтом.",
    `
      <div class="settings-list">
        <div class="settings-row">
          <span><b>Провайдер</b><small>Текущий: ${escapeHtml($("providerSelect").value)}</small></span>
          <button id="settingsModels" class="secondary-action">Модели</button>
        </div>
        <div class="settings-row">
          <span><b>Температура</b><small>${Number(state.temperature).toFixed(2)}</small></span>
          <button id="settingsTemp" class="secondary-action">Открыть</button>
        </div>
        <div class="settings-row">
          <span><b>Максимум токенов</b><small>${state.maxTokens}</small></span>
          <button id="settingsTokens" class="secondary-action">Открыть</button>
        </div>
        <div class="settings-row">
          <span><b>Аккаунт</b><small>${escapeHtml(state.user?.email || "")}</small></span>
          <button id="settingsProfile" class="secondary-action">Профиль</button>
        </div>
        <div class="settings-row">
          <span><b>Вход через Google / Apple</b><small>Войти без пароля Nova, используя свой аккаунт.</small></span>
          <div class="settings-actions-inline">
            <button id="settingsGoogle" class="secondary-action">Google</button>
            <button id="settingsApple" class="secondary-action">Apple</button>
          </div>
        </div>
        <div class="settings-row">
          <span><b>Безопасность</b><small>Смена пароля и выход из аккаунта</small></span>
          <button id="settingsPassword" class="secondary-action">Пароль</button>
        </div>
      </div>
    `
  );

  $("settingsModels").onclick = () => {
    showPage("chat");
    $("providerSelect").scrollIntoView({behavior:"smooth", block:"center"});
  };
  $("settingsTemp").onclick = () => {
    showPage("chat");
    $("temperature").focus();
  };
  $("settingsTokens").onclick = () => {
    showPage("chat");
    $("maxTokens").focus();
  };
  $("settingsProfile").onclick = () => showPage("profile");
  $("settingsPassword").onclick = () => showPage("profile");
  $("settingsGoogle").onclick = () => startGoogleSignIn();
  $("settingsApple").onclick = () => startAppleSignIn();
}

function renderProfilePage() {
  $("profilePage").innerHTML = pageShell(
    "Профиль",
    "Ваш аккаунт и безопасность.",
    `
      <div class="profile-hero">
        <div class="profile-avatar">${escapeHtml((state.user?.email || "N").slice(0,1).toUpperCase())}</div>
        <div>
          <div class="profile-email">${escapeHtml(state.user?.email || "")}</div>
          <div class="profile-meta">Nova AI account</div>
        </div>
      </div>

      <div class="settings-list">
        <div class="settings-row">
          <span><b>Email</b><small>${escapeHtml(state.user?.email || "")}</small></span>
          <span class="muted small">подтверждён</span>
        </div>
        <div class="settings-row">
          <span><b>Пароль</b><small>Изменяйте пароль здесь, не выходя из аккаунта.</small></span>
          <button id="changePasswordBtn" class="secondary-action">Сменить</button>
        </div>
        <div class="settings-row">
          <span><b>Быстрый вход</b><small>Google / Apple можно использовать вместо пароля после настройки провайдера.</small></span>
          <div class="settings-actions-inline">
            <button id="profileGoogle" class="secondary-action">Google</button>
            <button id="profileApple" class="secondary-action">Apple</button>
          </div>
        </div>
        <div class="settings-row">
          <span><b>Сессия</b><small>Очистить сохранённый токен на этом устройстве.</small></span>
          <button id="profileLogout" class="secondary-action">Выйти</button>
        </div>
      </div>

      <div id="passwordChangeBox" class="panel-card hidden" style="margin:14px 0 0;padding:15px">
        <div class="page-heading"><h2 style="font-size:18px">Смена пароля</h2><p>Введите текущий и новый пароль.</p></div>
        <input id="currentPasswordProfile" type="password" class="control" placeholder="Текущий пароль">
        <input id="newPasswordProfile" type="password" class="control" style="margin-top:8px" placeholder="Новый пароль">
        <button id="savePasswordProfile" class="primary-btn" style="margin-top:9px">Сохранить пароль</button>
      </div>
    `
  );

  $("changePasswordBtn").onclick = () => $("passwordChangeBox").classList.toggle("hidden");
  $("profileLogout").onclick = () => logout(true);
  $("profileGoogle").onclick = () => startGoogleSignIn();
  $("profileApple").onclick = () => startAppleSignIn();

  $("savePasswordProfile").onclick = async () => {
    const current_password = $("currentPasswordProfile").value;
    const new_password = $("newPasswordProfile").value;
    try {
      await api("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({current_password, new_password}),
      });
      setToast("Пароль изменён");
      $("currentPasswordProfile").value = "";
      $("newPasswordProfile").value = "";
      $("passwordChangeBox").classList.add("hidden");
    } catch (e) {
      setToast(e.message);
    }
  };
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  if (n < 1024*1024*1024) return `${(n/1024/1024).toFixed(1)} MB`;
  return `${(n/1024/1024/1024).toFixed(1)} GB`;
}


function startGoogleSignIn() {
  window.location.href = "/v1/auth/google/start";
}

function startAppleSignIn() {
  window.location.href = "/v1/auth/apple/start";
}

async function finalizeOAuth() {
  if (!state.oauthCode) return false;

  try {
    const payload = await api("/v1/auth/oauth/finalize", {
      method: "POST",
      body: JSON.stringify({code: state.oauthCode}),
    });

    saveAuth(payload);
    state.oauthCode = "";
    history.replaceState({}, "", location.pathname);
    authModal(false);
    await bootApp();
    setToast("Вход выполнен");
    return true;
  } catch (e) {
    state.oauthCode = "";
    history.replaceState({}, "", location.pathname);
    $("authError").textContent = e.message;
    authModal(true);
    return false;
  }
}

async function initGoogleSignIn() {
  try {
    const config = await api("/v1/auth/google-config");
    state.googleEnabled = Boolean(config.enabled);
    $("googleSignInBtn").classList.toggle("oauth-disabled", !state.googleEnabled);
    $("googleSignInBtn").title = state.googleEnabled
      ? ""
      : "Google-вход ещё не настроен на сервере";
  } catch {}
}


async function authenticate() {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  $("authError").textContent = "";

  if (!email || !password) {
    $("authError").textContent = "Введите email и пароль.";
    return;
  }

  $("authSubmitBtn").disabled = true;
  $("authSubmitBtn").textContent = state.authMode === "login" ? "Входим..." : "Создаём...";

  try {
    const payload = await api(
      state.authMode === "login" ? "/v1/auth/login" : "/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify({email, password}),
      }
    );
    saveAuth(payload);
    authModal(false);
    await bootApp();
  } catch (error) {
    $("authError").textContent = error.message;
  } finally {
    $("authSubmitBtn").disabled = false;
    $("authSubmitBtn").textContent = state.authMode === "login" ? "Войти" : "Создать аккаунт";
  }
}

async function sendForgotPassword() {
  const email = $("forgotEmailInput").value.trim();
  $("forgotError").textContent = "";
  if (!email) {
    $("forgotError").textContent = "Введите email.";
    return;
  }

  $("forgotSubmitBtn").disabled = true;
  $("forgotSubmitBtn").textContent = "Отправляем...";
  try {
    const data = await api("/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({email}),
    });
    $("forgotError").textContent = "";
    setToast("Если аккаунт существует, ссылка отправлена на email");
    if (data.dev_reset_url) {
      navigator.clipboard?.writeText(location.origin + data.dev_reset_url);
      setToast("Dev: ссылка восстановления скопирована");
    }
    $("resetModal").classList.add("hidden");
  } catch (e) {
    $("forgotError").textContent = e.message;
  } finally {
    $("forgotSubmitBtn").disabled = false;
    $("forgotSubmitBtn").textContent = "Отправить ссылку";
  }
}

async function submitResetPassword() {
  const password = $("resetPasswordInput").value;
  if (!state.resetToken) return;

  $("resetPasswordError").textContent = "";
  try {
    await api("/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({token: state.resetToken, new_password: password}),
    });
    history.replaceState({}, "", location.pathname);
    state.resetToken = "";
    $("resetPasswordModal").classList.add("hidden");
    setToast("Пароль изменён. Теперь войдите.");
  } catch (e) {
    $("resetPasswordError").textContent = e.message;
  }
}

function syncSettingsUi() {
  $("temperature").value = state.temperature;
  $("tempValue").textContent = Number(state.temperature).toFixed(2);
  $("maxTokens").value = state.maxTokens;
  $("maxTokensValue").textContent = state.maxTokens;
}

async function bootApp() {
  if (!state.token) {
    authModal(true);
    return;
  }

  try {
    await api("/v1/auth/me");
    $("accountInitial").textContent = (state.user?.email || "N").slice(0,1).toUpperCase();
    syncSettingsUi();
    await loadModels();
    await loadChats();
    authModal(false);
  } catch (error) {
    if (error.status === 401) {
      authModal(true);
    } else {
      setToast(error.message);
    }
  }
}

function init() {
  if (!state.models.length) state.models = FALLBACK_MODELS.slice();
  renderModels();
  $("loginTab").addEventListener("click", () => {
    state.authMode = "login";
    $("loginTab").classList.add("active");
    $("registerTab").classList.remove("active");
    $("authSubmitBtn").textContent = "Войти";
    $("passwordInput").autocomplete = "current-password";
    $("authError").textContent = "";
  });

  $("registerTab").addEventListener("click", () => {
    state.authMode = "register";
    $("registerTab").classList.add("active");
    $("loginTab").classList.remove("active");
    $("authSubmitBtn").textContent = "Создать аккаунт";
    $("passwordInput").autocomplete = "new-password";
    $("authError").textContent = "";
  });

  $("authSubmitBtn").addEventListener("click", authenticate);
  $("passwordInput").addEventListener("keydown", e => {
    if (e.key === "Enter") authenticate();
  });

  $("togglePassword").addEventListener("click", () => {
    $("passwordInput").type = $("passwordInput").type === "password" ? "text" : "password";
  });

  $("forgotBtn").addEventListener("click", () => {
    $("resetModal").classList.add("hidden");
    $("authModal").classList.add("hidden");
    $("forgotEmailInput").value = $("emailInput").value.trim();
    $("resetModal").classList.remove("hidden");
    $("forgotEmailInput").focus();
  });

  $("forgotCloseBtn").addEventListener("click", () => {
    $("resetModal").classList.add("hidden");
    $("authModal").classList.remove("hidden");
  });

  $("forgotSubmitBtn").addEventListener("click", sendForgotPassword);
  $("resetPasswordSubmitBtn").addEventListener("click", submitResetPassword);
  $("googleSignInBtn").addEventListener("click", startGoogleSignIn);
  $("appleSignInBtn").addEventListener("click", startAppleSignIn);

  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });

  $("mobileNewChat").addEventListener("click", async () => {
    const c = await createChat();
    if (c) await openChat(c.id);
    showPage("chat");
  });

  $("accountBtn").addEventListener("click", () => showPage("profile"));


  $("providerSelect").addEventListener("change", renderModels);
  $("modelSelect").addEventListener("change", renderModels);

  $("temperature").addEventListener("input", e => {
    state.temperature = Number(e.target.value);
    $("tempValue").textContent = state.temperature.toFixed(2);
    localStorage.setItem("nova_temperature", state.temperature);
  });

  $("maxTokens").addEventListener("input", e => {
    state.maxTokens = Number(e.target.value);
    $("maxTokensValue").textContent = state.maxTokens;
    localStorage.setItem("nova_max_tokens", state.maxTokens);
  });

  $("newChatBtn").addEventListener("click", async () => {
    const chat = await createChat();
    if (chat) await openChat(chat.id);
    closeSidebar();
  });

  $("deleteChatBtn").addEventListener("click", deleteCurrentChat);
  $("clearChatBtn").addEventListener("click", clearCurrentChat);
  $("logoutBtn").addEventListener("click", () => logout(true));

  $("openSidebar").addEventListener("click", openSidebar);
  $("closeSidebar").addEventListener("click", closeSidebar);
  $("mobileBackdrop").addEventListener("click", closeSidebar);

  $("attachBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", e => {
    state.pendingFiles.push(...Array.from(e.target.files || []));
    renderPendingFiles();
    e.target.value = "";
  });

  $("sendBtn").addEventListener("click", sendMessage);
  $("messageInput").addEventListener("input", resizeComposer);
  $("messageInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  $("mediaDownloadBtn").addEventListener("click", downloadMedia);

  $("heroNewChat")?.addEventListener("click", async () => {
    const chat = await createChat();
    if (chat) await openChat(chat.id);
  });

  $("heroAttach")?.addEventListener("click", () => $("fileInput").click());

  $("heroModels")?.addEventListener("click", () => {
    $("providerSelect").scrollIntoView({behavior: "smooth", block: "center"});
    setToast("Выбор модели в меню слева");
  });

  document.querySelectorAll("[data-hero-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.heroAction;
      if (action === "file" || action === "image") {
        $("fileInput").click();
      } else if (action === "media") {
        toggleMediaPanel();
      } else if (action === "code") {
        $("messageInput").value = "Помоги написать или исправить Lua/Python/JavaScript-код.\n\n";
        resizeComposer();
        $("messageInput").focus();
      }
    });
  });


  // Double-clicking the chat title opens the media downloader, preserving the existing feature
  // without adding more permanent chrome to the main chat UI.
  $("chatTitle").addEventListener("dblclick", toggleMediaPanel);

  syncSettingsUi();
  initGoogleSignIn();

  if (state.oauthError) {
    $("authError").textContent = `Вход не выполнен: ${state.oauthError}`;
    history.replaceState({}, "", location.pathname);
    state.oauthError = "";
    authModal(true);
  } else if (state.oauthCode) {
    finalizeOAuth();
  } else {
    bootApp();
  }

  if (state.resetToken) {
    $("resetPasswordModal").classList.remove("hidden");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);


// Support button: open Nova AI Telegram support.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindSupportButtons, { once: true });
} else {
  bindSupportButtons();
}
