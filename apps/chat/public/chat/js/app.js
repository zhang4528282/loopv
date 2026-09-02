// ============================================================
// LoopV Chat — 前端逻辑（vanilla JS）
// ============================================================

"use strict";

// ========== 常量 ==========
const TOKEN_KEY = "loopv_chat_token";
const USER_KEY = "loopv_chat_user";
const TZ_KEY = "loopv_chat_timezone";
const NOTICE_KEY = "loopv_chat_notice";
const SOUND_KEY = "loopv_chat_sound";
const MSG_SOUND_KEY = "loopv_chat_msg_sound";
const MAX_HISTORY = 50;

// 常用时区（中文名 + IANA 标识，UTC 偏移由 Intl 动态计算）
const TIMEZONES = [
  { value: "Asia/Shanghai", label: "中国标准时间" },
  { value: "Asia/Hong_Kong", label: "香港" },
  { value: "Asia/Taipei", label: "台北" },
  { value: "Asia/Singapore", label: "新加坡" },
  { value: "Asia/Tokyo", label: "东京" },
  { value: "Asia/Seoul", label: "首尔" },
  { value: "Asia/Bangkok", label: "曼谷" },
  { value: "Asia/Kolkata", label: "印度" },
  { value: "Asia/Dubai", label: "迪拜" },
  { value: "UTC", label: "协调世界时" },
  { value: "Europe/London", label: "伦敦" },
  { value: "Europe/Paris", label: "巴黎" },
  { value: "Europe/Berlin", label: "柏林" },
  { value: "America/New_York", label: "纽约" },
  { value: "America/Chicago", label: "芝加哥" },
  { value: "America/Los_Angeles", label: "洛杉矶" },
  { value: "America/Toronto", label: "多伦多" },
  { value: "Australia/Sydney", label: "悉尼" },
  { value: "Pacific/Auckland", label: "奥克兰" },
];

const EMOJIS = [
  "😀", "😂", "🤣", "😍", "🥰", "😘", "😜", "🤪", "😎", "🤩", "😤", "😭", "😱", "🤯", "🥳", "🫠",
  "👍", "👎", "👏", "🙌", "🤝", "💪", "🫶", "🔥", "💯", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔",
  "🐱", "🐶", "🐼", "🦊", "🐸", "🐵", "🦄", "🐙", "🌸", "🌺", "🌻", "🌙", "⭐", "🌈", "🍕", "🍔", "🍣", "🎉", "🎸", "🚀",
];

const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#06b6d4", "#f97316", "#84cc16", "#14b8a6", "#3b82f6", "#a855f7",
];

// ========== 状态 ==========
const state = {
  token: null,
  user: null, // { id, username, nickname, avatar_url, is_admin }
  ws: null,
  reconnectTimer: null,
  reconnectDelay: 1500,
  intentionalClose: false,
  pendingFile: null, // { file, type }
  pendingAvatar: null, // File | null
  mode: "login", // login | register
  onlineUsers: [], // 在线用户列表
  onlineCount: 0,
  hasConnectedOnce: false, // 是否经历过重连（重连成功需自动补齐历史）
};

// ========== DOM 引用 ==========
const $ = (sel) => document.querySelector(sel);

const dom = {
  // 认证
  authView: $("#auth-view"),
  authForm: $("#auth-form"),
  authUsername: $("#auth-username"),
  authNickname: $("#auth-nickname"),
  authPassword: $("#auth-password"),
  authPasswordConfirm: $("#auth-password-confirm"),
  authInviteCode: $("#auth-invite-code"),
  authError: $("#auth-error"),
  authSubmit: $("#auth-submit"),
  nicknameField: $("#nickname-field"),
  passwordConfirmField: $("#password-confirm-field"),
  inviteCodeField: $("#invite-code-field"),
  tabLogin: $("#tab-login"),
  tabRegister: $("#tab-register"),

  // 聊天
  chatView: $("#chat-view"),
  messages: $("#messages"),
  messagesEmpty: $("#messages-empty"),
  roomName: $("#room-name"),
  meAvatar: $("#me-avatar"),
  meNickname: $("#me-nickname"),
  connDot: $("#conn-dot"),
  presenceNotices: $("#presence-notices"),

  // 输入
  msgInput: $("#msg-input"),
  btnSend: $("#btn-send"),
  btnUpload: $("#btn-upload"),
  fileInput: $("#file-input"),
  btnEmoji: $("#btn-emoji"),
  emojiPicker: $("#emoji-picker"),
  emojiGrid: $("#emoji-grid"),
  uploadPreview: $("#upload-preview"),
  uploadPreviewImg: $("#upload-preview-img"),
  uploadPreviewName: $("#upload-preview-name"),
  btnClearUpload: $("#btn-clear-upload"),

  // 弹窗
  mediaPreview: $("#media-preview"),
  mediaBackdrop: $("#media-backdrop"),
  mediaContent: $("#media-content"),
  mediaClose: $("#media-close"),
  settingsModal: $("#settings-modal"),
  btnSettings: $("#btn-settings"),
  btnCloseSettings: $("#btn-close-settings"),
  nicknameInput: $("#nickname-input"),
  timezoneSelect: $("#timezone-select"),
  settingNotice: $("#setting-notice"),
  settingSound: $("#setting-sound"),
  settingMsgSound: $("#setting-msg-sound"),
  btnSaveSettings: $("#btn-save-settings"),
  settingsAvatarPreview: $("#settings-avatar-preview"),
  btnAvatarUpload: $("#btn-avatar-upload"),
  avatarInput: $("#avatar-input"),

  // 其他
  btnLogout: $("#btn-logout"),
  btnRefresh: $("#btn-refresh"),
  toast: $("#toast"),
  confirmModal: $("#confirm-modal"),
  btnConfirmOk: $("#btn-confirm-ok"),
  btnConfirmCancel: $("#btn-confirm-cancel"),

  // 在线成员
  sidebar: $("#sidebar"),
  sidebarCount: $("#sidebar-count"),
  onlineList: $("#online-list"),
  btnOnline: $("#btn-online"),
  onlineCountBadge: $("#online-count-badge"),
  onlineBackdrop: $("#online-backdrop"),
  btnSidebarClose: $("#btn-sidebar-close"),
};

// ========== 工具函数 ==========
function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  return fetch(path, { ...options, headers }).then(async (res) => {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 无 JSON 响应 */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `请求失败 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  });
}

// 读取用户设置的时区，默认东八区（北京时间）
function getTimezone() {
  return localStorage.getItem(TZ_KEY) || "Asia/Shanghai";
}

// 读取用户设置：上下线提醒（默认关闭）
function getNoticeEnabled() {
  return localStorage.getItem(NOTICE_KEY) === "1";
}

// 读取用户设置：提示音效（默认关闭）
function getSoundEnabled() {
  return localStorage.getItem(SOUND_KEY) === "1";
}

// 读取用户设置：新消息音效（默认关闭）
function getMsgSoundEnabled() {
  return localStorage.getItem(MSG_SOUND_KEY) === "1";
}

// 时间格式化：秒级时间戳 → "2026年08月07日 14:30"（按用户设置的时区）
function formatTime(ts) {
  const date = new Date((ts || Math.floor(Date.now() / 1000)) * 1000);
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: getTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}年${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

// 计算某时区当前的 UTC 偏移（如 "GMT+8"、"GMT-5"、"GMT+5:30"）
function tzOffset(iana) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      timeZoneName: "shortOffset",
    });
    const parts = dtf.formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch {
    return "";
  }
}

// 填充时区下拉选项（中文名 + 动态 UTC 偏移）
function buildTimezoneOptions() {
  dom.timezoneSelect.innerHTML = "";
  for (const tz of TIMEZONES) {
    const opt = document.createElement("option");
    opt.value = tz.value;
    const offset = tzOffset(tz.value);
    opt.textContent = offset ? `${tz.label} · ${offset}` : tz.label;
    dom.timezoneSelect.appendChild(opt);
  }
}

function avatarColor(seed) {
  let hash = 0;
  const s = String(seed || "x");
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// 将头像内容（图片或昵称首字）填充到已有元素
function fillAvatar(el, nickname, url) {
  el.innerHTML = "";
  const name = nickname || "?";
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = name;
    img.loading = "lazy";
    img.onerror = () => {
      img.remove();
      el.textContent = name.charAt(0).toUpperCase();
      el.style.background = avatarColor(name);
    };
    el.appendChild(img);
    el.style.background = "";
  } else {
    el.textContent = name.charAt(0).toUpperCase();
    el.style.background = avatarColor(name);
  }
}

// 创建头像元素（有图片显示图片，否则昵称首字彩色圆底）
function createAvatar(nickname, url, extraClass) {
  const el = document.createElement("div");
  el.className = extraClass || "msg-avatar";
  fillAvatar(el, nickname, url);
  return el;
}

function toast(message, type = "info", duration = 2600) {
  dom.toast.textContent = message;
  dom.toast.className = "toast show" + (type === "error" ? " error" : type === "success" ? " success" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    dom.toast.classList.remove("show");
  }, duration);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 判断内容是否纯表情（用于大字号表情消息）
function isEmojiOnly(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.length > 8) return false;
  if (/[0-9A-Za-z\u4e00-\u9fff]/.test(trimmed)) return false;
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(trimmed);
}

// ========== 认证 ==========
function setMode(mode) {
  state.mode = mode;
  const isRegister = mode === "register";
  dom.tabLogin.classList.toggle("active", !isRegister);
  dom.tabRegister.classList.toggle("active", isRegister);
  dom.nicknameField.classList.toggle("hidden", !isRegister);
  dom.passwordConfirmField.classList.toggle("hidden", !isRegister);
  dom.inviteCodeField.classList.toggle("hidden", !isRegister);
  dom.authSubmit.textContent = isRegister ? "注 册" : "登 录";
  dom.authError.textContent = "";
  dom.authPassword.setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
  // 切换模式时清空确认密码框和邀请码框，并重置密码可见性
  dom.authPasswordConfirm.value = "";
  dom.authInviteCode.value = "";
  resetPasswordVisibility();
}

// 重置密码框可见性（默认隐藏密码）
function resetPasswordVisibility() {
  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.classList.remove("show");
    btn.setAttribute("aria-label", "显示密码");
    btn.setAttribute("aria-pressed", "false");
    const input = document.getElementById(btn.dataset.target);
    if (input) input.type = "password";
  });
}

function showAuth() {
  dom.chatView.classList.add("hidden");
  dom.authView.classList.remove("hidden");
  setMode(state.mode);
}

function showChat() {
  dom.authView.classList.add("hidden");
  dom.chatView.classList.remove("hidden");
  dom.roomName.textContent = "general";
  renderMe();
}

function renderMe() {
  const user = state.user;
  if (!user) return;
  dom.meNickname.textContent = user.nickname || user.username;
  dom.meNickname.title = user.nickname || user.username;
  fillAvatar(dom.meAvatar, user.nickname || user.username, user.avatar_url);
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = dom.authUsername.value.trim();
  const password = dom.authPassword.value;
  const nickname = dom.authNickname.value.trim();

  dom.authError.textContent = "";
  if (!username || !password) {
    dom.authError.textContent = "用户名和密码不能为空";
    return;
  }

  // 注册模式：校验两次密码一致
  if (state.mode === "register" && password !== dom.authPasswordConfirm.value) {
    dom.authError.textContent = "两次输入的密码不一致";
    return;
  }

  dom.authSubmit.disabled = true;
  try {
    const endpoint = state.mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const body = state.mode === "register"
      ? { username, password, nickname: nickname || username, invite_code: dom.authInviteCode.value.trim() }
      : { username, password };

    const data = await api(endpoint, { method: "POST", body });
    saveSession(data.token, data.user);
    dom.authForm.reset();
    dom.authSubmit.disabled = false;
    enterChat();
  } catch (err) {
    dom.authError.textContent = err.message;
    dom.authSubmit.disabled = false;
  }
}

async function handleLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* 忽略登出接口错误 */
  }
  state.intentionalClose = true;
  if (state.ws) state.ws.close();
  clearSession();
  showAuth();
}

// 尝试恢复登录态
async function tryRestoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showAuth();
    return;
  }
  state.token = token;
  try {
    const data = await api("/api/auth/me");
    if (data && data.user) {
      state.user = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      enterChat();
      return;
    }
  } catch {
    /* token 失效 */
  }
  clearSession();
  showAuth();
}

function enterChat() {
  showChat();
  state.hasConnectedOnce = false; // 首次进入，重连标记复位（避免重复加载）
  loadHistory();
  connectWs();
}

// ========== 历史消息 ==========
async function loadHistory() {
  try {
    const data = await api(`/api/history?limit=${MAX_HISTORY}`);
    // 清空旧消息，避免重复追加
    dom.messages.innerHTML = "";
    if (data.messages && data.messages.length) {
      dom.messagesEmpty.classList.add("hidden");
      for (const msg of data.messages) {
        appendMessage(msg, false);
      }
    } else {
      dom.messagesEmpty.classList.remove("hidden");
    }
    scrollToBottom(true);
  } catch (err) {
    toast(err.message, "error");
  }
}

// ========== WebSocket ==========
function connectWs() {
  if (!state.token) return;

  clearTimeout(state.reconnectTimer);
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/ws`;

  setConn("connecting");
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    // 连接后立即发送认证
    ws.send(JSON.stringify({ type: "auth", token: state.token }));
  };

  ws.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    handleWsMessage(data);
  };

  ws.onclose = () => {
    if (state.ws !== ws) return;
    if (state.intentionalClose || !state.token) {
      setConn("offline");
      return;
    }
    setConn("offline");
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleWsMessage(data) {
  switch (data.type) {
    case "auth_ok":
      setConn("online");
      state.reconnectDelay = 1500;
      // 以服务端返回为准刷新昵称/头像
      if (data.nickname || data.avatarUrl) {
        const fresh = {
          ...(state.user || {}),
          nickname: data.nickname || state.user?.nickname,
          avatar_url: data.avatarUrl || state.user?.avatar_url || null,
        };
        state.user = fresh;
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
        renderMe();
      }
      // 重连成功后自动补齐断线期间错过的历史消息（首次进入不重复加载）
      if (state.hasConnectedOnce) {
        loadHistory();
      }
      break;

    case "auth_error":
      // token 失效，强制重新登录
      toast(data.message || "登录已失效，请重新登录", "error");
      state.intentionalClose = true;
      if (state.ws) state.ws.close();
      clearSession();
      showAuth();
      break;

    case "message":
      dom.messagesEmpty.classList.add("hidden");
      appendMessage(data, true);
      scrollToBottom();
      // 新消息音效：仅他人消息且开关开启时播放（自己的消息不响）
      if (getMsgSoundEnabled() && Number(data.user_id) !== Number(state.user?.id)) {
        playMessageSound();
      }
      break;

    case "recall":
      markRecalled(data.id, data.by);
      break;

    case "remove":
      removeMessages(data.ids || [data.id]);
      break;

    case "online_users":
      renderOnlineUsers(data.users || [], data.count);
      break;

    case "user_online":
    case "user_offline":
      if (data.user && Number(data.user.userId) !== Number(state.user?.id)) {
        showPresenceNotice(data.type === "user_online" ? "online" : "offline", data.user);
      }
      break;

    case "profile_updated":
      refreshMessagesOfUser(data.userId, data.nickname, data.avatarUrl);
      break;

    case "error":
      toast(data.message || "操作失败", "error");
      break;

    case "pong":
      // 心跳响应，无需处理
      break;

    default:
      break;
  }
}

function setConn(status) {
  dom.connDot.classList.toggle("online", status === "online");
  dom.connDot.classList.toggle("offline", status === "offline");
  // 状态提示跟随刷新按钮（合并控件），title 同时反映连接状态与刷新功能
  const stateText =
    status === "online" ? "已连接" : status === "offline" ? "连接断开" : "连接中…";
  dom.btnRefresh.title = `${stateText} · 点击刷新消息`;
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  // 进入重连流程：本次连接成功后需自动补齐断线期间的消息
  state.hasConnectedOnce = true;
  state.reconnectTimer = setTimeout(() => {
    if (state.token) connectWs();
  }, state.reconnectDelay);
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, 15000);
}

// ========== 上下线提示 ==========
// 显示一条上下线提示（3.5 秒后淡出移除），开关开启时同时播提示音
function showPresenceNotice(kind, user) {
  if (!getNoticeEnabled()) return;

  const name = user.nickname || "匿名";
  const tip = document.createElement("div");
  tip.className = "presence-tip" + (kind === "online" ? " online" : " offline");
  // 状态点 + 文本（用文本节点，避免 innerHTML 拼接用户输入）
  const dot = document.createElement("span");
  dot.className = "presence-dot";
  tip.appendChild(dot);
  tip.appendChild(document.createTextNode(kind === "online" ? `${name} 上线了` : `${name} 下线了`));
  dom.presenceNotices.appendChild(tip);

  // 3.5 秒后淡出移除
  setTimeout(() => {
    tip.classList.add("out");
    // 动画结束后移除（动画被禁用等情况下用兜底超时移除）
    const remove = () => tip.remove();
    tip.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, 600);
  }, 3500);

  // 提示音效
  if (getSoundEnabled()) playPresenceSound(kind);
}

let _presenceAudioCtx = null;

// 用 Web Audio API 生成简短提示音（无需音频文件）：上线升调、下线降调
function playPresenceSound(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    // 复用同一个 AudioContext（用户已与页面交互过，可正常发声）
    if (!_presenceAudioCtx) _presenceAudioCtx = new Ctx();
    const ctx = _presenceAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const notes = kind === "online" ? [660, 880] : [880, 660];
    const now = ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = notes[i];
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    }
  } catch {
    /* 音效播放失败静默忽略 */
  }
}

// 用 Web Audio API 生成新消息提示音（清脆双音 880→1320Hz，复用同一个 AudioContext）
function playMessageSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    // 与上下线音效共用 AudioContext（页面有过用户交互后即可正常播放）
    if (!_presenceAudioCtx) _presenceAudioCtx = new Ctx();
    const ctx = _presenceAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const notes = [880, 1320];
    const now = ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = notes[i];
      const start = now + i * 0.1;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.1, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    }
  } catch {
    /* 音效播放失败静默忽略 */
  }
}

// ========== 在线成员 ==========
function renderOnlineUsers(users, count) {
  state.onlineUsers = users || [];
  state.onlineCount = count != null ? count : state.onlineUsers.length;

  dom.sidebarCount.textContent = state.onlineCount;
  dom.onlineCountBadge.textContent = state.onlineCount;

  dom.onlineList.innerHTML = "";
  if (!state.onlineUsers.length) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    empty.textContent = "暂无在线用户";
    dom.onlineList.appendChild(empty);
    return;
  }

  const meId = Number(state.user?.id);
  for (const u of state.onlineUsers) {
    const item = document.createElement("div");
    item.className = "online-item";
    item.appendChild(createAvatar(u.nickname || "匿名", u.avatarUrl || null, "online-avatar"));

    const name = document.createElement("span");
    name.className = "online-name";
    name.textContent = u.nickname || "匿名";
    name.title = u.nickname || "匿名";
    if (Number(u.userId) === meId) {
      const me = document.createElement("span");
      me.className = "online-me";
      me.textContent = "（我）";
      name.appendChild(me);
    }
    item.appendChild(name);
    dom.onlineList.appendChild(item);
  }
}

function openOnlinePanel() {
  dom.sidebar.classList.add("open");
  dom.onlineBackdrop.classList.remove("hidden");
}

function closeOnlinePanel() {
  dom.sidebar.classList.remove("open");
  dom.onlineBackdrop.classList.add("hidden");
}

// ========== 消息渲染 ==========
function appendMessage(msg, animate) {
  const type = msg.msg_type || msg.type || "text";
  const content = msg.content || "";
  const mediaUrl = msg.media_url || null;
  const mediaType = msg.media_type || null;
  const nickname = msg.nickname || "匿名";
  const avatarUrl = msg.avatar_url || null;
  const deletedValue = msg.deleted === 1 || msg.deleted === 2 ? msg.deleted : 0;
  const isRecalled = deletedValue === 1 || deletedValue === 2;
  const isOwn = Number(msg.user_id) === Number(state.user?.id);

  const row = document.createElement("div");
  row.className = `msg-row${isOwn ? " own" : ""}`;
  row.dataset.id = msg.id;
  row.dataset.userId = msg.user_id;
  if (!animate) row.style.animation = "none";

  // 头像
  row.appendChild(createAvatar(nickname, avatarUrl));

  // 消息体
  const body = document.createElement("div");
  body.className = "msg-body";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const nick = document.createElement("span");
  nick.className = "msg-nick";
  nick.textContent = nickname;
  nick.title = nickname;
  meta.appendChild(nick);
  body.appendChild(meta);

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (isRecalled) {
    bubble.classList.add("deleted");
    bubble.textContent = deletedValue === 2 ? "已被管理员撤回" : "消息已撤回";
  } else {
    renderBubble(bubble, type, content, mediaUrl, mediaType);
  }
  body.appendChild(bubble);

  // 时间行：时间文本 + 撤回按钮（仅自己发的、未撤回的消息，常显示）
  const timeRow = document.createElement("div");
  timeRow.className = "msg-time-row";

  const time = document.createElement("span");
  time.className = "msg-time";
  time.dataset.ts = msg.created_at;
  time.textContent = formatTime(msg.created_at);
  timeRow.appendChild(time);

  if (isOwn && !isRecalled) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete";
    delBtn.type = "button";
    delBtn.title = "撤回此消息";
    delBtn.setAttribute("aria-label", "撤回此消息");
    // 撤回箭头图标（返回/回车风格），非垃圾桶
    delBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      confirmRecall(msg.id);
    };
    timeRow.appendChild(delBtn);
  }

  body.appendChild(timeRow);

  row.appendChild(body);
  dom.messages.appendChild(row);
}

// 更新页面上某用户所有消息的昵称/头像（资料修改后即时刷新，无需刷新页面）
function refreshMessagesOfUser(userId, nickname, avatarUrl) {
  dom.messages.querySelectorAll(`.msg-row[data-user-id="${userId}"]`).forEach((row) => {
    const nick = row.querySelector(".msg-nick");
    if (nick) {
      nick.textContent = nickname;
      nick.title = nickname;
    }
    const avatar = row.querySelector(".msg-avatar");
    if (avatar) fillAvatar(avatar, nickname, avatarUrl);
  });
}

// 切换时区后，重新渲染页面上已显示消息的时间
function refreshMessageTimes() {
  dom.messages.querySelectorAll(".msg-time").forEach((el) => {
    if (el.dataset.ts != null) {
      el.textContent = formatTime(Number(el.dataset.ts));
    }
  });
}

function renderBubble(bubble, type, content, mediaUrl, mediaType) {
  switch (type) {
    case "text":
      bubble.textContent = content;
      break;

    case "emoji":
      bubble.classList.add("emoji-bubble");
      bubble.textContent = content;
      break;

    case "image":
      if (mediaUrl) {
        const img = document.createElement("img");
        img.className = "msg-media";
        img.src = mediaUrl;
        img.alt = "图片";
        img.loading = "lazy";
        img.onclick = () => openPreview("image", mediaUrl);
        bubble.appendChild(img);
      }
      appendCaption(bubble, content);
      break;

    case "video":
      if (mediaUrl) {
        const vid = document.createElement("video");
        vid.className = "msg-media";
        vid.src = mediaUrl;
        vid.controls = true;
        vid.preload = "metadata";
        vid.playsInline = true;
        bubble.appendChild(vid);
      }
      appendCaption(bubble, content);
      break;

    case "audio":
      if (mediaUrl) {
        const aud = document.createElement("audio");
        aud.className = "msg-media";
        aud.src = mediaUrl;
        aud.controls = true;
        aud.preload = "metadata";
        bubble.appendChild(aud);
      }
      appendCaption(bubble, content);
      break;

    case "file": {
      const a = document.createElement("a");
      a.className = "msg-file";
      a.href =
        mediaUrl && mediaUrl.startsWith("/media/") ? mediaUrl : "#";
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
      const span = document.createElement("span");
      span.textContent = content || (mediaType ? `文件 (${mediaType})` : "文件");
      a.appendChild(span);
      bubble.appendChild(a);
      break;
    }

    default:
      bubble.textContent = content || "[未知消息]";
  }
}

function appendCaption(bubble, content) {
  if (content) {
    const p = document.createElement("div");
    p.className = "media-caption";
    p.textContent = content;
    bubble.appendChild(p);
  }
}

function markRecalled(id, by) {
  const row = dom.messages.querySelector(`.msg-row[data-id="${id}"]`);
  if (!row) return;
  const bubble = row.querySelector(".msg-bubble");
  if (bubble) {
    bubble.className = "msg-bubble deleted";
    bubble.textContent = by === "admin" ? "已被管理员撤回" : "消息已撤回";
  }
  // 撤回后移除时间行上的撤回按钮
  const delBtn = row.querySelector(".btn-delete");
  if (delBtn) delBtn.remove();
}

function removeMessages(ids) {
  for (const id of ids) {
    const row = dom.messages.querySelector(`.msg-row[data-id="${id}"]`);
    if (row) row.remove();
  }
}

function scrollToBottom(force) {
  requestAnimationFrame(() => {
    if (force) {
      dom.messages.scrollTop = dom.messages.scrollHeight;
      return;
    }
    // 用户靠近底部时自动跟随
    const nearBottom =
      dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight < 140;
    if (nearBottom) dom.messages.scrollTop = dom.messages.scrollHeight;
  });
}

// ========== 发送消息 ==========
function sendMessage(type, content, mediaUrl, mediaType) {
  const payload = { type: "message", msg_type: type, content: content || "" };
  if (mediaUrl) payload.media_url = mediaUrl;
  if (mediaType) payload.media_type = mediaType;

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

async function handleSend() {
  // 有待发送文件
  if (state.pendingFile) {
    await sendPendingFile();
    return;
  }

  const text = dom.msgInput.value.trim();
  if (!text) return;

  // 纯表情 → 大字号表情消息
  const type = isEmojiOnly(text) ? "emoji" : "text";
  const ok = sendMessage(type, text);

  if (ok) {
    dom.msgInput.value = "";
    autoResize();
  } else {
    toast("连接已断开，正在重连…", "error");
  }
}

// ========== 文件上传 ==========
function handleFileSelected(file) {
  if (!file) return;
  const type = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("audio/")
        ? "audio"
        : null;

  if (!type) {
    toast("仅支持图片、视频、音频文件", "error");
    return;
  }

  state.pendingFile = { file, type };

  if (type === "image") {
    dom.uploadPreviewImg.src = URL.createObjectURL(file);
    dom.uploadPreviewImg.classList.remove("hidden");
  } else {
    dom.uploadPreviewImg.classList.add("hidden");
  }
  dom.uploadPreviewName.textContent = file.name;
  dom.uploadPreview.classList.remove("hidden");
}

function clearPendingFile() {
  state.pendingFile = null;
  dom.uploadPreview.classList.add("hidden");
  dom.uploadPreviewImg.src = "";
  dom.uploadPreviewName.textContent = "";
  dom.fileInput.value = "";
}

async function sendPendingFile() {
  if (!state.pendingFile) return;
  const { file, type } = state.pendingFile;

  try {
    toast("上传中…");
    const formData = new FormData();
    formData.append("file", file);
    const uploaded = await api("/api/upload", { method: "POST", body: formData });

    sendMessage(type, dom.msgInput.value.trim(), uploaded.url, uploaded.contentType);
    dom.msgInput.value = "";
    autoResize();
    clearPendingFile();
  } catch (err) {
    toast(err.message || "上传失败", "error");
  }
}

// ========== 撤回 ==========
let _confirmCallback = null; // 撤回确认弹窗的待执行回调

// 打开撤回确认弹窗
function confirmRecall(messageId) {
  dom.confirmModal.classList.remove("hidden");
  _confirmCallback = () => deleteMessage(messageId);
}

function closeConfirmModal() {
  dom.confirmModal.classList.add("hidden");
  _confirmCallback = null;
}

async function deleteMessage(id) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "delete", id }));
    return;
  }
  // HTTP fallback
  try {
    await api(`/api/messages/${id}/delete`, { method: "POST" });
    markRecalled(id, "user");
  } catch (err) {
    toast(err.message || "撤回失败", "error");
  }
}

// ========== 媒体预览 ==========
function openPreview(type, url) {
  dom.mediaContent.innerHTML = "";
  if (type === "image") {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "图片预览";
    dom.mediaContent.appendChild(img);
  } else if (type === "video") {
    const vid = document.createElement("video");
    vid.src = url;
    vid.controls = true;
    vid.autoplay = true;
    vid.playsInline = true;
    dom.mediaContent.appendChild(vid);
  }
  dom.mediaPreview.classList.remove("hidden");
}

function closePreview() {
  dom.mediaPreview.classList.add("hidden");
  dom.mediaContent.innerHTML = "";
}

// ========== Emoji 选择器 ==========
function renderEmojiGrid() {
  dom.emojiGrid.innerHTML = "";
  for (const emoji of EMOJIS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = emoji;
    btn.onclick = () => {
      const input = dom.msgInput;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
      input.focus();
      const pos = start + emoji.length;
      input.setSelectionRange(pos, pos);
      autoResize();
    };
    dom.emojiGrid.appendChild(btn);
  }
}

// ========== 输入框自适应 ==========
function autoResize() {
  dom.msgInput.style.height = "auto";
  dom.msgInput.style.height = Math.min(dom.msgInput.scrollHeight, 120) + "px";
}

// ========== 设置 ==========
function openSettings() {
  dom.nicknameInput.value = state.user?.nickname || "";
  dom.timezoneSelect.value = getTimezone();
  dom.settingNotice.checked = getNoticeEnabled();
  dom.settingSound.checked = getSoundEnabled();
  dom.settingMsgSound.checked = getMsgSoundEnabled();
  renderSettingsAvatar();
  dom.settingsModal.classList.remove("hidden");
}

function renderSettingsAvatar() {
  const url = state.pendingAvatar
    ? URL.createObjectURL(state.pendingAvatar)
    : state.user?.avatar_url || null;
  fillAvatar(dom.settingsAvatarPreview, state.user?.nickname || state.user?.username || "?", url);
}

async function saveSettings() {
  const nickname = dom.nicknameInput.value.trim();
  if (!nickname) {
    toast("昵称不能为空", "error");
    return;
  }

  dom.btnSaveSettings.disabled = true;
  try {
    // 上传头像（若已选择）
    if (state.pendingAvatar) {
      const formData = new FormData();
      formData.append("file", state.pendingAvatar);
      const res = await api("/api/user/avatar", { method: "POST", body: formData });
      state.user.avatar_url = res.avatar_url;
      state.pendingAvatar = null;
    }

    // 修改昵称
    if (nickname !== state.user.nickname) {
      const res = await api("/api/user/nickname", {
        method: "PUT",
        body: { nickname },
      });
      state.user.nickname = res.nickname;
    }

    // 保存时区
    localStorage.setItem(TZ_KEY, dom.timezoneSelect.value);
    refreshMessageTimes();

    // 保存通知提醒设置（上下线：消息提示 / 音效；新消息：音效）
    localStorage.setItem(NOTICE_KEY, dom.settingNotice.checked ? "1" : "0");
    localStorage.setItem(SOUND_KEY, dom.settingSound.checked ? "1" : "0");
    localStorage.setItem(MSG_SOUND_KEY, dom.settingMsgSound.checked ? "1" : "0");

    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    renderMe();
    // 刷新页面上该用户历史消息的昵称/头像
    refreshMessagesOfUser(state.user.id, state.user.nickname, state.user.avatar_url || null);
    dom.settingsModal.classList.add("hidden");
    dom.avatarInput.value = "";
    toast("设置已保存", "success");
    // 注意：不重连 WS。修改昵称/头像已通过 /profile-update 通知 DO 刷新在线连接缓存，
    // 保存设置若触发重连会导致 webSocketClose 广播 user_offline、重连后又广播 user_online，
    // 其他用户会看到多余的「下线了→上线了」提醒
  } catch (err) {
    toast(err.message || "保存失败", "error");
  } finally {
    dom.btnSaveSettings.disabled = false;
  }
}

// ========== 事件绑定 ==========
function bindEvents() {
  // 认证
  dom.tabLogin.addEventListener("click", () => setMode("login"));
  dom.tabRegister.addEventListener("click", () => setMode("register"));
  dom.authForm.addEventListener("submit", handleAuthSubmit);
  dom.btnLogout.addEventListener("click", handleLogout);

  // 密码可见性切换
  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.classList.toggle("show", show);
      btn.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
      btn.setAttribute("aria-pressed", String(show));
      input.focus();
    });
  });

  // 手动刷新消息（兜底，带防抖 + 图标旋转反馈）
  dom.btnRefresh.addEventListener("click", async () => {
    // 防止快速重复点击
    dom.btnRefresh.disabled = true;
    dom.btnRefresh.classList.add("spinning");
    // 同时请求服务端重新广播在线成员列表（网络/WS 异常后状态可能不同步）
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "refresh_online" }));
    }
    await loadHistory();
    toast("消息已刷新", "success");
    // 旋转至少保持 600ms，让反馈清晰可见
    setTimeout(() => {
      dom.btnRefresh.disabled = false;
      dom.btnRefresh.classList.remove("spinning");
    }, 600);
  });

  // 发送
  dom.btnSend.addEventListener("click", handleSend);
  dom.msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  dom.msgInput.addEventListener("input", autoResize);

  // 上传
  dom.btnUpload.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", () => {
    if (dom.fileInput.files?.[0]) handleFileSelected(dom.fileInput.files[0]);
  });
  dom.btnClearUpload.addEventListener("click", clearPendingFile);

  // Emoji
  dom.btnEmoji.addEventListener("click", (e) => {
    e.stopPropagation();
    dom.emojiPicker.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!dom.emojiPicker.contains(e.target) && e.target !== dom.btnEmoji) {
      dom.emojiPicker.classList.add("hidden");
    }
  });

  // 媒体预览
  dom.mediaBackdrop.addEventListener("click", closePreview);
  dom.mediaClose.addEventListener("click", closePreview);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePreview();
      dom.settingsModal.classList.add("hidden");
      closeConfirmModal();
      dom.emojiPicker.classList.add("hidden");
      closeOnlinePanel();
    }
  });

  // 撤回确认弹窗
  dom.btnConfirmOk.addEventListener("click", () => {
    dom.confirmModal.classList.add("hidden");
    if (_confirmCallback) {
      const cb = _confirmCallback;
      _confirmCallback = null;
      cb();
    }
  });
  dom.btnConfirmCancel.addEventListener("click", closeConfirmModal);
  dom.confirmModal.addEventListener("click", (e) => {
    if (e.target === dom.confirmModal) closeConfirmModal();
  });

  // 设置
  dom.btnSettings.addEventListener("click", openSettings);
  dom.btnCloseSettings.addEventListener("click", () => dom.settingsModal.classList.add("hidden"));
  dom.settingsModal.addEventListener("click", (e) => {
    if (e.target === dom.settingsModal) dom.settingsModal.classList.add("hidden");
  });
  dom.btnAvatarUpload.addEventListener("click", () => dom.avatarInput.click());
  dom.avatarInput.addEventListener("change", () => {
    const file = dom.avatarInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("头像必须是图片", "error");
      return;
    }
    state.pendingAvatar = file;
    renderSettingsAvatar();
  });
  dom.btnSaveSettings.addEventListener("click", saveSettings);

  // 在线成员
  dom.btnOnline.addEventListener("click", (e) => {
    e.stopPropagation();
    openOnlinePanel();
  });
  dom.btnSidebarClose.addEventListener("click", closeOnlinePanel);
  dom.onlineBackdrop.addEventListener("click", closeOnlinePanel);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeOnlinePanel();
  });

  // 粘贴图片
  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFileSelected(file);
        break;
      }
    }
  });
}

// ========== 启动 ==========
function init() {
  bindEvents();
  renderEmojiGrid();
  buildTimezoneOptions();
  setMode("login");
  tryRestoreSession();
}

init();
