"use strict";

/* =========================================================
   NOVA AI — APP.JS
   Frontend logic
   ========================================================= */

const $ = (id) => document.getElementById(id);

const state = {
    token: localStorage.getItem("nova_token") || "",
    user: JSON.parse(localStorage.getItem("nova_user") || "null"),

    authMode: "login",

    models: [],
    chats: [],
    activeChatId: null,

    pendingFiles: [],

    temperature: Number(
        localStorage.getItem("nova_temperature") || "0.7"
    ),

    maxTokens: Number(
        localStorage.getItem("nova_max_tokens") || "4096"
    ),

    page: "chat",

    googleEnabled: false,

    resetToken:
        new URLSearchParams(location.search).get("reset_token") || "",

    oauthCode:
        new URLSearchParams(location.search).get("oauth_code") || "",

    oauthError:
        new URLSearchParams(location.search).get("oauth_error") || "",

    sending: false,
    rendering: false
};


/* =========================================================
   FALLBACK MODELS
   ========================================================= */

const FALLBACK_MODELS = [
    {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        provider: "groq"
    },
    {
        id: "openai/gpt-oss-20b",
        name: "GPT-OSS 20B",
        provider: "groq"
    },
    {
        id: "qwen/qwen3.6-27b",
        name: "Qwen 3.6 27B",
        provider: "groq"
    },
    {
        id: "qwen/qwen3.8-27b",
        name: "Qwen 3.8 27B",
        provider: "groq"
    },
    {
        id: "deepseek/deepseek-chat",
        name: "DeepSeek Chat",
        provider: "openrouter"
    },
    {
        id: "google/gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        provider: "openrouter"
    }
];


/* =========================================================
   SMALL HELPERS
   ========================================================= */

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function escapeAttribute(value) {
    return escapeHtml(value);
}


function getSelectedProvider() {
    const el = $("providerSelect");
    return el ? el.value : "groq";
}


function getSelectedModel() {
    const el = $("modelSelect");
    return el ? el.value : "";
}


function getTemperature() {
    const el = $("temperature");

    if (!el) {
        return state.temperature;
    }

    const value = Number(el.value);

    if (!Number.isFinite(value)) {
        return state.temperature;
    }

    return value;
}


function getMaxTokens() {
    const el = $("maxTokens");

    if (!el) {
        return state.maxTokens;
    }

    const value = Number(el.value);

    if (!Number.isFinite(value)) {
        return state.maxTokens;
    }

    return Math.max(1, Math.floor(value));
}


function saveSettings() {
    state.temperature = getTemperature();
    state.maxTokens = getMaxTokens();

    localStorage.setItem(
        "nova_temperature",
        String(state.temperature)
    );

    localStorage.setItem(
        "nova_max_tokens",
        String(state.maxTokens)
    );
}


function setText(id, value) {
    const el = $(id);

    if (el) {
        el.textContent = value ?? "";
    }
}


function showElement(id, visible = true) {
    const el = $(id);

    if (!el) {
        return;
    }

    el.hidden = !visible;
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}


function safeJsonParse(value, fallback = null) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}


/* =========================================================
   TOAST
   ========================================================= */

function toast(message, type = "info") {
    let container = $("toastContainer");

    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";

        container.style.position = "fixed";
        container.style.right = "20px";
        container.style.bottom = "20px";
        container.style.zIndex = "99999";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "10px";

        document.body.appendChild(container);
    }

    const item = document.createElement("div");

    item.textContent = message;

    item.style.padding = "11px 14px";
    item.style.borderRadius = "10px";
    item.style.background = "#171717";
    item.style.border = "1px solid rgba(255,255,255,.12)";
    item.style.color = "#fff";
    item.style.fontSize = "14px";
    item.style.maxWidth = "360px";
    item.style.boxShadow = "0 10px 30px rgba(0,0,0,.35)";
    item.style.opacity = "0";
    item.style.transform = "translateY(8px)";
    item.style.transition = "all .2s ease";

    if (type === "error") {
        item.style.borderColor = "rgba(255,80,80,.35)";
    }

    if (type === "success") {
        item.style.borderColor = "rgba(80,255,140,.35)";
    }

    container.appendChild(item);

    requestAnimationFrame(() => {
        item.style.opacity = "1";
        item.style.transform = "translateY(0)";
    });

    setTimeout(() => {
        item.style.opacity = "0";
        item.style.transform = "translateY(8px)";

        setTimeout(() => {
            item.remove();
        }, 220);
    }, 3200);
}


/* =========================================================
   API
   ========================================================= */

async function api(path, options = {}) {
    const config = {
        method: options.method || "GET",
        headers: {
            ...(options.headers || {})
        }
    };

    if (state.token) {
        config.headers.Authorization = `Bearer ${state.token}`;
    }

    if (
        options.body !== undefined &&
        !(options.body instanceof FormData)
    ) {
        config.headers["Content-Type"] = "application/json";
        config.body = JSON.stringify(options.body);
    } else if (options.body !== undefined) {
        config.body = options.body;
    }

    let response;

    try {
        response = await fetch(path, config);
    } catch (error) {
        console.error("Network error:", error);

        throw new Error(
            "Не удалось подключиться к серверу."
        );
    }

    const contentType =
        response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
        data = await response.json().catch(() => null);
    } else {
        data = await response.text().catch(() => "");
    }

    if (!response.ok) {
        let message = "Ошибка запроса.";

        if (typeof data === "string" && data.trim()) {
            message = data;
        } else if (isObject(data)) {
            message =
                data.detail ||
                data.message ||
                data.error ||
                message;
        }

        if (response.status === 401) {
            /*
             * Не делаем logout автоматически для каждого
             * неавторизованного запроса.
             *
             * Иначе ошибка одного auth endpoint может
             * неожиданно удалить текущую сессию.
             */
            if (
                path.startsWith("/v1/chats") ||
                path.startsWith("/v1/files") ||
                path === "/v1/auth/me"
            ) {
                state.token = "";
                state.user = null;

                localStorage.removeItem("nova_token");
                localStorage.removeItem("nova_user");
            }
        }

        const error = new Error(message);
        error.status = response.status;
        error.data = data;

        throw error;
    }

    return data;
}


/* =========================================================
   AUTH STORAGE
   ========================================================= */

function saveAuth(token, user) {
    state.token = token || "";
    state.user = user || null;

    if (state.token) {
        localStorage.setItem("nova_token", state.token);
    } else {
        localStorage.removeItem("nova_token");
    }

    if (state.user) {
        localStorage.setItem(
            "nova_user",
            JSON.stringify(state.user)
        );
    } else {
        localStorage.removeItem("nova_user");
    }
}


function clearAuth() {
    state.token = "";
    state.user = null;

    localStorage.removeItem("nova_token");
    localStorage.removeItem("nova_user");
}


/* =========================================================
   AUTH UI
   ========================================================= */

function setAuthMode(mode) {
    state.authMode = mode === "register"
        ? "register"
        : "login";

    const login = $("loginForm");
    const register = $("registerForm");

    if (login) {
        login.hidden = state.authMode !== "login";
    }

    if (register) {
        register.hidden = state.authMode !== "register";
    }

    const title = $("authTitle");

    if (title) {
        title.textContent =
            state.authMode === "login"
                ? "Вход"
                : "Регистрация";
    }
}


function openAuth(mode = "login") {
    setAuthMode(mode);

    const modal = $("authModal");

    if (modal) {
        modal.hidden = false;
        modal.classList.add("open");
    }
}


function closeAuth() {
    const modal = $("authModal");

    if (modal) {
        modal.hidden = true;
        modal.classList.remove("open");
    }
}


function updateAuthUI() {
    const authArea = $("authArea");
    const userArea = $("userArea");

    if (authArea) {
        authArea.hidden = !!state.user;
    }

    if (userArea) {
        userArea.hidden = !state.user;
    }

    const userName =
        state.user?.name ||
        state.user?.username ||
        state.user?.email ||
        "";

    setText("userName", userName);
    setText("profileName", userName);
    setText(
        "profileEmail",
        state.user?.email || ""
    );
}


/* =========================================================
   LOGIN / REGISTER
   ========================================================= */

async function login(email, password) {
    if (!email || !password) {
        toast(
            "Введите email и пароль.",
            "error"
        );
        return;
    }

    try {
        const result = await api(
            "/v1/auth/login",
            {
                method: "POST",
                body: {
                    email,
                    password
                }
            }
        );

        const token =
            result?.access_token ||
            result?.token ||
            "";

        const user =
            result?.user ||
            null;

        if (!token) {
            throw new Error(
                "Сервер не вернул токен авторизации."
            );
        }

        saveAuth(token, user);

        closeAuth();

        toast(
            "Вы вошли в аккаунт.",
            "success"
        );

        await bootApp();

    } catch (error) {
        console.error(error);

        toast(
            error.message ||
            "Не удалось выполнить вход.",
            "error"
        );
    }
}


async function register(name, email, password) {
    if (!email || !password) {
        toast(
            "Заполните обязательные поля.",
            "error"
        );
        return;
    }

    try {
        const result = await api(
            "/v1/auth/register",
            {
                method: "POST",
                body: {
                    name,
                    email,
                    password
                }
            }
        );

        const token =
            result?.access_token ||
            result?.token ||
            "";

        const user =
            result?.user ||
            null;

        if (token) {
            saveAuth(token, user);

            closeAuth();

            toast(
                "Аккаунт создан.",
                "success"
            );

            await bootApp();

            return;
        }

        toast(
            "Аккаунт создан. Теперь войдите.",
            "success"
        );

        setAuthMode("login");

    } catch (error) {
        console.error(error);

        toast(
            error.message ||
            "Не удалось создать аккаунт.",
            "error"
        );
    }
}


/* =========================================================
   LOGOUT
   ========================================================= */

function logout(showMessage = true) {
    clearAuth();

    state.chats = [];
    state.activeChatId = null;

    updateAuthUI();

    if (showMessage) {
        toast(
            "Вы вышли из аккаунта.",
            "success"
        );
    }

    showPage("chat");
}


/* =========================================================
   AUTHENTICATE
   ========================================================= */

async function authenticate() {
    if (!state.token) {
        updateAuthUI();
        return false;
    }

    try {
        const result =
            await api("/v1/auth/me");

        if (result?.user) {
            state.user = result.user;
        } else {
            state.user = result;
        }

        localStorage.setItem(
            "nova_user",
            JSON.stringify(state.user)
        );

        updateAuthUI();

        return true;

    } catch (error) {
        console.warn(
            "Authentication check failed:",
            error
        );

        clearAuth();
        updateAuthUI();

        return false;
    }
}


/* =========================================================
   MODELS
   ========================================================= */

function normalizeModels(data) {
    let models = [];

    if (Array.isArray(data)) {
        models = data;
    } else if (Array.isArray(data?.models)) {
        models = data.models;
    } else if (Array.isArray(data?.data)) {
        models = data.data;
    }

    return models
        .map(model => {
            if (typeof model === "string") {
                return {
                    id: model,
                    name: model,
                    provider: ""
                };
            }

            return {
                id:
                    model?.id ||
                    model?.model ||
                    "",

                name:
                    model?.name ||
                    model?.id ||
                    model?.model ||
                    "Model",

                provider:
                    model?.provider ||
                    ""
            };
        })
        .filter(model => model.id);
}


async function loadModels() {
    try {
        const result =
            await api("/v1/models");

        const models =
            normalizeModels(result);

        if (models.length) {
            state.models = models;
        } else {
            state.models = FALLBACK_MODELS.slice();
        }

    } catch (error) {
        console.warn(
            "Could not load models:",
            error
        );

        state.models = FALLBACK_MODELS.slice();

        toast(
            "Не удалось загрузить модели с сервера. Используется локальный список.",
            "info"
        );
    }

    renderModels();
}


function getModelsForProvider(provider) {
    const filtered =
        state.models.filter(
            model =>
                !model.provider ||
                model.provider.toLowerCase() ===
                provider.toLowerCase()
        );

    return filtered.length
        ? filtered
        : state.models;
}


function renderModels(preferredModel = null) {
    const select = $("modelSelect");

    if (!select) {
        return;
    }

    const provider =
        getSelectedProvider();

    const models =
        getModelsForProvider(provider);

    const previous =
        preferredModel ||
        select.value ||
        localStorage.getItem(
            "nova_model"
        ) ||
        "";

    select.innerHTML = "";

    for (const model of models) {
        const option =
            document.createElement("option");

        option.value = model.id;
        option.textContent = model.name;

        select.appendChild(option);
    }

    if (!models.length) {
        return;
    }

    const matching =
        models.find(
            model => model.id === previous
        );

    select.value =
        matching
            ? matching.id
            : models[0].id;

    localStorage.setItem(
        "nova_model",
        select.value
    );

    updateProviderStatus();
}


function updateProviderStatus() {
    const provider =
        getSelectedProvider();

    const status =
        $("providerStatus");

    if (!status) {
        return;
    }

    const name =
        provider === "openrouter"
            ? "OpenRouter"
            : "Groq";

    status.textContent = name;
}


/* =========================================================
   CHATS
   ========================================================= */

function normalizeChats(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (Array.isArray(data?.chats)) {
        return data.chats;
    }

    if (Array.isArray(data?.data)) {
        return data.data;
    }

    return [];
}


function getChatId(chat) {
    return (
        chat?.id ??
        chat?.chat_id ??
        chat?.uuid ??
        null
    );
}


function getChatTitle(chat) {
    return (
        chat?.title ||
        chat?.name ||
        chat?.subject ||
        "Новый чат"
    );
}


async function loadChats() {
    try {
        const result =
            await api("/v1/chats");

        state.chats =
            normalizeChats(result);

        renderChatList();

        if (!state.chats.length) {
            await createChat();
            return;
        }

        const currentExists =
            state.chats.some(
                chat =>
                    String(getChatId(chat)) ===
                    String(state.activeChatId)
            );

        if (!currentExists) {
            state.activeChatId =
                getChatId(state.chats[0]);
        }

        await openChat(
            state.activeChatId,
            false
        );

    } catch (error) {
        console.error(
            "loadChats:",
            error
        );

        if (error.status === 401) {
            return;
        }

        toast(
            error.message ||
            "Не удалось загрузить чаты.",
            "error"
        );
    }
}


function renderChatList() {
    const container =
        $("chatList");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    for (const chat of state.chats) {
        const id =
            getChatId(chat);

        if (id === null) {
            continue;
        }

        const button =
            document.createElement("button");

        button.type = "button";
        button.className =
            "chat-history-item";

        if (
            String(id) ===
            String(state.activeChatId)
        ) {
            button.classList.add("active");
        }

        button.dataset.chatId = id;

        button.textContent =
            getChatTitle(chat);

        button.addEventListener(
            "click",
            () => {
                openChat(id);
            }
        );

        container.appendChild(button);
    }
}


async function createChat() {
    try {
        const result =
            await api(
                "/v1/chats",
                {
                    method: "POST",
                    body: {
                        title: "Новый чат"
                    }
                }
            );

        const chat =
            result?.chat ||
            result;

        const id =
            getChatId(chat);

        if (id === null) {
            throw new Error(
                "Сервер не вернул ID нового чата."
            );
        }

        state.chats.unshift(chat);
        state.activeChatId = id;

        renderChatList();
        clearMessages();

        return chat;

    } catch (error) {
        console.error(
            "createChat:",
            error
        );

        toast(
            error.message ||
            "Не удалось создать чат.",
            "error"
        );

        return null;
    }
}


async function openChat(chatId, updatePage = true) {
    if (
        chatId === null ||
        chatId === undefined
    ) {
        return;
    }

    state.activeChatId = chatId;

    renderChatList();

    if (updatePage) {
        showPage("chat");
    }

    try {
        const result =
            await api(
                `/v1/chats/${encodeURIComponent(chatId)}`
            );

        const chat =
            result?.chat ||
            result;

        const messages =
            Array.isArray(chat?.messages)
                ? chat.messages
                : Array.isArray(result?.messages)
                    ? result.messages
                    : [];

        renderMessages(messages);

    } catch (error) {
        console.error(
            "openChat:",
            error
        );

        toast(
            error.message ||
            "Не удалось открыть чат.",
            "error"
        );
    }
}


async function newChat() {
    await createChat();
}


async function clearCurrentChat() {
    if (state.activeChatId === null) {
        return;
    }

    const confirmed =
        window.confirm(
            "Очистить текущий чат?"
        );

    if (!confirmed) {
        return;
    }

    try {
        await api(
            `/v1/chats/${encodeURIComponent(state.activeChatId)}`,
            {
                method: "DELETE"
            }
        );

        const oldId =
            state.activeChatId;

        state.chats =
            state.chats.filter(
                chat =>
                    String(getChatId(chat)) !==
                    String(oldId)
            );

        state.activeChatId = null;

        renderChatList();
        clearMessages();

        await createChat();

        toast(
            "Чат очищен.",
            "success"
        );

    } catch (error) {
        console.error(
            "clearCurrentChat:",
            error
        );

        toast(
            error.message ||
            "Не удалось очистить чат.",
            "error"
        );
    }
}


async function deleteCurrentChat() {
    if (state.activeChatId === null) {
        return;
    }

    const confirmed =
        window.confirm(
            "Удалить текущий чат?"
        );

    if (!confirmed) {
        return;
    }

    const deletingId =
        state.activeChatId;

    try {
        await api(
            `/v1/chats/${encodeURIComponent(deletingId)}`,
            {
                method: "DELETE"
            }
        );

        state.chats =
            state.chats.filter(
                chat =>
                    String(getChatId(chat)) !==
                    String(deletingId)
            );

        state.activeChatId = null;

        renderChatList();
        clearMessages();

        if (state.chats.length) {
            await openChat(
                getChatId(state.chats[0])
            );
        } else {
            await createChat();
        }

        toast(
            "Чат удалён.",
            "success"
        );

    } catch (error) {
        console.error(
            "deleteCurrentChat:",
            error
        );

        toast(
            error.message ||
            "Не удалось удалить чат.",
            "error"
        );
    }
}


/* =========================================================
   MESSAGE CONTAINER
   ========================================================= */

function getMessagesContainer() {
    return (
        $("messages") ||
        $("chatMessages") ||
        null
    );
}


function getChatScrollContainer() {
    return (
        $("chatScroll") ||
        document.querySelector(".chat-scroll") ||
        null
    );
}


function clearMessages() {
    const container =
        getMessagesContainer();

    if (container) {
        container.innerHTML = "";
    }
}


function scrollChatToBottom(smooth = true) {
    const container =
        getChatScrollContainer();

    if (container) {
        container.scrollTo({
            top: container.scrollHeight,
            behavior: smooth
                ? "smooth"
                : "auto"
        });

        return;
    }

    window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: smooth
            ? "smooth"
            : "auto"
    });
}


/* =========================================================
   MARKDOWN PARSER
   ========================================================= */

function escapeMarkdownHtml(text) {
    return escapeHtml(text);
}


function renderInlineMarkdown(text) {
    let html =
        escapeMarkdownHtml(text);

    /*
     * Code
     */
    html = html.replace(
        /`([^`]+)`/g,
        "<code>$1</code>"
    );

    /*
     * Links
     */
    html = html.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    /*
     * Bold
     */
    html = html.replace(
        /\*\*([^*]+)\*\*/g,
        "<strong>$1</strong>"
    );

    html = html.replace(
        /__([^_]+)__/g,
        "<strong>$1</strong>"
    );

    /*
     * Italic
     */
    html = html.replace(
        /(^|[^*])\*([^*]+)\*(?!\*)/g,
        "$1<em>$2</em>"
    );

    html = html.replace(
        /(^|[^_])_([^_]+)_(?!_)/g,
        "$1<em>$2</em>"
    );

    return html;
}


function renderCodeBlock(code, language = "") {
    const safeCode =
        escapeHtml(
            code.replace(/\n$/, "")
        );

    const lang =
        language
            ? escapeAttribute(language)
            : "";

    return `
        <div class="nova-code-block">
            <div class="nova-code-header">
                <span>${lang || "code"}</span>
                <button
                    type="button"
                    class="nova-code-copy"
                    data-copy-code="1"
                >
                    Копировать
                </button>
            </div>
            <pre><code>${safeCode}</code></pre>
        </div>
    `;
}


function renderMarkdown(markdown) {
    if (
        markdown === null ||
        markdown === undefined
    ) {
        return "";
    }

    let source =
        String(markdown)
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

    /*
     * Сначала вытаскиваем fenced code blocks,
     * чтобы Markdown внутри кода не обрабатывался.
     */

    const codeBlocks = [];

    source = source.replace(
        /```([^\n]*)\n([\s\S]*?)```/g,
        (_, language, code) => {
            const index =
                codeBlocks.length;

            codeBlocks.push(
                renderCodeBlock(
                    code,
                    language.trim()
                )
            );

            return `\n@@NOVA_CODE_${index}@@\n`;
        }
    );

    const lines =
        source.split("\n");

    const output = [];

    let inUl = false;
    let inOl = false;

    function closeLists() {
        if (inUl) {
            output.push("</ul>");
            inUl = false;
        }

        if (inOl) {
            output.push("</ol>");
            inOl = false;
        }
    }

    function isBlank(line) {
        return !line.trim();
    }

    for (let i = 0; i < lines.length; i++) {
        const line =
            lines[i];

        /*
         * Empty line
         */
        if (isBlank(line)) {
            closeLists();

            if (
                output.length &&
                output[output.length - 1] !== "<br>"
            ) {
                output.push("<br>");
            }

            continue;
        }

        /*
         * Code placeholder
         */
        const codeMatch =
            line.match(
                /^@@NOVA_CODE_(\d+)@@$/
            );

        if (codeMatch) {
            closeLists();

            output.push(
                codeBlocks[
                    Number(codeMatch[1])
                ]
            );

            continue;
        }

        /*
         * H1
         */
        let match =
            line.match(/^#\s+(.+)$/);

        if (match) {
            closeLists();

            output.push(
                `<h1>${renderInlineMarkdown(match[1])}</h1>`
            );

            continue;
        }

        /*
         * H2
         */
        match =
            line.match(/^##\s+(.+)$/);

        if (match) {
            closeLists();

            output.push(
                `<h2>${renderInlineMarkdown(match[1])}</h2>`
            );

            continue;
        }

        /*
         * H3
         */
        match =
            line.match(/^###\s+(.+)$/);

        if (match) {
            closeLists();

            output.push(
                `<h3>${renderInlineMarkdown(match[1])}</h3>`
            );

            continue;
        }

        /*
         * Blockquote
         */
        match =
            line.match(/^>\s?(.*)$/);

        if (match) {
            closeLists();

            output.push(
                `<blockquote>${renderInlineMarkdown(match[1])}</blockquote>`
            );

            continue;
        }

        /*
         * Ordered list
         */
        match =
            line.match(/^\s*(\d+)\.\s+(.+)$/);

        if (match) {
            if (inUl) {
                output.push("</ul>");
                inUl = false;
            }

            if (!inOl) {
                output.push("<ol>");
                inOl = true;
            }

            output.push(
                `<li>${renderInlineMarkdown(match[2])}</li>`
            );

            continue;
        }

        /*
         * Unordered list
         */
        match =
            line.match(/^\s*[-*+]\s+(.+)$/);

        if (match) {
            if (inOl) {
                output.push("</ol>");
                inOl = false;
            }

            if (!inUl) {
                output.push("<ul>");
                inUl = true;
            }

            output.push(
                `<li>${renderInlineMarkdown(match[1])}</li>`
            );

            continue;
        }

        /*
         * Horizontal rule
         */
        if (
            /^(\*\s*){3,}$/.test(line.trim()) ||
            /^(-\s*){3,}$/.test(line.trim())
        ) {
            closeLists();
            output.push("<hr>");
            continue;
        }

        /*
         * Обычный текст.
         */
        closeLists();

        output.push(
            `<p>${renderInlineMarkdown(line)}</p>`
        );
    }

    closeLists();

    let html =
        output.join("");

    /*
     * Убираем лишние <br> вокруг блоков.
     */
    html = html
        .replace(/(?:<br>){2,}/g, "<br>")
        .replace(/<br>(?=<h[1-3]>)/g, "")
        .replace(/(<\/h[1-3]>)<br>/g, "$1");

    return html;
}


/* =========================================================
   CODE COPY
   ========================================================= */

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);

        toast(
            "Скопировано.",
            "success"
        );

    } catch (error) {
        /*
         * Fallback для старых браузеров.
         */
        const textarea =
            document.createElement("textarea");

        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";

        document.body.appendChild(textarea);

        textarea.select();

        try {
            document.execCommand("copy");

            toast(
                "Скопировано.",
                "success"
            );
        } catch {
            toast(
                "Не удалось скопировать.",
                "error"
            );
        }

        textarea.remove();
    }
}


function bindCodeCopyButtons(container) {
    if (!container) {
        return;
    }

    container
        .querySelectorAll(
            "[data-copy-code]"
        )
        .forEach(button => {
            button.addEventListener(
                "click",
                async () => {
                    const block =
                        button.closest(
                            ".nova-code-block"
                        );

                    const code =
                        block?.querySelector(
                            "pre code"
                        )?.textContent || "";

                    if (!code) {
                        return;
                    }

                    await copyText(code);
                }
            );
        });
}


/* =========================================================
   MESSAGE RENDERING
   ========================================================= */

function normalizeMessage(message) {
    const role =
        message?.role ||
        message?.sender ||
        message?.type ||
        "user";

    const content =
        message?.content ??
        message?.text ??
        message?.message ??
        "";

    return {
        id:
            message?.id ??
            message?.message_id ??
            null,

        role:
            role === "assistant" ||
            role === "ai" ||
            role === "bot"
                ? "assistant"
                : role === "system"
                    ? "system"
                    : "user",

        content:
            typeof content === "string"
                ? content
                : JSON.stringify(content),

        createdAt:
            message?.created_at ||
            message?.createdAt ||
            null
    };
}


function createMessageElement(message) {
    const normalized =
        normalizeMessage(message);

    const wrapper =
        document.createElement("div");

    wrapper.className =
        `message message-${normalized.role}`;

    if (normalized.id !== null) {
        wrapper.dataset.messageId =
            normalized.id;
    }

    /*
     * Не используем аватары.
     */
    const content =
        document.createElement("div");

    content.className =
        "message-content";

    if (normalized.role === "assistant") {
        content.innerHTML =
            renderMarkdown(
                normalized.content
            );
    } else {
        /*
         * Сообщения пользователя
         * не должны интерпретироваться
         * как HTML.
         */
        content.textContent =
            normalized.content;
    }

    wrapper.appendChild(content);

    if (normalized.role === "assistant") {
        const actions =
            document.createElement("div");

        actions.className =
            "message-actions";

        const copy =
            document.createElement("button");

        copy.type = "button";
        copy.className =
            "message-action";

        copy.textContent =
            "Копировать";

        copy.addEventListener(
            "click",
            () => {
                copyText(
                    normalized.content
                );
            }
        );

        actions.appendChild(copy);

        const regenerate =
            document.createElement("button");

        regenerate.type = "button";
        regenerate.className =
            "message-action";

        regenerate.textContent =
            "Повторить";

        regenerate.addEventListener(
            "click",
            () => {
                regenerateLastMessage();
            }
        );

        actions.appendChild(regenerate);

        wrapper.appendChild(actions);
    }

    return wrapper;
}


function renderMessages(messages) {
    const container =
        getMessagesContainer();

    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (!Array.isArray(messages)) {
        messages = [];
    }

    for (const message of messages) {
        const element =
            createMessageElement(message);

        container.appendChild(element);
    }

    bindCodeCopyButtons(container);

    requestAnimationFrame(() => {
        scrollChatToBottom(false);
    });
}


function appendMessage(message) {
    const container =
        getMessagesContainer();

    if (!container) {
        return null;
    }

    const element =
        createMessageElement(message);

    container.appendChild(element);

    bindCodeCopyButtons(element);

    scrollChatToBottom(true);

    return element;
}


/* =========================================================
   TYPING INDICATOR
   ========================================================= */

function showTypingIndicator() {
    const container =
        getMessagesContainer();

    if (!container) {
        return null;
    }

    const existing =
        $("novaTypingIndicator");

    if (existing) {
        return existing;
    }

    const wrapper =
        document.createElement("div");

    wrapper.id =
        "novaTypingIndicator";

    wrapper.className =
        "message message-assistant nova-typing";

    wrapper.innerHTML = `
        <div class="message-content">
            <span class="nova-typing-dot"></span>
            <span class="nova-typing-dot"></span>
            <span class="nova-typing-dot"></span>
        </div>
    `;

    container.appendChild(wrapper);

    scrollChatToBottom(true);

    return wrapper;
}


function hideTypingIndicator() {
    const indicator =
        $("novaTypingIndicator");

    if (indicator) {
        indicator.remove();
    }
}


/* =========================================================
   CHAT INPUT
   ========================================================= */

function getChatInput() {
    return (
        $("messageInput") ||
        $("chatInput") ||
        $("promptInput") ||
        null
    );
}


function setInputValue(value) {
    const input =
        getChatInput();

    if (input) {
        input.value = value;
        input.dispatchEvent(
            new Event(
                "input",
                { bubbles: true }
            )
        );
    }
}


function getInputValue() {
    return (
        getChatInput()?.value ||
        ""
    );
}


function clearInput() {
    setInputValue("");
}


function focusInput() {
    const input =
        getChatInput();

    if (input) {
        input.focus();
    }
}


function resizeTextarea() {
    const input =
        getChatInput();

    if (!input) {
        return;
    }

    if (
        input.tagName !== "TEXTAREA"
    ) {
        return;
    }

    input.style.height = "auto";

    const maxHeight = 220;

    input.style.height =
        Math.min(
            input.scrollHeight,
            maxHeight
        ) + "px";
}


function setSendingState(sending) {
    state.sending = sending;

    const sendButton =
        $("sendButton");

    if (sendButton) {
        sendButton.disabled =
            sending;
    }

    const input =
        getChatInput();

    if (input) {
        input.disabled =
            sending;
    }
}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage() {
    if (state.sending) {
        return;
    }

    const input =
        getChatInput();

    if (!input) {
        return;
    }

    const text =
        input.value.trim();

    if (!text && !state.pendingFiles.length) {
        return;
    }

    if (!state.token) {
        openAuth("login");

        toast(
            "Сначала войдите в аккаунт.",
            "error"
        );

        return;
    }

    if (state.activeChatId === null) {
        const chat =
            await createChat();

        if (!chat) {
            return;
        }
    }

    setSendingState(true);

    clearInput();
    resizeTextarea();

    /*
     * Сначала показываем пользовательское сообщение.
     */
    if (text) {
        appendMessage({
            role: "user",
            content: text
        });
    }

    let fileIds = [];

    try {
        /*
         * Загружаем прикреплённые файлы.
         */
        if (state.pendingFiles.length) {
            fileIds =
                await uploadPendingFiles();

            renderPendingFiles();
        }

        showTypingIndicator();

        const provider =
            getSelectedProvider();

        const model =
            getSelectedModel();

        saveSettings();

        const payload = {
            message: text,

            model,

            provider,

            temperature:
                getTemperature(),

            max_tokens:
                getMaxTokens(),

            file_ids:
                fileIds
        };

        const result =
            await api(
                `/v1/chats/${encodeURIComponent(state.activeChatId)}/messages`,
                {
                    method: "POST",
                    body: payload
                }
            );

        hideTypingIndicator();

        /*
         * Если backend уже вернул сообщение —
         * используем его.
         */
        const assistantMessage =
            result?.message ||
            result?.assistant_message ||
            result?.assistant ||
            null;

        if (assistantMessage) {
            appendMessage({
                ...assistantMessage,
                role:
                    assistantMessage.role ||
                    "assistant"
            });
        } else {
            /*
             * Иначе перечитываем чат.
             */
            await openChat(
                state.activeChatId,
                false
            );
        }

        /*
         * Обновляем список чатов,
         * чтобы новое название появилось слева.
         */
        try {
            const chatsResult =
                await api("/v1/chats");

            state.chats =
                normalizeChats(
                    chatsResult
                );

            renderChatList();

        } catch (error) {
            console.warn(
                "Could not refresh chats:",
                error
            );
        }

    } catch (error) {
        hideTypingIndicator();

        console.error(
            "sendMessage:",
            error
        );

        /*
         * Если backend вернул текст ошибки,
         * показываем его как обычное сообщение,
         * но без HTML.
         */
        appendMessage({
            role: "assistant",
            content:
                `Ошибка: ${error.message || "Не удалось отправить сообщение."}`
        });

    } finally {
        setSendingState(false);

        focusInput();
    }
}


/* =========================================================
   REGENERATE
   ========================================================= */

async function regenerateLastMessage() {
    if (state.sending) {
        return;
    }

    if (
        state.activeChatId === null
    ) {
        return;
    }

    try {
        const result =
            await api(
                `/v1/chats/${encodeURIComponent(state.activeChatId)}`
            );

        const chat =
            result?.chat ||
            result;

        const messages =
            Array.isArray(chat?.messages)
                ? chat.messages
                : [];

        let lastUser = null;

        for (
            let i = messages.length - 1;
            i >= 0;
            i--
        ) {
            const message =
                normalizeMessage(
                    messages[i]
                );

            if (
                message.role === "user"
            ) {
                lastUser = message;
                break;
            }
        }

        if (!lastUser) {
            toast(
                "Нет сообщения для повторной генерации.",
                "error"
            );

            return;
        }

        setInputValue(
            lastUser.content
        );

        await sendMessage();

    } catch (error) {
        console.error(
            "regenerateLastMessage:",
            error
        );

        toast(
            error.message ||
            "Не удалось повторить сообщение.",
            "error"
        );
    }
}


/* =========================================================
   FILES
   ========================================================= */

function getFileInput() {
    return (
        $("fileInput") ||
        $("attachInput") ||
        $("attachmentInput") ||
        null
    );
}


function validateFile(file) {
    if (!file) {
        return {
            ok: false,
            reason: "Файл не выбран."
        };
    }

    /*
     * Максимальный размер клиента.
     * Реальный лимит обязательно должен
     * проверяться и на backend.
     */
    const MAX_SIZE =
        50 * 1024 * 1024;

    if (file.size > MAX_SIZE) {
        return {
            ok: false,
            reason:
                `${file.name}: файл слишком большой.`
        };
    }

    return {
        ok: true
    };
}


function addPendingFiles(files) {
    if (!files) {
        return;
    }

    const incoming =
        Array.from(files);

    for (const file of incoming) {
        const validation =
            validateFile(file);

        if (!validation.ok) {
            toast(
                validation.reason,
                "error"
            );

            continue;
        }

        /*
         * Не добавляем один и тот же файл
         * дважды по имени + размеру.
         */
        const exists =
            state.pendingFiles.some(
                existing =>
                    existing.name === file.name &&
                    existing.size === file.size &&
                    existing.lastModified ===
                        file.lastModified
            );

        if (!exists) {
            state.pendingFiles.push(file);
        }
    }

    renderPendingFiles();
}


function removePendingFile(index) {
    if (
        index < 0 ||
        index >= state.pendingFiles.length
    ) {
        return;
    }

    state.pendingFiles.splice(
        index,
        1
    );

    renderPendingFiles();
}


function clearPendingFiles() {
    state.pendingFiles = [];

    renderPendingFiles();
}


function renderPendingFiles() {
    const container =
        $("pendingFiles");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    state.pendingFiles.forEach(
        (file, index) => {
            const item =
                document.createElement("div");

            item.className =
                "pending-file";

            const name =
                document.createElement("span");

            name.className =
                "pending-file-name";

            name.textContent =
                file.name;

            const size =
                document.createElement("span");

            size.className =
                "pending-file-size";

            size.textContent =
                formatFileSize(
                    file.size
                );

            const remove =
                document.createElement("button");

            remove.type = "button";
            remove.className =
                "pending-file-remove";

            remove.textContent =
                "Удалить";

            remove.addEventListener(
                "click",
                () => {
                    removePendingFile(
                        index
                    );
                }
            );

            item.appendChild(name);
            item.appendChild(size);
            item.appendChild(remove);

            container.appendChild(item);
        }
    );
}


function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) {
        return "";
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${(
            bytes /
            (1024 * 1024)
        ).toFixed(1)} MB`;
    }

    return `${(
        bytes /
        (1024 * 1024 * 1024)
    ).toFixed(1)} GB`;
}


/* =========================================================
   FILE UPLOAD
   ========================================================= */

async function uploadFile(file) {
    const formData =
        new FormData();

    formData.append(
        "file",
        file
    );

    const result =
        await api(
            "/v1/files/upload",
            {
                method: "POST",
                body: formData
            }
        );

    const uploaded =
        result?.file ||
        result;

    const id =
        uploaded?.id ||
        uploaded?.file_id ||
        result?.file_id ||
        null;

    if (!id) {
        throw new Error(
            `Сервер не вернул ID файла: ${file.name}`
        );
    }

    return id;
}


async function uploadPendingFiles() {
    const files =
        state.pendingFiles.slice();

    if (!files.length) {
        return [];
    }

    const ids = [];

    for (const file of files) {
        try {
            const id =
                await uploadFile(file);

            ids.push(id);

        } catch (error) {
            console.error(
                "uploadFile:",
                error
            );

            toast(
                `${file.name}: ${error.message}`,
                "error"
            );
        }
    }

    /*
     * После отправки очищаем pending.
     */
    state.pendingFiles = [];

    return ids;
}


/* =========================================================
   FILE LIST
   ========================================================= */

async function loadFiles() {
    try {
        const result =
            await api("/v1/files");

        const files =
            Array.isArray(result)
                ? result
                : Array.isArray(result?.files)
                    ? result.files
                    : Array.isArray(result?.data)
                        ? result.data
                        : [];

        renderFileList(files);

    } catch (error) {
        console.error(
            "loadFiles:",
            error
        );

        toast(
            error.message ||
            "Не удалось загрузить файлы.",
            "error"
        );
    }
}


function renderFileList(files) {
    const container =
        $("fileList");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    for (const file of files) {
        const item =
            document.createElement("div");

        item.className =
            "file-list-item";

        const name =
            document.createElement("span");

        name.textContent =
            file?.name ||
            file?.filename ||
            "Файл";

        const deleteButton =
            document.createElement("button");

        deleteButton.type = "button";
        deleteButton.textContent =
            "Удалить";

        const id =
            file?.id ||
            file?.file_id;

        deleteButton.addEventListener(
            "click",
            () => {
                deleteFile(id);
            }
        );

        item.appendChild(name);
        item.appendChild(deleteButton);

        container.appendChild(item);
    }
}


async function deleteFile(fileId) {
    if (!fileId) {
        return;
    }

    try {
        await api(
            `/v1/files/${encodeURIComponent(fileId)}`,
            {
                method: "DELETE"
            }
        );

        await loadFiles();

        toast(
            "Файл удалён.",
            "success"
        );

    } catch (error) {
        console.error(
            "deleteFile:",
            error
        );

        toast(
            error.message ||
            "Не удалось удалить файл.",
            "error"
        );
    }
}
/* =========================================================
   MEDIA DOWNLOAD
   ========================================================= */

async function downloadMedia() {
    const input =
        $("mediaUrl") ||
        $("mediaInput") ||
        $("downloadUrl");

    if (!input) {
        toast(
            "Поле ссылки для скачивания не найдено.",
            "error"
        );

        return;
    }

    const url =
        input.value.trim();

    if (!url) {
        toast(
            "Введите ссылку.",
            "error"
        );

        input.focus();

        return;
    }

    try {
        const result =
            await api(
                "/v1/media/download",
                {
                    method: "POST",
                    body: {
                        url
                    }
                }
            );

        /*
         * Backend может вернуть:
         * - прямой URL;
         * - filename;
         * - data;
         * - объект результата.
         */

        const downloadUrl =
            result?.download_url ||
            result?.url ||
            result?.file_url ||
            null;

        if (downloadUrl) {
            const link =
                document.createElement("a");

            link.href =
                downloadUrl;

            link.target = "_blank";
            link.rel = "noopener noreferrer";

            document.body.appendChild(link);

            link.click();

            link.remove();

            toast(
                "Ссылка на файл получена.",
                "success"
            );

            return;
        }

        toast(
            result?.message ||
            "Запрос на скачивание выполнен.",
            "success"
        );

    } catch (error) {
        console.error(
            "downloadMedia:",
            error
        );

        toast(
            error.message ||
            "Не удалось скачать медиа.",
            "error"
        );
    }
}


/* =========================================================
   PAGE NAVIGATION
   ========================================================= */

function getPageElements() {
    return {
        chat:
            $("chatPage") ||
            $("chatSection") ||
            document.querySelector(
                ".chat-page"
            ),

        home:
            $("homePage") ||
            document.querySelector(
                ".home-page"
            ),

        chats:
            $("chatsPage") ||
            document.querySelector(
                ".chats-page"
            ),

        files:
            $("filesPage") ||
            document.querySelector(
                ".files-page"
            ),

        settings:
            $("settingsPage") ||
            document.querySelector(
                ".settings-page"
            ),

        profile:
            $("profilePage") ||
            document.querySelector(
                ".profile-page"
            )
    };
}


function showPage(page) {
    const pages =
        getPageElements();

    state.page =
        page || "chat";

    /*
     * Сначала скрываем страницы,
     * которые реально существуют.
     */
    Object.entries(pages)
        .forEach(
            ([name, element]) => {
                if (!element) {
                    return;
                }

                element.hidden =
                    name !== state.page;

                element.classList.toggle(
                    "active",
                    name === state.page
                );
            }
        );

    /*
     * Если HTML использует только
     * один chat container, гарантируем
     * его отображение.
     */
    if (
        state.page === "chat" &&
        !pages.chat
    ) {
        const chatScroll =
            $("chatScroll");

        if (chatScroll) {
            chatScroll.hidden = false;
        }
    }

    /*
     * Обновляем активную кнопку меню.
     */
    document
        .querySelectorAll(
            "[data-page]"
        )
        .forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.page ===
                    state.page
            );
        });

    if (state.page === "files") {
        loadFiles();
    }

    if (state.page === "chat") {
        requestAnimationFrame(() => {
            scrollChatToBottom(false);
            focusInput();
        });
    }
}


/* =========================================================
   SIDEBAR
   ========================================================= */

function openSidebar() {
    const sidebar =
        $("sidebar");

    if (!sidebar) {
        return;
    }

    sidebar.classList.add("open");

    document.body.classList.add(
        "sidebar-open"
    );
}


function closeSidebar() {
    const sidebar =
        $("sidebar");

    if (!sidebar) {
        return;
    }

    sidebar.classList.remove("open");

    document.body.classList.remove(
        "sidebar-open"
    );
}


function toggleSidebar() {
    const sidebar =
        $("sidebar");

    if (!sidebar) {
        return;
    }

    if (
        sidebar.classList.contains("open")
    ) {
        closeSidebar();
    } else {
        openSidebar();
    }
}


/* =========================================================
   MODALS
   ========================================================= */

function openModal(id) {
    const modal = $(id);

    if (!modal) {
        return;
    }

    modal.hidden = false;

    modal.classList.add("open");
}


function closeModal(id) {
    const modal = $(id);

    if (!modal) {
        return;
    }

    modal.hidden = true;

    modal.classList.remove("open");
}


function bindModalCloseButtons() {
    document
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    closeModal(
                        button.dataset.closeModal
                    );
                }
            );
        });

    document
        .querySelectorAll(".modal")
        .forEach(modal => {
            modal.addEventListener(
                "click",
                event => {
                    if (
                        event.target === modal
                    ) {
                        modal.hidden = true;
                        modal.classList.remove(
                            "open"
                        );
                    }
                }
            );
        });
}


/* =========================================================
   PASSWORD RESET
   ========================================================= */

async function forgotPassword(email) {
    if (!email) {
        toast(
            "Введите email.",
            "error"
        );

        return;
    }

    try {
        await api(
            "/v1/auth/forgot-password",
            {
                method: "POST",
                body: {
                    email
                }
            }
        );

        toast(
            "Если такой аккаунт существует, инструкция отправлена на email.",
            "success"
        );

    } catch (error) {
        console.error(
            "forgotPassword:",
            error
        );

        toast(
            error.message ||
            "Не удалось выполнить запрос.",
            "error"
        );
    }
}


async function resetPassword(
    token,
    password
) {
    if (!token) {
        toast(
            "Отсутствует токен сброса.",
            "error"
        );

        return;
    }

    if (!password) {
        toast(
            "Введите новый пароль.",
            "error"
        );

        return;
    }

    try {
        await api(
            "/v1/auth/reset-password",
            {
                method: "POST",
                body: {
                    token,
                    password
                }
            }
        );

        toast(
            "Пароль изменён.",
            "success"
        );

        closeModal("resetModal");
        openAuth("login");

    } catch (error) {
        console.error(
            "resetPassword:",
            error
        );

        toast(
            error.message ||
            "Не удалось изменить пароль.",
            "error"
        );
    }
}


async function changePassword(
    currentPassword,
    newPassword
) {
    if (
        !currentPassword ||
        !newPassword
    ) {
        toast(
            "Заполните оба поля.",
            "error"
        );

        return;
    }

    try {
        await api(
            "/v1/auth/change-password",
            {
                method: "POST",
                body: {
                    current_password:
                        currentPassword,

                    new_password:
                        newPassword
                }
            }
        );

        toast(
            "Пароль успешно изменён.",
            "success"
        );

    } catch (error) {
        console.error(
            "changePassword:",
            error
        );

        toast(
            error.message ||
            "Не удалось изменить пароль.",
            "error"
        );
    }
}


/* =========================================================
   GOOGLE AUTH
   ========================================================= */

async function loadGoogleConfig() {
    try {
        const result =
            await api(
                "/v1/auth/google-config"
            );

        state.googleEnabled =
            Boolean(
                result?.enabled ??
                result?.configured ??
                result?.client_id
            );

    } catch (error) {
        console.warn(
            "Google config unavailable:",
            error
        );

        state.googleEnabled = false;
    }

    updateOAuthButtons();
}


function updateOAuthButtons() {
    const googleButton =
        $("googleLogin");

    if (googleButton) {
        googleButton.hidden =
            !state.googleEnabled;
    }
}


function startGoogleSignIn() {
    window.location.href =
        "/v1/auth/google/start";
}


function startAppleSignIn() {
    window.location.href =
        "/v1/auth/apple/start";
}


async function finalizeOAuth() {
    if (!state.oauthCode) {
        return;
    }

    try {
        const result =
            await api(
                "/v1/auth/oauth/finalize",
                {
                    method: "POST",
                    body: {
                        code:
                            state.oauthCode
                    }
                }
            );

        const token =
            result?.access_token ||
            result?.token ||
            "";

        const user =
            result?.user ||
            null;

        if (!token) {
            throw new Error(
                "OAuth не вернул токен."
            );
        }

        saveAuth(
            token,
            user
        );

        /*
         * Удаляем oauth_code из URL.
         */
        const url =
            new URL(
                window.location.href
            );

        url.searchParams.delete(
            "oauth_code"
        );

        url.searchParams.delete(
            "oauth_error"
        );

        window.history.replaceState(
            {},
            "",
            url.toString()
        );

        toast(
            "Авторизация выполнена.",
            "success"
        );

        await bootApp();

    } catch (error) {
        console.error(
            "finalizeOAuth:",
            error
        );

        toast(
            error.message ||
            "Не удалось завершить авторизацию.",
            "error"
        );
    }
}


/* =========================================================
   SETTINGS UI
   ========================================================= */

function updateTemperatureLabel() {
    const input =
        $("temperature");

    const output =
        $("temperatureValue");

    if (!input || !output) {
        return;
    }

    output.textContent =
        Number(input.value)
            .toFixed(2);
}


function updateMaxTokensLabel() {
    const input =
        $("maxTokens");

    const output =
        $("maxTokensValue");

    if (!input || !output) {
        return;
    }

    output.textContent =
        String(
            Math.floor(
                Number(input.value)
            )
        );
}


function loadSettingsIntoUI() {
    const temperature =
        $("temperature");

    if (temperature) {
        temperature.value =
            state.temperature;
    }

    const maxTokens =
        $("maxTokens");

    if (maxTokens) {
        maxTokens.value =
            state.maxTokens;
    }

    updateTemperatureLabel();
    updateMaxTokensLabel();
}


function saveModelPreference() {
    const model =
        getSelectedModel();

    if (model) {
        localStorage.setItem(
            "nova_model",
            model
        );
    }
}


/* =========================================================
   PROVIDER / MODEL EVENTS
   ========================================================= */

function bindProviderAndModel() {
    const provider =
        $("providerSelect");

    if (provider) {
        provider.addEventListener(
            "change",
            () => {
                renderModels();
                saveSettings();
            }
        );
    }

    const model =
        $("modelSelect");

    if (model) {
        model.addEventListener(
            "change",
            () => {
                saveModelPreference();
            }
        );
    }

    const temperature =
        $("temperature");

    if (temperature) {
        temperature.addEventListener(
            "input",
            () => {
                updateTemperatureLabel();
                saveSettings();
            }
        );
    }

    const maxTokens =
        $("maxTokens");

    if (maxTokens) {
        maxTokens.addEventListener(
            "input",
            () => {
                updateMaxTokensLabel();
                saveSettings();
            }
        );
    }
}


/* =========================================================
   AUTH FORM BINDING
   ========================================================= */

function bindAuthForms() {
    const loginForm =
        $("loginForm");

    if (loginForm) {
        loginForm.addEventListener(
            "submit",
            event => {
                event.preventDefault();

                const email =
                    loginForm.querySelector(
                        '[name="email"]'
                    )?.value.trim() || "";

                const password =
                    loginForm.querySelector(
                        '[name="password"]'
                    )?.value || "";

                login(
                    email,
                    password
                );
            }
        );
    }


    const registerForm =
        $("registerForm");

    if (registerForm) {
        registerForm.addEventListener(
            "submit",
            event => {
                event.preventDefault();

                const name =
                    registerForm.querySelector(
                        '[name="name"]'
                    )?.value.trim() || "";

                const email =
                    registerForm.querySelector(
                        '[name="email"]'
                    )?.value.trim() || "";

                const password =
                    registerForm.querySelector(
                        '[name="password"]'
                    )?.value || "";

                register(
                    name,
                    email,
                    password
                );
            }
        );
    }


    document
        .querySelectorAll(
            "[data-auth-mode]"
        )
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    setAuthMode(
                        button.dataset.authMode
                    );
                }
            );
        });


    const forgotForm =
        $("forgotPasswordForm");

    if (forgotForm) {
        forgotForm.addEventListener(
            "submit",
            event => {
                event.preventDefault();

                const email =
                    forgotForm.querySelector(
                        '[name="email"]'
                    )?.value.trim() || "";

                forgotPassword(email);
            }
        );
    }


    const changePasswordForm =
        $("changePasswordForm");

    if (changePasswordForm) {
        changePasswordForm.addEventListener(
            "submit",
            event => {
                event.preventDefault();

                const currentPassword =
                    changePasswordForm.querySelector(
                        '[name="current_password"]'
                    )?.value || "";

                const newPassword =
                    changePasswordForm.querySelector(
                        '[name="new_password"]'
                    )?.value || "";

                changePassword(
                    currentPassword,
                    newPassword
                );
            }
        );
    }


    const resetForm =
        $("resetPasswordForm");

    if (resetForm) {
        resetForm.addEventListener(
            "submit",
            event => {
                event.preventDefault();

                const password =
                    resetForm.querySelector(
                        '[name="password"]'
                    )?.value || "";

                resetPassword(
                    state.resetToken,
                    password
                );
            }
        );
    }
}


/* =========================================================
   CHAT INPUT EVENTS
   ========================================================= */

function bindChatInput() {
    const input =
        getChatInput();

    if (!input) {
        return;
    }

    input.addEventListener(
        "input",
        resizeTextarea
    );

    input.addEventListener(
        "keydown",
        event => {
            /*
             * Enter отправляет.
             * Shift+Enter переносит строку.
             */
            if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.isComposing
            ) {
                event.preventDefault();

                sendMessage();
            }
        }
    );

    resizeTextarea();
}


function bindSendButton() {
    const button =
        $("sendButton");

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        event => {
            event.preventDefault();

            sendMessage();
        }
    );
}


/* =========================================================
   FILE INPUT EVENTS
   ========================================================= */

function bindFileInput() {
    const input =
        getFileInput();

    if (!input) {
        return;
    }

    input.addEventListener(
        "change",
        event => {
            addPendingFiles(
                event.target.files
            );

            /*
             * Чтобы повторно можно было
             * выбрать тот же файл.
             */
            input.value = "";
        }
    );
}


function openFilePicker() {
    const input =
        getFileInput();

    if (!input) {
        toast(
            "Поле загрузки файла не найдено.",
            "error"
        );

        return;
    }

    input.click();
}


function bindAttachButton() {
    const button =
        $("attachButton") ||
        $("fileButton") ||
        $("plusButton");

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        event => {
            event.preventDefault();

            openFilePicker();
        }
    );
}


/* =========================================================
   NAVIGATION EVENTS
   ========================================================= */

function bindNavigation() {
    document
        .querySelectorAll(
            "[data-page]"
        )
        .forEach(button => {
            button.addEventListener(
                "click",
                event => {
                    event.preventDefault();

                    showPage(
                        button.dataset.page
                    );

                    /*
                     * На мобильном закрываем
                     * sidebar после перехода.
                     */
                    if (
                        window.innerWidth <= 900
                    ) {
                        closeSidebar();
                    }
                }
            );
        });


    const newChatButton =
        $("newChatButton") ||
        $("newChat");

    if (newChatButton) {
        newChatButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                newChat();
            }
        );
    }


    const clearButton =
        $("clearChatButton") ||
        $("clearChat");

    if (clearButton) {
        clearButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                clearCurrentChat();
            }
        );
    }


    const deleteButton =
        $("deleteChatButton") ||
        $("deleteChat");

    if (deleteButton) {
        deleteButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                deleteCurrentChat();
            }
        );
    }


    const logoutButton =
        $("logoutButton") ||
        $("logout");

    if (logoutButton) {
        logoutButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                logout();
            }
        );
    }


    const menuButton =
        $("menuButton") ||
        $("sidebarToggle") ||
        $("mobileMenu");

    if (menuButton) {
        menuButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                toggleSidebar();
            }
        );
    }
}


/* =========================================================
   SUPPORT
   ========================================================= */

function bindSupportButtons() {
    const buttons =
        document.querySelectorAll(
            "[data-support], #supportButton, #telegramSupport"
        );

    buttons.forEach(button => {
        button.addEventListener(
            "click",
            event => {
                event.preventDefault();

                const url =
                    button.dataset.supportUrl ||
                    "https://t.me/NovaAI_HelpBot";

                window.open(
                    url,
                    "_blank",
                    "noopener,noreferrer"
                );
            }
        );
    });
}


/* =========================================================
   AUTH BUTTONS
   ========================================================= */

function bindAuthButtons() {
    const loginButton =
        $("loginButton");

    if (loginButton) {
        loginButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                openAuth("login");
            }
        );
    }


    const registerButton =
        $("registerButton");

    if (registerButton) {
        registerButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                openAuth("register");
            }
        );
    }


    const closeAuthButton =
        $("closeAuth");

    if (closeAuthButton) {
        closeAuthButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                closeAuth();
            }
        );
    }


    const googleButton =
        $("googleLogin");

    if (googleButton) {
        googleButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                startGoogleSignIn();
            }
        );
    }


    const appleButton =
        $("appleLogin");

    if (appleButton) {
        appleButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                startAppleSignIn();
            }
        );
    }
}


/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */

function bindKeyboardShortcuts() {
    document.addEventListener(
        "keydown",
        event => {
            /*
             * Ctrl/Cmd + K
             * новый чат
             */
            if (
                (event.ctrlKey ||
                    event.metaKey) &&
                event.key.toLowerCase() === "k"
            ) {
                event.preventDefault();

                newChat();

                return;
            }


            /*
             * Escape
             */
            if (event.key === "Escape") {
                closeSidebar();
                closeAuth();

                document
                    .querySelectorAll(
                        ".modal.open"
                    )
                    .forEach(modal => {
                        modal.hidden = true;
                        modal.classList.remove(
                            "open"
                        );
                    });
            }
        }
    );
}


/* =========================================================
   ONLINE STATUS
   ========================================================= */

function updateConnectionStatus() {
    const element =
        $("connectionStatus");

    if (!element) {
        return;
    }

    if (navigator.onLine) {
        element.textContent =
            "Подключено";

        element.classList.remove(
            "offline"
        );

        element.classList.add(
            "online"
        );
    } else {
        element.textContent =
            "Нет подключения";

        element.classList.remove(
            "online"
        );

        element.classList.add(
            "offline"
        );
    }
}


function bindConnectionStatus() {
    window.addEventListener(
        "online",
        updateConnectionStatus
    );

    window.addEventListener(
        "offline",
        updateConnectionStatus
    );

    updateConnectionStatus();
}


/* =========================================================
   UI INITIALIZATION
   ========================================================= */

function initializeUI() {
    loadSettingsIntoUI();

    bindProviderAndModel();

    bindAuthForms();

    bindChatInput();

    bindSendButton();

    bindFileInput();

    bindAttachButton();

    bindNavigation();

    bindSupportButtons();

    bindAuthButtons();

    bindModalCloseButtons();

    bindKeyboardShortcuts();

    bindConnectionStatus();

    updateAuthUI();

    updateProviderStatus();

    showPage("chat");
}


/* =========================================================
   BOOT
   ========================================================= */

async function bootApp() {
    initializeUI();

    const authenticated =
        await authenticate();

    if (!authenticated) {
        updateAuthUI();

        /*
         * Интерфейс чата всё равно оставляем
         * доступным визуально.
         * При отправке сообщения предложим вход.
         */
        showPage("chat");

        await loadModels();
        return;
    }

    updateAuthUI();

    await Promise.all([
        loadModels(),
        loadGoogleConfig()
    ]);

    await loadChats();

    showPage("chat");

    requestAnimationFrame(() => {
        focusInput();
        scrollChatToBottom(false);
    });
}


/* =========================================================
   DOM READY
   ========================================================= */

let novaInitialized = false;

async function initNova() {
    if (novaInitialized) {
        return;
    }

    novaInitialized = true;

    try {
        await bootApp();
    } catch (error) {
        console.error(
            "Nova initialization error:",
            error
        );

        toast(
            "Не удалось полностью загрузить Nova AI.",
            "error"
        );
    }
}


if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initNova,
        {
            once: true
        }
    );
} else {
    initNova();
}
/* =========================================================
   EXTRA HTML COMPATIBILITY
   ========================================================= */

/*
 * В твоём HTML названия некоторых элементов могут
 * отличаться. Здесь делаем совместимость без изменения
 * самого HTML.
 */

function findFirst(...ids) {
    for (const id of ids) {
        const element = $(id);

        if (element) {
            return element;
        }
    }

    return null;
}


/* =========================================================
   SIDEBAR OVERLAY
   ========================================================= */

function createSidebarOverlay() {
    if (
        $("sidebarOverlay") ||
        !document.querySelector("#sidebar")
    ) {
        return;
    }

    const overlay =
        document.createElement("div");

    overlay.id =
        "sidebarOverlay";

    overlay.className =
        "sidebar-overlay";

    overlay.hidden = true;

    overlay.addEventListener(
        "click",
        closeSidebar
    );

    document.body.appendChild(
        overlay
    );
}


function syncSidebarOverlay() {
    const overlay =
        $("sidebarOverlay");

    const sidebar =
        $("sidebar");

    if (!overlay || !sidebar) {
        return;
    }

    const open =
        sidebar.classList.contains(
            "open"
        );

    overlay.hidden = !open;
}


/* =========================================================
   PATCH SIDEBAR FUNCTIONS
   ========================================================= */

const originalOpenSidebar =
    openSidebar;

const originalCloseSidebar =
    closeSidebar;

openSidebar = function () {
    originalOpenSidebar();

    syncSidebarOverlay();
};


closeSidebar = function () {
    originalCloseSidebar();

    syncSidebarOverlay();
};


/* =========================================================
   AUTO RESIZE CHAT INPUT
   ========================================================= */

function observeChatInput() {
    const input =
        getChatInput();

    if (!input) {
        return;
    }

    if (
        input.tagName !== "TEXTAREA"
    ) {
        return;
    }

    const observer =
        new MutationObserver(
            () => {
                resizeTextarea();
            }
        );

    observer.observe(
        input,
        {
            attributes: true
        }
    );
}


/* =========================================================
   FILE PREVIEW
   ========================================================= */

function createImagePreview(file) {
    if (!file) {
        return null;
    }

    if (
        !file.type ||
        !file.type.startsWith("image/")
    ) {
        return null;
    }

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "pending-image-preview";

    const image =
        document.createElement("img");

    image.alt =
        file.name;

    image.loading =
        "lazy";

    const url =
        URL.createObjectURL(file);

    image.src =
        url;

    image.addEventListener(
        "load",
        () => {
            URL.revokeObjectURL(url);
        },
        {
            once: true
        }
    );

    wrapper.appendChild(
        image
    );

    return wrapper;
}


/* =========================================================
   ENHANCED PENDING FILE RENDER
   ========================================================= */

const originalRenderPendingFiles =
    renderPendingFiles;

renderPendingFiles = function () {
    originalRenderPendingFiles();

    const container =
        $("pendingFiles");

    if (!container) {
        return;
    }

    /*
     * Добавляем превью изображений,
     * не меняя существующую структуру.
     */
    const items =
        container.children;

    state.pendingFiles.forEach(
        (file, index) => {
            const item =
                items[index];

            if (!item) {
                return;
            }

            if (
                file.type &&
                file.type.startsWith("image/")
            ) {
                const preview =
                    createImagePreview(
                        file
                    );

                if (preview) {
                    item.prepend(
                        preview
                    );
                }
            }
        }
    );
};


/* =========================================================
   DRAG & DROP
   ========================================================= */

function bindDragAndDrop() {
    const area =
        $("chatScroll") ||
        document.querySelector(
            ".chat-scroll"
        ) ||
        document.body;

    if (!area) {
        return;
    }

    let dragCounter = 0;

    area.addEventListener(
        "dragenter",
        event => {
            event.preventDefault();

            dragCounter++;

            area.classList.add(
                "drag-over"
            );
        }
    );

    area.addEventListener(
        "dragover",
        event => {
            event.preventDefault();
        }
    );

    area.addEventListener(
        "dragleave",
        event => {
            event.preventDefault();

            dragCounter--;

            if (dragCounter <= 0) {
                dragCounter = 0;

                area.classList.remove(
                    "drag-over"
                );
            }
        }
    );

    area.addEventListener(
        "drop",
        event => {
            event.preventDefault();

            dragCounter = 0;

            area.classList.remove(
                "drag-over"
            );

            if (
                event.dataTransfer?.files
            ) {
                addPendingFiles(
                    event.dataTransfer.files
                );
            }
        }
    );
}


/* =========================================================
   PASTE IMAGE
   ========================================================= */

function bindPasteFiles() {
    const input =
        getChatInput();

    if (!input) {
        return;
    }

    input.addEventListener(
        "paste",
        event => {
            const items =
                event.clipboardData?.items;

            if (!items) {
                return;
            }

            const files = [];

            for (
                const item of items
            ) {
                if (
                    item.kind === "file"
                ) {
                    const file =
                        item.getAsFile();

                    if (file) {
                        files.push(file);
                    }
                }
            }

            if (files.length) {
                addPendingFiles(
                    files
                );
            }
        }
    );
}


/* =========================================================
   IMAGE PREVIEW IN MESSAGE
   ========================================================= */

function appendFileInformation(
    element,
    files
) {
    if (
        !element ||
        !Array.isArray(files) ||
        !files.length
    ) {
        return;
    }

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "message-files";

    for (const file of files) {
        const item =
            document.createElement("div");

        item.className =
            "message-file";

        item.textContent =
            file?.name ||
            file?.filename ||
            "Файл";

        wrapper.appendChild(
            item
        );
    }

    element.appendChild(
        wrapper
    );
}


/* =========================================================
   MESSAGE NORMALIZATION — FILES
   ========================================================= */

function getMessageFiles(message) {
    if (
        Array.isArray(message?.files)
    ) {
        return message.files;
    }

    if (
        Array.isArray(message?.attachments)
    ) {
        return message.attachments;
    }

    return [];
}


/* =========================================================
   PATCH MESSAGE ELEMENT
   ========================================================= */

const originalCreateMessageElement =
    createMessageElement;

createMessageElement = function (
    message
) {
    const element =
        originalCreateMessageElement(
            message
        );

    const files =
        getMessageFiles(message);

    appendFileInformation(
        element,
        files
    );

    return element;
};


/* =========================================================
   CHAT TITLE
   ========================================================= */

function updateCurrentChatTitle(
    title
) {
    if (!title) {
        return;
    }

    const selectors = [
        "#chatTitle",
        "#currentChatTitle",
        ".chat-title"
    ];

    for (
        const selector of selectors
    ) {
        const element =
            document.querySelector(
                selector
            );

        if (element) {
            element.textContent =
                title;
        }
    }
}


/* =========================================================
   PATCH OPEN CHAT
   ========================================================= */

const originalOpenChat =
    openChat;

openChat = async function (
    chatId,
    updatePage = true
) {
    await originalOpenChat(
        chatId,
        updatePage
    );

    const chat =
        state.chats.find(
            item =>
                String(
                    getChatId(item)
                ) ===
                String(chatId)
        );

    if (chat) {
        updateCurrentChatTitle(
            getChatTitle(chat)
        );
    }
};


/* =========================================================
   CHAT SEARCH
   ========================================================= */

function createChatSearch() {
    const list =
        $("chatList");

    if (!list) {
        return;
    }

    const existing =
        $("chatSearch");

    if (existing) {
        return;
    }

    const input =
        document.createElement("input");

    input.id =
        "chatSearch";

    input.type =
        "search";

    input.placeholder =
        "Поиск чатов";

    input.autocomplete =
        "off";

    input.className =
        "chat-search";

    list.parentElement?.insertBefore(
        input,
        list
    );

    input.addEventListener(
        "input",
        () => {
            const query =
                input.value
                    .trim()
                    .toLowerCase();

            list
                .querySelectorAll(
                    ".chat-history-item"
                )
                .forEach(item => {
                    const text =
                        item.textContent
                            .toLowerCase();

                    item.hidden =
                        !!query &&
                        !text.includes(
                            query
                        );
                });
        }
    );
}


/* =========================================================
   PATCH CHAT LIST
   ========================================================= */

const originalRenderChatList =
    renderChatList;

renderChatList = function () {
    originalRenderChatList();

    const search =
        $("chatSearch");

    if (search) {
        const query =
            search.value
                .trim()
                .toLowerCase();

        document
            .querySelectorAll(
                "#chatList .chat-history-item"
            )
            .forEach(item => {
                const text =
                    item.textContent
                        .toLowerCase();

                item.hidden =
                    !!query &&
                    !text.includes(
                        query
                    );
            });
    }
};


/* =========================================================
   MODEL DISPLAY
   ========================================================= */

function updateModelLabel() {
    const select =
        $("modelSelect");

    if (!select) {
        return;
    }

    const selected =
        select.options[
            select.selectedIndex
        ];

    if (!selected) {
        return;
    }

    const labels = [
        "currentModel",
        "selectedModel",
        "modelName"
    ];

    for (
        const id of labels
    ) {
        const element =
            $(id);

        if (element) {
            element.textContent =
                selected.textContent;
        }
    }
}


/* =========================================================
   PATCH MODEL RENDER
   ========================================================= */

const originalRenderModels =
    renderModels;

renderModels = function (
    preferredModel = null
) {
    originalRenderModels(
        preferredModel
    );

    updateModelLabel();
};


/* =========================================================
   ERROR DISPLAY
   ========================================================= */

function showFatalError(error) {
    console.error(
        "Fatal Nova error:",
        error
    );

    let box =
        $("novaFatalError");

    if (!box) {
        box =
            document.createElement(
                "div"
            );

        box.id =
            "novaFatalError";

        box.style.position =
            "fixed";

        box.style.left =
            "20px";

        box.style.right =
            "20px";

        box.style.bottom =
            "20px";

        box.style.zIndex =
            "999999";

        box.style.padding =
            "14px 16px";

        box.style.borderRadius =
            "12px";

        box.style.background =
            "#1b1111";

        box.style.border =
            "1px solid rgba(255,80,80,.3)";

        box.style.color =
            "#fff";

        document.body.appendChild(
            box
        );
    }

    box.textContent =
        error?.message ||
        "Произошла ошибка.";
}


/* =========================================================
   MOBILE KEYBOARD FIX
   ========================================================= */

function bindMobileKeyboardFix() {
    if (!window.visualViewport) {
        return;
    }

    const update =
        () => {
            document.documentElement
                .style
                .setProperty(
                    "--nova-viewport-height",
                    `${window.visualViewport.height}px`
                );
        };

    window.visualViewport.addEventListener(
        "resize",
        update
    );

    window.visualViewport.addEventListener(
        "scroll",
        update
    );

    update();
}


/* =========================================================
   BEFORE UNLOAD
   ========================================================= */

window.addEventListener(
    "beforeunload",
    () => {
        saveSettings();
    }
);


/* =========================================================
   FINAL INITIALIZATION
   ========================================================= */

const originalInitializeUI =
    initializeUI;

initializeUI = function () {
    originalInitializeUI();

    createSidebarOverlay();

    createChatSearch();

    observeChatInput();

    bindDragAndDrop();

    bindPasteFiles();

    bindMobileKeyboardFix();

    updateModelLabel();

    syncSidebarOverlay();
};


/* =========================================================
   GLOBAL EXPORTS
   ========================================================= */

window.NovaAI = {
    state,

    sendMessage,
    newChat,
    createChat,
    openChat,

    clearCurrentChat,
    deleteCurrentChat,

    logout,

    openAuth,
    closeAuth,

    showPage,

    uploadFile,
    loadFiles,

    downloadMedia,

    copyText,

    renderMarkdown
};


/* =========================================================
   FINAL SAFETY START
   ========================================================= */

window.addEventListener(
    "error",
    event => {
        console.error(
            "Nova runtime error:",
            event.error ||
            event.message
        );
    }
);


window.addEventListener(
    "unhandledrejection",
    event => {
        console.error(
            "Nova promise error:",
            event.reason
        );
    }
);