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
const OLDER_PAGE = 20;

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
  inviteEnabled: false, // 后端是否开启邀请码验证（决定注册界面是否显示邀请码框）
  hasOlder: false, // 是否还有更早历史
  loadingOlder: false, // 加载更多进行中锁
  olderDone: false, // 是否已提示过「没有更早的消息」（防重复 toast）
  heartbeatTimer: null, // 心跳定时器（30s 一次，服务端据此清理僵尸连接）
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
  authAgree: $("#auth-agree"),
  authError: $("#auth-error"),
  authSubmit: $("#auth-submit"),
  nicknameField: $("#nickname-field"),
  passwordConfirmField: $("#password-confirm-field"),
  inviteCodeField: $("#invite-code-field"),
  agreeField: $("#agree-field"),
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

  // 账号安全（设置弹窗）
  pwdOld: $("#pwd-old"),
  pwdNew: $("#pwd-new"),
  pwdConfirm: $("#pwd-confirm"),
  btnChangePassword: $("#btn-change-password"),
  btnDeleteAccount: $("#btn-delete-account"),
  deleteAccountHint: $("#delete-account-hint"),
  adminNoDeleteHint: $("#admin-no-delete-hint"),
  deleteAccountModal: $("#delete-account-modal"),
  deleteAccountPassword: $("#delete-account-password"),
  btnDeleteCancel: $("#btn-delete-cancel"),
  btnDeleteConfirm: $("#btn-delete-confirm"),

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
  // 同意隐私政策：仅注册模式显示（登录模式不显示；切回注册时保留上次勾选状态）
  dom.agreeField.classList.toggle("hidden", !isRegister);
  // 邀请码框仅在注册模式且后端开启验证时显示
  dom.inviteCodeField.classList.toggle("hidden", !(isRegister && state.inviteEnabled));
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
  // 被踢下线/注销等场景下若设置或注销确认弹窗仍开着，一并关闭，避免残留在登录页上方
  dom.settingsModal.classList.add("hidden");
  dom.deleteAccountModal.classList.add("hidden");
  setMode(state.mode);
}

// 加载后端邀请码设置（决定注册界面是否显示邀请码输入框）
async function loadInviteSettings() {
  let enabled = false;
  try {
    const data = await api("/api/invite-settings");
    enabled = Boolean(data && data.enabled);
  } catch {
    /* 接口失败时默认不显示邀请码框，不阻塞页面 */
  }
  if (state.inviteEnabled !== enabled) {
    state.inviteEnabled = enabled;
    // 异步加载完成后刷新当前模式的字段显隐
    setMode(state.mode);
  }
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

  // 注册模式：必须勾选同意隐私政策
  if (state.mode === "register" && !dom.authAgree.checked) {
    dom.authError.textContent = "请先阅读并同意《隐私政策》";
    return;
  }

  dom.authSubmit.disabled = true;
  try {
    const endpoint = state.mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const body = state.mode === "register"
      ? {
          username,
          password,
          nickname: nickname || username,
          invite_code: dom.authInviteCode.value.trim(),
          agreement: true,
        }
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

// 本地强制登出回登录页：服务端已判定会话失效（改密/注销）时使用，不再自动重连
function forceLogout() {
  state.intentionalClose = true;
  if (state.ws) {
    try {
      state.ws.close();
    } catch {
      /* 忽略关闭异常 */
    }
  }
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
    state.loadingOlder = false;
    state.olderDone = false;
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
    // 拉满 50 条说明可能还有更早的；不足则到底
    state.hasOlder = (data.messages || []).length >= MAX_HISTORY;
    scrollToBottom(true);
  } catch (err) {
    toast(err.message, "error");
  }
}

// 触顶/下拉加载更早消息（一次 20 条），保持当前阅读位置不跳动
async function loadOlder() {
  if (!state.hasOlder || state.loadingOlder) return;
  const first = dom.messages.querySelector(".msg-row");
  if (!first) { state.hasOlder = false; return; }
  const before = first.dataset.createdAt;
  const beforeId = first.dataset.id;
  if (!before) { state.hasOlder = false; return; }
  state.loadingOlder = true;
  try {
    const data = await api(`/api/history?limit=${OLDER_PAGE}&before=${before}&before_id=${beforeId}`);
    const msgs = data.messages || [];
    if (!msgs.length) {
      state.hasOlder = false;
      if (!state.olderDone) {
        state.olderDone = true;
        toast("没有更早的消息了");
      }
      return;
    }
    // 顶部插入前记录滚动位置，插入后修正 scrollTop 使视口内容不跳动
    const el = dom.messages;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    const prevSmooth = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    // msgs 已按时间升序；倒序逐个插到当前最早消息之前，保证最终 DOM 顺序升序
    for (let i = msgs.length - 1; i >= 0; i--) appendMessage(msgs[i], false, true);
    el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
    el.style.scrollBehavior = prevSmooth;
    state.hasOlder = msgs.length >= OLDER_PAGE;
    if (!state.hasOlder && !state.olderDone) {
      state.olderDone = true;
      toast("没有更早的消息了");
    }
  } catch (err) {
    toast(err.message || "加载更早消息失败", "error");
  } finally {
    state.loadingOlder = false;
  }
}

// ========== WebSocket ==========
function connectWs() {
  if (!state.token) return;

  clearTimeout(state.reconnectTimer);
  startHeartbeat();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/ws`;

  setConn("connecting");
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    // 连接后立即发送认证
    ws.send(JSON.stringify({ type: "auth", token: state.token }));
    sendHeartbeat();
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

    case "kick": {
      // 服务端判定会话失效（封禁/注销/修改密码）：提示原因后登出，不自动重连
      const reasonMap = {
        banned: "账号已被封禁",
        deleted: "账号已被注销或删除",
        password_changed: "密码已修改，请重新登录",
      };
      toast(reasonMap[data.reason] || "登录状态已失效", "error");
      state.intentionalClose = true;
      if (state.ws) {
        try {
          state.ws.close();
        } catch {
          /* 忽略关闭异常 */
        }
      }
      clearSession();
      showAuth();
      break;
    }

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

// ========== 心跳与断线自愈 ==========
// 每 30s 向服务端发一次业务心跳。服务端据此刷新连接活跃时间，
// 超过 90s 无任何消息的连接会被判定为僵尸并主动关闭（清出在线列表）——
// 否则用户断网/杀进程后他人界面会一直显示其在线。
const HEARTBEAT_INTERVAL = 30000;

function startHeartbeat() {
  clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

function sendHeartbeat() {
  const ws = state.ws;
  if (state.token && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      /* 连接可能已坏，忽略，走 onclose 重连 */
    }
  }
}

// 页面重新可见 / bfcache 恢复 / 网络恢复时调用：立即心跳 + 自检连接
// （后台冻结期间浏览器可能已静默关闭 WS 而未触发 onclose，恢复时需主动重连）
function handleVisibilityResume() {
  sendHeartbeat();
  const ws = state.ws;
  if (
    state.token &&
    !state.intentionalClose &&
    (!ws || ws.readyState !== WebSocket.OPEN)
  ) {
    connectWs();
  }
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
function appendMessage(msg, animate, prepend) {
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
  row.dataset.createdAt = msg.created_at;
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
  if (prepend) {
    // 插到当前最早一条真实消息之前（.messages-empty 是空态占位，用 .msg-row 选择器跳过）
    const anchor = dom.messages.querySelector(".msg-row");
    if (anchor) dom.messages.insertBefore(row, anchor);
    else dom.messages.appendChild(row);
  } else {
    dom.messages.appendChild(row);
  }
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

  // 按类型大小预检（与后端一致）：图片 10MB / 音频 20MB / 视频 50MB，超限即时提示
  const LIMIT = { image: 10, audio: 20, video: 50 };
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > LIMIT[type]) {
    const label = type === "image" ? "图片" : type === "audio" ? "音频" : "视频";
    toast(`${label}文件不能超过 ${LIMIT[type]}MB`, "error");
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

  // 账号安全：清空上次遗留的密码输入与按钮状态
  dom.pwdOld.value = "";
  dom.pwdNew.value = "";
  dom.pwdConfirm.value = "";
  dom.btnChangePassword.disabled = false;
  dom.btnDeleteConfirm.disabled = false;
  dom.deleteAccountModal.classList.add("hidden");
  dom.deleteAccountPassword.value = "";
  // 管理员不支持自助注销：隐藏注销入口与危险说明，仅显示提示小字
  const isAdmin = Boolean(state.user?.is_admin);
  dom.deleteAccountHint.classList.toggle("hidden", isAdmin);
  dom.btnDeleteAccount.classList.toggle("hidden", isAdmin);
  dom.adminNoDeleteHint.classList.toggle("hidden", !isAdmin);

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

// ========== 账号安全 ==========
// 修改密码：成功即被服务端登出（全部会话失效），回登录页
async function handleChangePassword() {
  const oldPassword = dom.pwdOld.value;
  const newPassword = dom.pwdNew.value;

  if (!oldPassword) {
    toast("请输入当前密码", "error");
    return;
  }
  if (!newPassword) {
    toast("请输入新密码", "error");
    return;
  }
  if (newPassword.length < 8) {
    toast("新密码长度不能少于 8 个字符", "error");
    return;
  }
  if (newPassword !== dom.pwdConfirm.value) {
    toast("两次输入的新密码不一致", "error");
    return;
  }

  dom.btnChangePassword.disabled = true;
  try {
    await api("/api/auth/change-password", {
      method: "POST",
      body: { old_password: oldPassword, new_password: newPassword },
    });
    toast("密码已修改，请重新登录", "success");
    // 服务端已使该账号全部会话失效，按 kick 同款流程本地登出，不自动重连
    forceLogout();
  } catch (err) {
    toast(err.message || "修改密码失败", "error");
  } finally {
    dom.btnChangePassword.disabled = false;
  }
}

// 注销账号：打开确认弹窗（清空密码框）
function openDeleteAccountModal() {
  dom.deleteAccountPassword.value = "";
  dom.deleteAccountModal.classList.remove("hidden");
  dom.deleteAccountPassword.focus();
}

function closeDeleteAccountModal() {
  dom.deleteAccountModal.classList.add("hidden");
  dom.deleteAccountPassword.value = "";
}

// 注销账号：确认后调用后端接口，成功即登出
async function confirmDeleteAccount() {
  const password = dom.deleteAccountPassword.value;
  if (!password) {
    toast("请输入密码", "error");
    return;
  }

  dom.btnDeleteConfirm.disabled = true;
  try {
    await api("/api/auth/delete-account", {
      method: "POST",
      body: { password },
    });
    toast("账号已注销", "success");
    closeDeleteAccountModal();
    forceLogout();
  } catch (err) {
    // 403 = 管理员不支持自助注销（后台可能已提升权限），关闭弹窗；其余错误保留弹窗以便重试
    if (err.status === 403) closeDeleteAccountModal();
    toast(err.message || "注销账号失败", "error");
  } finally {
    dom.btnDeleteConfirm.disabled = false;
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
      closeDeleteAccountModal();
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

  // 账号安全：修改密码 / 注销账号
  dom.btnChangePassword.addEventListener("click", handleChangePassword);
  dom.btnDeleteAccount.addEventListener("click", openDeleteAccountModal);
  dom.btnDeleteCancel.addEventListener("click", closeDeleteAccountModal);
  dom.btnDeleteConfirm.addEventListener("click", confirmDeleteAccount);
  dom.deleteAccountModal.addEventListener("click", (e) => {
    if (e.target === dom.deleteAccountModal) closeDeleteAccountModal();
  });
  // 密码框回车即提交注销
  dom.deleteAccountPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dom.btnDeleteConfirm.click();
    }
  });

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

  // 历史消息加载更多：容器滚动到顶自动加载（桌面滚轮上滚到顶场景）
  dom.messages.addEventListener("scroll", () => {
    if (dom.messages.scrollTop <= 2 && state.hasOlder && !state.loadingOlder) loadOlder();
  });

  // 移动端触顶后继续下拉手势（scroll 到顶后不再触发 scroll 事件的兜底）
  let pullStartY = 0;
  dom.messages.addEventListener(
    "touchstart",
    (e) => {
      pullStartY = e.touches[0].clientY;
    },
    { passive: true }
  );
  dom.messages.addEventListener(
    "touchmove",
    (e) => {
      // 仅在已经滚动到最顶部、且手势向下（下拉）时接管，触发加载更早消息
      if (dom.messages.scrollTop <= 2 && state.hasOlder && !state.loadingOlder) {
        const deltaY = e.touches[0].clientY - pullStartY;
        if (deltaY > 56) {
          e.preventDefault();
          pullStartY = e.touches[0].clientY; // 复位，避免同一次手势连续触发
          loadOlder();
        }
      }
    },
    { passive: false }
  );
}

// ========== 启动 ==========
// 虚拟键盘适配：魅族等旧内核浏览器键盘弹出时不收缩 layout viewport，
// 用 visualViewport 高度同步 --app-h（px），避免输入框与键盘之间出现空白
function syncAppHeight() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-h", `${h}px`);
}

function init() {
  bindEvents();
  renderEmojiGrid();
  buildTimezoneOptions();
  setMode("login");
  loadInviteSettings(); // 异步加载邀请码设置，不阻塞页面
  tryRestoreSession();
  disableUserZoom(); // 禁用页面手动缩放（双指捏合/双击）

  // 页面恢复可见 / bfcache 恢复 / 网络恢复：立即心跳并自检连接，
  // 修复后台冻结后 WS 被浏览器静默关闭、他人仍看到该用户在线的问题
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") handleVisibilityResume();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) handleVisibilityResume();
  });
  window.addEventListener("online", handleVisibilityResume);
}

// 视口变化（键盘弹出/收起、缩放等）时同步容器高度
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncAppHeight);
}
window.addEventListener("resize", syncAppHeight);
syncAppHeight();

// 禁用用户手动缩放界面（配合 viewport user-scalable=no）
function disableUserZoom() {
  // iOS Safari：阻止捏合缩放手势
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false }
  );
  // 阻止双击快速缩放（桌面浏览器双击触发）
  document.addEventListener("dblclick", (e) => e.preventDefault());
}

init();
