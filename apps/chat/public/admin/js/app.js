// ============================================================
// LoopV Chat 管理平台 — 前端逻辑（vanilla JS）
// ============================================================

"use strict";

// ========== 常量 ==========
const TOKEN_KEY = "loopv_admin_token";
const USER_KEY = "loopv_admin_user";
const MSG_LIMIT = 100;

// 文档站清单（跨域，已配 CORS）
const DOCS_MANIFEST_URL = "https://docs.loopv.net/manifest.json";

const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#06b6d4", "#f97316", "#84cc16", "#14b8a6", "#3b82f6", "#a855f7",
];

// 消息类型元信息
const MSG_TYPES = {
  text: {
    label: "文本",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  },
  image: {
    label: "图片",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  },
  video: {
    label: "视频",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
  },
  audio: {
    label: "音频",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  },
  emoji: {
    label: "表情",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  },
  file: {
    label: "文件",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  },
};

// 消息状态映射：deleted 字段 → 展示
const MSG_STATUS = {
  0: { label: "正常", cls: "badge-active" },
  1: { label: "用户撤回", cls: "badge-user-recall" },
  2: { label: "管理员撤回", cls: "badge-admin-recall" },
  3: { label: "已删除", cls: "badge-deleted" },
};

// ========== 状态 ==========
const state = {
  token: null,
  user: null,
  users: [],
  messages: [],
  activeTab: "users",
  selectedMsgIds: new Set(),
};

const msgFilter = {
  start: "",
  end: "",
  sender: "",
  statuses: [], // 状态多选白名单，空数组 = 全部状态
  page: 1, // 当前页（从 1 开始），筛选条件变化时重置为 1
};

// 消息分页元信息（来自后端响应）
const msgPagination = {
  total: 0,
  totalPages: 0,
};

const userFilter = {
  username: "",
  nickname: "",
  role: "",
  status: "",
};

// 文档管理状态：hidden 集合为「当前全部隐藏 slug」的唯一真值
// （初始 = GET /api/docs/visibility 返回值；manifest 只负责 slug/标题/分组全集）
const docsState = {
  items: [], // manifest 中的文档列表
  hidden: new Set(), // 隐藏 slug 全集（含 manifest 外的存量隐藏项）
  dirty: false, // 是否有未保存的更改
};

// ========== DOM 引用 ==========
const $ = (sel) => document.querySelector(sel);

const dom = {
  // 登录
  loginView: $("#login-view"),
  loginForm: $("#login-form"),
  loginUsername: $("#login-username"),
  loginPassword: $("#login-password"),
  loginError: $("#login-error"),
  loginSubmit: $("#login-submit"),

  // 顶栏
  adminView: $("#admin-view"),
  meAvatar: $("#me-avatar"),
  meName: $("#me-name"),
  btnLogout: $("#btn-logout"),

  // 统计
  statUsers: $("#stat-users"),
  statMessages: $("#stat-messages"),
  statRecalled: $("#stat-recalled"),
  statDeleted: $("#stat-deleted"),

  // 面板
  panelUsers: $("#panel-users"),
  panelMessages: $("#panel-messages"),
  usersBody: $("#users-body"),
  messagesBody: $("#messages-body"),
  usersEmpty: $("#users-empty"),
  messagesEmpty: $("#messages-empty"),
  usersLoading: $("#users-loading"),
  messagesLoading: $("#messages-loading"),

  // 用户筛选
  fUsername: $("#f-username"),
  fNickname: $("#f-nickname"),
  fRole: $("#f-role"),
  fStatus: $("#f-status"),
  btnUserQuery: $("#btn-user-query"),
  btnUserReset: $("#btn-user-reset"),
  btnCreateUser: $("#btn-create-user"),

  // 消息筛选
  fStart: $("#f-start"),
  fEnd: $("#f-end"),
  fSender: $("#f-sender"),
  msgStatusChips: $("#msg-status-chips"),
  btnMsgQuery: $("#btn-msg-query"),
  btnMsgReset: $("#btn-msg-reset"),

  // 消息分页
  msgScroll: $("#msg-scroll"),
  paginationTotal: $("#pagination-total"),
  paginationNav: $("#pagination-nav"),
  paginationInput: $("#pagination-input"),
  paginationTotalPages: $("#pagination-total-pages"),
  btnMsgPrev: $("#btn-msg-prev"),
  btnMsgNext: $("#btn-msg-next"),

  // 批量删除
  checkAll: $("#check-all"),
  btnBatchDelete: $("#btn-batch-delete"),
  batchCount: $("#batch-count"),

  // 邀请码设置
  inviteEnabled: $("#invite-enabled"),
  inviteCodeInput: $("#invite-code-input"),
  btnSaveInvite: $("#btn-save-invite"),

  // 文档管理
  docsLoading: $("#docs-loading"),
  docsFail: $("#docs-fail"),
  docsFailText: $("#docs-fail-text"),
  btnDocsRetry: $("#btn-docs-retry"),
  docsEmpty: $("#docs-empty"),
  docsList: $("#docs-list"),
  docsActions: $("#docs-actions"),
  docsDirty: $("#docs-dirty"),
  btnSaveDocs: $("#btn-save-docs"),

  // 确认弹窗
  confirmModal: $("#confirm-modal"),
  confirmTitle: $("#confirm-title"),
  confirmText: $("#confirm-text"),
  confirmCancel: $("#confirm-cancel"),
  confirmOk: $("#confirm-ok"),

  // 创建用户弹窗
  createModal: $("#create-modal"),
  btnCreateClose: $("#btn-create-close"),
  createFormWrap: $("#create-form-wrap"),
  createResultWrap: $("#create-result-wrap"),
  createUsername: $("#create-username"),
  createPassword: $("#create-password"),
  createNickname: $("#create-nickname"),
  btnCreateCancel: $("#btn-create-cancel"),
  btnCreateSubmit: $("#btn-create-submit"),
  createResultPassword: $("#create-result-password"),
  btnCopyPassword: $("#btn-copy-password"),
  btnCreateDone: $("#btn-create-done"),

  toast: $("#toast"),
};

// ========== 工具函数 ==========
function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  if (options.body && typeof options.body !== "string") {
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

// 北京时间格式化：秒级时间戳 → "2026年08月07日 14:30"
function formatTime(ts) {
  const date = new Date((ts || Math.floor(Date.now() / 1000)) * 1000);
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
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

// datetime-local 值 → Unix 秒
function datetimeToUnix(value) {
  if (!value) return 0;
  const d = new Date(value);
  if (isNaN(d.getTime())) return 0;
  return Math.floor(d.getTime() / 1000);
}

function avatarColor(seed) {
  let hash = 0;
  const s = String(seed || "x");
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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

function isAdmin(u) {
  return u.is_admin === 1 || u.is_admin === true || u.is_admin === "1";
}

function isTest(u) {
  return u.is_test === 1 || u.is_test === true || u.is_test === "1";
}

function isBanned(u) {
  return u.banned === 1 || u.banned === true || u.banned === "1";
}

function roleOf(u) {
  if (isAdmin(u)) return { label: "管理员", cls: "badge-admin" };
  if (isTest(u)) return { label: "测试用户", cls: "badge-test" };
  return { label: "普通用户", cls: "badge-user" };
}

function msgStatus(deleted) {
  return MSG_STATUS[deleted] || MSG_STATUS[0];
}

function toast(message, type = "info", duration = 2600) {
  dom.toast.textContent = message;
  dom.toast.className =
    "toast show" + (type === "error" ? " error" : type === "success" ? " success" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => dom.toast.classList.remove("show"), duration);
}

async function handleError(err) {
  if (err.status === 401) {
    clearSession();
    showLogin();
    toast("登录已过期，请重新登录", "error");
  } else if (err.status === 403) {
    try {
      const data = await api("/api/auth/me");
      if (!data || !data.user || !isAdmin(data.user)) {
        clearSession();
        showLogin();
        toast("登录已过期，请重新登录", "error");
        return;
      }
    } catch {
      /* 忽略校验失败 */
    }
    toast("无权限执行此操作", "error");
  } else {
    toast(err.message || "请求失败", "error");
  }
}

// ========== 认证 ==========
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

function showLogin() {
  dom.adminView.classList.add("hidden");
  dom.loginView.classList.remove("hidden");
  dom.loginError.textContent = "";
}

function showAdmin() {
  dom.loginView.classList.add("hidden");
  dom.adminView.classList.remove("hidden");
  renderMe();
}

function renderMe() {
  const u = state.user;
  if (!u) return;
  const name = u.nickname || u.username;
  dom.meName.textContent = name;
  dom.meName.title = name;
  fillAvatar(dom.meAvatar, name, u.avatar_url || null);
}

async function handleLogin(e) {
  e.preventDefault();
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;

  dom.loginError.textContent = "";
  if (!username || !password) {
    dom.loginError.textContent = "用户名和密码不能为空";
    return;
  }

  dom.loginSubmit.disabled = true;
  try {
    const data = await api("/api/auth/login", { method: "POST", body: { username, password } });
    if (!isAdmin(data.user)) {
      dom.loginError.textContent = "无管理员权限";
      state.token = data.token;
      api("/api/auth/logout", { method: "POST" }).catch(() => {});
      state.token = null;
      dom.loginSubmit.disabled = false;
      dom.loginForm.reset();
      return;
    }
    saveSession(data.token, data.user);
    dom.loginForm.reset();
    dom.loginSubmit.disabled = false;
    enterAdmin();
  } catch (err) {
    dom.loginError.textContent = err.message || "登录失败";
    dom.loginSubmit.disabled = false;
  }
}

async function handleLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* 忽略 */
  }
  clearSession();
  showLogin();
}

async function tryRestoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showLogin();
    return;
  }
  state.token = token;
  try {
    const data = await api("/api/auth/me");
    if (data && data.user && isAdmin(data.user)) {
      state.user = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      enterAdmin();
      return;
    }
  } catch {
    /* token 失效 */
  }
  clearSession();
  showLogin();
}

function enterAdmin() {
  showAdmin();
  switchTab(state.activeTab);
  loadStats();
  loadInviteSettings();
  loadDocsPanel();
}

// ========== 数据加载 ==========
async function loadStats() {
  try {
    const data = await api("/api/admin/stats");
    dom.statUsers.textContent = data.users ?? 0;
    dom.statMessages.textContent = data.messages ?? 0;
    dom.statRecalled.textContent = data.recalled ?? 0;
    dom.statDeleted.textContent = data.deleted ?? 0;
  } catch (err) {
    handleError(err);
  }
}

async function loadInviteSettings() {
  try {
    const data = await api("/api/admin/invite-settings");
    dom.inviteEnabled.checked = !!data.enabled;
    dom.inviteCodeInput.value = data.code || "";
  } catch (err) {
    handleError(err);
  }
}

async function saveInviteSettings() {
  const enabled = dom.inviteEnabled.checked;
  const code = dom.inviteCodeInput.value.trim();
  dom.btnSaveInvite.disabled = true;
  try {
    await api("/api/admin/invite-settings", {
      method: "PUT",
      body: { enabled, code },
    });
    toast("已保存", "success");
  } catch (err) {
    handleError(err);
  } finally {
    dom.btnSaveInvite.disabled = false;
  }
}

// ========== 文档管理 ==========
// 拉取 docs.loopv.net 文档清单（跨域，manifest.json）
async function fetchDocsManifest() {
  const res = await fetch(DOCS_MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest 拉取失败 (${res.status})`);
  const data = await res.json();
  if (!data || !Array.isArray(data.docs)) throw new Error("manifest 格式不正确");
  return data.docs;
}

// 并发拉取文档清单 + 隐藏列表；manifest 失败进区块内失败态（不弹致命错误）
async function loadDocsPanel() {
  dom.docsLoading.classList.remove("hidden");
  dom.docsFail.classList.add("hidden");
  dom.docsEmpty.classList.add("hidden");
  dom.docsList.classList.add("hidden");
  dom.docsActions.classList.add("hidden");

  const [manifestRes, visRes] = await Promise.allSettled([
    fetchDocsManifest(),
    api("/api/docs/visibility"),
  ]);

  dom.docsLoading.classList.add("hidden");

  // 任一失败 → 区块内失败提示 + 重试
  if (manifestRes.status === "rejected" || visRes.status === "rejected") {
    const manifestErr = manifestRes.status === "rejected";
    const visErr = visRes.status === "rejected";
    if (manifestErr && visErr) {
      dom.docsFailText.textContent = "文档站与本地服务均连接失败，无法加载文档列表";
    } else if (manifestErr) {
      dom.docsFailText.textContent = "文档清单加载失败（无法访问 docs.loopv.net），请确认文档站已部署";
    } else {
      dom.docsFailText.textContent = "文档显示状态加载失败，请稍后重试";
      // 会话过期/无权限走统一处理（跳登录/提示）
      const err = visRes.reason;
      if (err && (err.status === 401 || err.status === 403)) handleError(err);
    }
    dom.docsFail.classList.remove("hidden");
    return;
  }

  const docs = manifestRes.value;
  const hiddenList =
    visRes.value && Array.isArray(visRes.value.hidden) ? visRes.value.hidden : [];
  docsState.items = docs;
  docsState.hidden = new Set(hiddenList);
  docsState.dirty = false;

  if (!docs.length) {
    dom.docsEmpty.classList.remove("hidden");
    return;
  }

  renderDocsList();
  dom.docsList.classList.remove("hidden");
  dom.docsActions.classList.remove("hidden");
  updateDocsSaveBtn();
}

// 用 DOM API 构建文档列表行（slug/标题/分组均来自远端，避免 innerHTML 拼接）
function renderDocsList() {
  dom.docsList.innerHTML = "";
  for (const doc of docsState.items) {
    const slug = String(doc.slug || "");
    if (!slug) continue;
    const title = doc.title || slug;
    const group = doc.group || "";

    const row = document.createElement("div");
    row.className = "doc-row";
    row.dataset.slug = slug;

    const main = document.createElement("div");
    main.className = "doc-main";

    const head = document.createElement("div");
    head.className = "doc-head";
    const titleEl = document.createElement("span");
    titleEl.className = "doc-title";
    titleEl.textContent = title;
    titleEl.title = title;
    head.appendChild(titleEl);
    if (group) {
      const groupBadge = document.createElement("span");
      groupBadge.className = "doc-group-badge";
      groupBadge.textContent = group;
      head.appendChild(groupBadge);
    }
    main.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "doc-meta";
    meta.textContent = slug;
    main.appendChild(meta);

    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !docsState.hidden.has(slug); // 初始以隐藏列表为准，manifest 仅供参考
    cb.setAttribute("aria-label", `显示文档「${title}」`);
    cb.addEventListener("change", () => {
      toggleDocHidden(slug, cb.checked, row);
    });
    const slider = document.createElement("span");
    slider.className = "slider";
    slider.setAttribute("aria-hidden", "true");
    switchLabel.appendChild(cb);
    switchLabel.appendChild(slider);

    row.appendChild(main);
    row.appendChild(switchLabel);

    updateDocRowHidden(row, slug);
    dom.docsList.appendChild(row);
  }
}

// 行内开关反馈：隐藏的文档标题降灰
function updateDocRowHidden(row, slug) {
  row.classList.toggle("doc-hidden", docsState.hidden.has(slug));
}

// 点击开关仅改本地状态（不逐次保存），按 slug 增删隐藏集合
function toggleDocHidden(slug, visible, row) {
  if (visible) docsState.hidden.delete(slug);
  else docsState.hidden.add(slug);
  docsState.dirty = true;
  updateDocRowHidden(row, slug);
  updateDocsSaveBtn();
}

// 保存按钮仅在有未保存更改时可用
function updateDocsSaveBtn() {
  dom.btnSaveDocs.disabled = !docsState.dirty;
  dom.docsDirty.classList.toggle("hidden", !docsState.dirty);
}

// 保存后按后端回显的 hidden 数组同步所有行（规范化集合）
function syncDocsRows() {
  dom.docsList.querySelectorAll(".doc-row").forEach((row) => {
    const slug = row.dataset.slug;
    const cb = row.querySelector(".switch input");
    if (!slug || !cb) return;
    cb.checked = !docsState.hidden.has(slug);
    updateDocRowHidden(row, slug);
  });
}

async function saveDocsChanges() {
  if (!docsState.dirty) return;
  const hidden = [...docsState.hidden];
  dom.btnSaveDocs.disabled = true;
  try {
    const data = await api("/api/admin/docs", {
      method: "PUT",
      body: { hidden },
    });
    docsState.hidden = new Set(Array.isArray(data.hidden) ? data.hidden : hidden);
    docsState.dirty = false;
    let msg = "已保存，文档站正在重建（约 1 分钟生效）";
    if (data.hookFired === false) {
      msg += "（重建未自动触发，需手动推送或等待）";
    }
    toast(msg, "success");
    syncDocsRows();
    updateDocsSaveBtn();
  } catch (err) {
    handleError(err);
    updateDocsSaveBtn(); // 保存失败：仍是脏状态，恢复可重试
  }
}

function buildUserQuery() {
  const params = new URLSearchParams();
  if (userFilter.username.trim()) params.set("username", userFilter.username.trim());
  if (userFilter.nickname.trim()) params.set("nickname", userFilter.nickname.trim());
  if (userFilter.role) params.set("role", userFilter.role);
  if (userFilter.status) params.set("status", userFilter.status);
  return params.toString();
}

function buildMsgQuery() {
  const params = new URLSearchParams();
  params.set("limit", MSG_LIMIT);
  if (msgFilter.sender.trim()) params.set("sender", msgFilter.sender.trim());
  if (msgFilter.statuses.length) params.set("statuses", msgFilter.statuses.join(","));
  if (msgFilter.page > 1) params.set("page", msgFilter.page);
  const start = datetimeToUnix(msgFilter.start);
  const end = datetimeToUnix(msgFilter.end);
  if (start > 0) params.set("start", start);
  if (end > 0) params.set("end", end);
  return params.toString();
}

async function loadUsers() {
  dom.usersLoading.classList.remove("hidden");
  dom.usersEmpty.classList.add("hidden");
  dom.usersBody.innerHTML = "";
  try {
    const qs = buildUserQuery();
    const data = await api(`/api/admin/users${qs ? "?" + qs : ""}`);
    state.users = data.users || [];
    renderUsers();
  } catch (err) {
    handleError(err);
  } finally {
    dom.usersLoading.classList.add("hidden");
  }
}

// 解析分页响应；旧版无分页元数据的响应按单页兜底
function parseMsgPage(data) {
  const msgs = Array.isArray(data.messages) ? data.messages : [];
  const hasMeta = data.total != null && data.totalPages != null;
  if (hasMeta) {
    return {
      total: Number(data.total) || 0,
      page: Number(data.page) || 1,
      totalPages: Number(data.totalPages) || 0,
    };
  }
  return { total: msgs.length, page: 1, totalPages: msgs.length > 0 ? 1 : 0 };
}

async function loadMessages() {
  dom.messagesLoading.classList.remove("hidden");
  dom.messagesEmpty.classList.add("hidden");
  dom.messagesBody.innerHTML = "";
  state.selectedMsgIds.clear();
  try {
    let data = await api(`/api/admin/messages?${buildMsgQuery()}`);
    let meta = parseMsgPage(data);
    // 末页删空等场景：请求页超出末页时收敛回退到 totalPages 页重新拉取（至多一次，防死循环）
    if (meta.total > 0 && meta.totalPages > 0 && meta.page > meta.totalPages) {
      msgFilter.page = meta.totalPages;
      data = await api(`/api/admin/messages?${buildMsgQuery()}`);
      meta = parseMsgPage(data);
    }
    // total = 0 时停在 page 1 空态
    if (meta.total === 0) msgFilter.page = 1;

    state.messages = data.messages || [];
    msgPagination.total = meta.total;
    msgPagination.totalPages = meta.totalPages;
    renderMessages();
    renderPagination();
    updateBatchUI();
    // 翻页/重载后滚动容器即时回顶（非 smooth）
    if (dom.msgScroll) dom.msgScroll.scrollTop = 0;
  } catch (err) {
    handleError(err);
  } finally {
    dom.messagesLoading.classList.add("hidden");
  }
}

// ========== 消息分页 ==========
function renderPagination() {
  dom.paginationTotal.textContent = `共 ${msgPagination.total} 条`;
  const showNav = msgPagination.totalPages > 1;
  dom.paginationNav.classList.toggle("hidden", !showNav);
  if (!showNav) return;
  dom.btnMsgPrev.disabled = msgFilter.page <= 1;
  dom.btnMsgNext.disabled = msgFilter.page >= msgPagination.totalPages;
  dom.paginationInput.max = String(msgPagination.totalPages);
  dom.paginationInput.value = String(msgFilter.page);
  dom.paginationTotalPages.textContent = String(msgPagination.totalPages);
}

function goMsgPage(page) {
  const totalPages = Math.max(1, msgPagination.totalPages);
  const target = Math.max(1, Math.min(totalPages, Math.floor(page)));
  if (Number.isNaN(target) || target === msgFilter.page) return;
  msgFilter.page = target;
  loadMessages();
}

function jumpMsgPage() {
  const raw = dom.paginationInput.value.trim();
  if (!raw) {
    dom.paginationInput.value = String(msgFilter.page);
    return;
  }
  const val = Math.floor(Number(raw));
  if (!Number.isFinite(val)) {
    dom.paginationInput.value = String(msgFilter.page);
    return;
  }
  const totalPages = Math.max(1, msgPagination.totalPages);
  const target = Math.max(1, Math.min(totalPages, val));
  dom.paginationInput.value = String(target); // 越界收敛到 1..totalPages
  if (target !== msgFilter.page) {
    msgFilter.page = target;
    loadMessages();
  }
}

// ========== 渲染：用户 ==========
function renderUsers() {
  dom.usersBody.innerHTML = "";
  if (!state.users.length) {
    dom.usersEmpty.classList.remove("hidden");
    return;
  }
  dom.usersEmpty.classList.add("hidden");

  for (const u of state.users) {
    const tr = document.createElement("tr");
    const admin = isAdmin(u);
    const test = isTest(u);
    const banned = isBanned(u);
    const role = roleOf(u);

    // ID
    const tdId = document.createElement("td");
    tdId.className = "col-id";
    tdId.textContent = u.id;
    tr.appendChild(tdId);

    // 用户名
    const tdUser = document.createElement("td");
    const userWrap = document.createElement("div");
    userWrap.className = "cell-user";
    const avatar = document.createElement("div");
    avatar.className = "cell-avatar";
    fillAvatar(avatar, u.nickname || u.username, u.avatar_url || null);
    const nameSpan = document.createElement("span");
    nameSpan.className = "cell-username";
    nameSpan.textContent = u.username;
    userWrap.appendChild(avatar);
    userWrap.appendChild(nameSpan);
    tdUser.appendChild(userWrap);
    tr.appendChild(tdUser);

    // 昵称
    const tdNick = document.createElement("td");
    tdNick.className = "cell-dim";
    tdNick.textContent = u.nickname || "—";
    tr.appendChild(tdNick);

    // 头像（小图）
    const tdAvatar = document.createElement("td");
    const av2 = document.createElement("div");
    av2.className = "cell-avatar";
    fillAvatar(av2, u.nickname || u.username, u.avatar_url || null);
    tdAvatar.appendChild(av2);
    tr.appendChild(tdAvatar);

    // 角色
    const tdRole = document.createElement("td");
    const roleBadge = document.createElement("span");
    roleBadge.className = "badge " + role.cls;
    roleBadge.textContent = role.label;
    tdRole.appendChild(roleBadge);
    tr.appendChild(tdRole);

    // 状态
    const tdStatus = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = banned ? "badge badge-banned" : "badge badge-active";
    statusBadge.textContent = banned ? "已封禁" : "正常";
    tdStatus.appendChild(statusBadge);
    tr.appendChild(tdStatus);

    // 密码（测试用户显示明文，可切换）
    const tdPwd = document.createElement("td");
    if (test) {
      const wrap = document.createElement("div");
      wrap.className = "password-cell";
      const txt = document.createElement("span");
      txt.className = "password-value";
      txt.dataset.pwd = u.plain_password || "";
      txt.textContent = "••••••";
      const toggle = document.createElement("button");
      toggle.className = "password-toggle";
      toggle.type = "button";
      toggle.textContent = "显示";
      toggle.onclick = () => {
        if (txt.classList.contains("show")) {
          txt.textContent = "••••••";
          txt.classList.remove("show");
          toggle.textContent = "显示";
        } else {
          txt.textContent = txt.dataset.pwd || "";
          txt.classList.add("show");
          toggle.textContent = "隐藏";
        }
      };
      wrap.appendChild(txt);
      wrap.appendChild(toggle);
      tdPwd.appendChild(wrap);
    } else {
      tdPwd.className = "cell-dim";
      tdPwd.textContent = "—";
    }
    tr.appendChild(tdPwd);

    // 注册时间
    const tdTime = document.createElement("td");
    tdTime.className = "cell-dim mono";
    tdTime.textContent = formatTime(u.created_at);
    tr.appendChild(tdTime);

    // 操作
    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    if (admin) {
      const none = document.createElement("span");
      none.className = "action-none";
      none.textContent = "—";
      tdActions.appendChild(none);
    } else {
      const actions = document.createElement("div");
      actions.className = "actions";
      const banBtn = document.createElement("button");
      banBtn.className = banned ? "btn-action btn-success" : "btn-action btn-danger";
      banBtn.textContent = banned ? "解封" : "封禁";
      banBtn.onclick = () => toggleBan(u);
      const delBtn = document.createElement("button");
      delBtn.className = "btn-action btn-danger";
      delBtn.textContent = "删除";
      delBtn.onclick = () => confirmDeleteUser(u);
      actions.appendChild(banBtn);
      actions.appendChild(delBtn);
      tdActions.appendChild(actions);
    }
    tr.appendChild(tdActions);

    dom.usersBody.appendChild(tr);
  }
}

// ========== 渲染：消息 ==========
function renderMessages() {
  dom.messagesBody.innerHTML = "";
  if (!state.messages.length) {
    dom.messagesEmpty.classList.remove("hidden");
    return;
  }
  dom.messagesEmpty.classList.add("hidden");

  for (const m of state.messages) {
    const tr = document.createElement("tr");
    const deleted = m.deleted == null ? 0 : Number(m.deleted);
    const status = msgStatus(deleted);
    const meta = MSG_TYPES[m.type] || MSG_TYPES.text;
    if (deleted === 3) tr.classList.add("row-deleted");

    // 勾选框（已删除不可勾选）
    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    if (deleted !== 3) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.id = m.id;
      cb.checked = state.selectedMsgIds.has(Number(m.id));
      cb.onchange = () => {
        const id = Number(m.id);
        if (cb.checked) state.selectedMsgIds.add(id);
        else state.selectedMsgIds.delete(id);
        updateBatchUI();
      };
      tdCheck.appendChild(cb);
    }
    tr.appendChild(tdCheck);

    // ID
    const tdId = document.createElement("td");
    tdId.className = "col-id";
    tdId.textContent = m.id;
    tr.appendChild(tdId);

    // 发送者
    const tdNick = document.createElement("td");
    tdNick.textContent = m.nickname || "—";
    tr.appendChild(tdNick);

    // 类型
    const tdType = document.createElement("td");
    const typeWrap = document.createElement("span");
    typeWrap.className = "cell-type";
    typeWrap.innerHTML = meta.icon;
    typeWrap.appendChild(document.createTextNode(meta.label));
    tdType.appendChild(typeWrap);
    tr.appendChild(tdType);

    // 内容
    const tdContent = document.createElement("td");
    tdContent.className = "col-content";
    tdContent.appendChild(renderMsgPreview(m, deleted, meta));
    tr.appendChild(tdContent);

    // 时间
    const tdTime = document.createElement("td");
    tdTime.className = "cell-dim mono";
    tdTime.textContent = formatTime(m.created_at);
    tr.appendChild(tdTime);

    // 状态
    const tdStatus = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = "badge " + status.cls;
    statusBadge.textContent = status.label;
    tdStatus.appendChild(statusBadge);
    tr.appendChild(tdStatus);

    // 操作
    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    if (deleted === 3) {
      const none = document.createElement("span");
      none.className = "action-none";
      none.textContent = "—";
      tdActions.appendChild(none);
    } else {
      const actions = document.createElement("div");
      actions.className = "actions";
      if (deleted === 0) {
        const recallBtn = document.createElement("button");
        recallBtn.className = "btn-action btn-warn";
        recallBtn.textContent = "撤回";
        recallBtn.onclick = () => confirmRecallMessage(m);
        actions.appendChild(recallBtn);
      }
      const delBtn = document.createElement("button");
      delBtn.className = "btn-action btn-danger";
      delBtn.textContent = "删除";
      delBtn.onclick = () => confirmDeleteMessage(m);
      actions.appendChild(delBtn);
      tdActions.appendChild(actions);
    }
    tr.appendChild(tdActions);

    dom.messagesBody.appendChild(tr);
  }
}

function renderMsgPreview(m, deleted, meta) {
  const wrap = document.createElement("div");
  wrap.className = "msg-preview" + (deleted !== 0 ? " deleted" : "");

  if (deleted === 3) {
    wrap.textContent = "已删除";
    return wrap;
  }
  if (deleted === 1 || deleted === 2) {
    wrap.textContent = "消息已撤回";
    return wrap;
  }

  // 表情：直接显示内容
  if (m.type === "emoji" && m.content) {
    wrap.textContent = m.content;
    return wrap;
  }

  const hasMedia = !!m.media_url;
  if (hasMedia) {
    const link = document.createElement("a");
    link.href = m.media_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = "查看原始文件";
    link.innerHTML = meta.icon;
    link.appendChild(document.createTextNode(meta.label));
    wrap.appendChild(link);
  }

  if (m.content) {
    const txt = document.createElement("span");
    txt.className = "msg-preview-text";
    txt.textContent = m.content;
    if (hasMedia) txt.classList.add("cell-dim");
    wrap.appendChild(txt);
  }

  if (!hasMedia && !m.content) {
    wrap.textContent = meta.label;
  }

  return wrap;
}

// ========== 批量勾选 ==========
function updateBatchUI() {
  const selectable = state.messages.filter((m) => Number(m.deleted) !== 3);
  const selected = state.selectedMsgIds.size;
  const allChecked = selectable.length > 0 && selectable.every((m) => state.selectedMsgIds.has(Number(m.id)));

  dom.checkAll.checked = allChecked;
  dom.checkAll.disabled = selectable.length === 0;
  dom.btnBatchDelete.disabled = selected === 0;
  dom.batchCount.textContent = selected > 0 ? `已选 ${selected} 条` : "未选择消息";
  dom.batchCount.classList.toggle("active", selected > 0);
}

function syncCheckboxState() {
  dom.messagesBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = state.selectedMsgIds.has(Number(cb.dataset.id));
  });
  updateBatchUI();
}

// ========== 标签页 ==========
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });
  const showUsers = tab === "users";
  dom.panelUsers.classList.toggle("hidden", !showUsers);
  dom.panelMessages.classList.toggle("hidden", showUsers);

  if (showUsers && !state.users.length) {
    loadUsers();
  } else if (!showUsers && !state.messages.length) {
    loadMessages();
  }
}

// ========== 确认弹窗 ==========
let confirmCallback = null;

function confirmAction(title, text, onConfirm) {
  dom.confirmTitle.textContent = title;
  dom.confirmText.textContent = text;
  confirmCallback = onConfirm;
  dom.confirmModal.classList.remove("hidden");
}

function closeConfirm() {
  dom.confirmModal.classList.add("hidden");
  confirmCallback = null;
}

// ========== 用户操作 ==========
function toggleBan(user) {
  const banned = isBanned(user);
  const name = user.nickname || user.username;
  confirmAction(
    banned ? "解封用户" : "封禁用户",
    banned
      ? `确定要解封用户「${name}」吗？`
      : `确定要封禁用户「${name}」吗？`,
    async () => {
      try {
        await api(`/api/admin/users/${user.id}/ban`, {
          method: "POST",
          body: { banned: !banned },
        });
        toast(banned ? "已解封" : "已封禁", "success");
        loadUsers();
      } catch (err) {
        handleError(err);
      }
    }
  );
}

function confirmDeleteUser(user) {
  const name = user.nickname || user.username;
  confirmAction(
    "删除用户",
    `确定要删除用户「${name}」吗？`,
    async () => {
      try {
        await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
        toast("用户已删除", "success");
        loadUsers();
        loadStats();
      } catch (err) {
        handleError(err);
      }
    }
  );
}

// ========== 消息操作 ==========
function confirmRecallMessage(m) {
  confirmAction(
    "撤回消息",
    `确定要撤回消息 #${m.id} 吗？`,
    async () => {
      try {
        await api(`/api/admin/messages/${m.id}/recall`, { method: "POST" });
        toast("消息已撤回", "success");
        loadMessages();
        loadStats();
      } catch (err) {
        handleError(err);
      }
    }
  );
}

function confirmDeleteMessage(m) {
  confirmAction(
    "删除消息",
    `确定要删除消息 #${m.id} 吗？`,
    async () => {
      try {
        await api(`/api/admin/messages/${m.id}/delete`, { method: "POST" });
        toast("消息已删除", "success");
        loadMessages();
        loadStats();
      } catch (err) {
        handleError(err);
      }
    }
  );
}

function confirmBatchDelete() {
  const ids = [...state.selectedMsgIds];
  if (!ids.length) return;
  confirmAction(
    "批量删除",
    `确定要删除选中的 ${ids.length} 条消息吗？`,
    async () => {
      try {
        await api("/api/admin/messages/batch-delete", { method: "POST", body: { ids } });
        toast(`已删除 ${ids.length} 条消息`, "success");
        loadMessages();
        loadStats();
      } catch (err) {
        handleError(err);
      }
    }
  );
}

// ========== 创建测试用户 ==========
function openCreateModal() {
  dom.createUsername.value = "";
  dom.createPassword.value = "";
  dom.createNickname.value = "";
  dom.createFormWrap.classList.remove("hidden");
  dom.createResultWrap.classList.add("hidden");
  dom.createModal.classList.remove("hidden");
  setTimeout(() => dom.createUsername.focus(), 50);
}

function closeCreateModal() {
  dom.createModal.classList.add("hidden");
}

async function submitCreateUser() {
  const username = dom.createUsername.value.trim();
  const password = dom.createPassword.value;
  const nickname = dom.createNickname.value.trim();

  if (!username || !password) {
    toast("用户名和密码不能为空", "error");
    return;
  }

  dom.btnCreateSubmit.disabled = true;
  try {
    const data = await api("/api/admin/users", {
      method: "POST",
      body: { username, password, nickname: nickname || username },
    });
    // 展示结果（明文密码）
    dom.createResultPassword.textContent = data.user.plain_password;
    dom.createFormWrap.classList.add("hidden");
    dom.createResultWrap.classList.remove("hidden");
    dom.btnCreateSubmit.disabled = false;
    loadUsers();
    loadStats();
  } catch (err) {
    dom.btnCreateSubmit.disabled = false;
    handleError(err);
  }
}

async function copyPassword() {
  const pwd = dom.createResultPassword.textContent;
  if (!pwd) return;
  try {
    await navigator.clipboard.writeText(pwd);
    toast("已复制到剪贴板", "success");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = pwd;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("已复制到剪贴板", "success");
    } catch {
      toast("复制失败，请手动复制", "error");
    }
    ta.remove();
  }
}

// ========== 筛选 ==========
function applyUserFilter() {
  userFilter.username = dom.fUsername.value;
  userFilter.nickname = dom.fNickname.value;
  userFilter.role = dom.fRole.value;
  userFilter.status = dom.fStatus.value;
  loadUsers();
}

function resetUserFilter() {
  dom.fUsername.value = "";
  dom.fNickname.value = "";
  dom.fRole.value = "";
  dom.fStatus.value = "";
  userFilter.username = "";
  userFilter.nickname = "";
  userFilter.role = "";
  userFilter.status = "";
  loadUsers();
}

// 读取当前勾选的状态 chip（值 0..3，全不勾 = 全部状态）
function selectedMsgStatuses() {
  const statuses = [];
  dom.msgStatusChips.querySelectorAll(".chip-input:checked").forEach((cb) => {
    const v = Number(cb.value);
    if (!Number.isNaN(v)) statuses.push(v);
  });
  return statuses;
}

function clearMsgStatusChips() {
  dom.msgStatusChips.querySelectorAll(".chip-input").forEach((cb) => {
    cb.checked = false;
  });
}

function applyMsgFilter() {
  msgFilter.start = dom.fStart.value;
  msgFilter.end = dom.fEnd.value;
  msgFilter.sender = dom.fSender.value;
  msgFilter.statuses = selectedMsgStatuses();
  msgFilter.page = 1; // 筛选条件变化 → 回到第 1 页
  loadMessages();
}

function resetMsgFilter() {
  dom.fStart.value = "";
  dom.fEnd.value = "";
  dom.fSender.value = "";
  clearMsgStatusChips();
  msgFilter.start = "";
  msgFilter.end = "";
  msgFilter.sender = "";
  msgFilter.statuses = [];
  msgFilter.page = 1;
  loadMessages();
}

// ========== 事件绑定 ==========
function bindEvents() {
  dom.loginForm.addEventListener("submit", handleLogin);
  dom.btnLogout.addEventListener("click", handleLogout);

  document.querySelectorAll(".tab").forEach((el) => {
    el.addEventListener("click", () => switchTab(el.dataset.tab));
  });

  // 确认弹窗
  dom.confirmCancel.addEventListener("click", closeConfirm);
  dom.confirmOk.addEventListener("click", () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  });
  dom.confirmModal.addEventListener("click", (e) => {
    if (e.target === dom.confirmModal) closeConfirm();
  });

  // 用户筛选
  dom.btnUserQuery.addEventListener("click", applyUserFilter);
  dom.btnUserReset.addEventListener("click", resetUserFilter);
  dom.fUsername.addEventListener("keydown", (e) => e.key === "Enter" && applyUserFilter());
  dom.fNickname.addEventListener("keydown", (e) => e.key === "Enter" && applyUserFilter());

  // 消息筛选
  dom.btnMsgQuery.addEventListener("click", applyMsgFilter);
  dom.btnMsgReset.addEventListener("click", resetMsgFilter);
  dom.fSender.addEventListener("keydown", (e) => e.key === "Enter" && applyMsgFilter());

  // 消息分页
  dom.btnMsgPrev.addEventListener("click", () => goMsgPage(msgFilter.page - 1));
  dom.btnMsgNext.addEventListener("click", () => goMsgPage(msgFilter.page + 1));
  dom.paginationInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      jumpMsgPage();
    }
  });
  dom.paginationInput.addEventListener("blur", jumpMsgPage);

  // 批量删除 + 全选
  dom.btnBatchDelete.addEventListener("click", confirmBatchDelete);
  dom.checkAll.addEventListener("change", () => {
    const selectable = state.messages.filter((m) => Number(m.deleted) !== 3);
    if (dom.checkAll.checked) {
      selectable.forEach((m) => state.selectedMsgIds.add(Number(m.id)));
    } else {
      selectable.forEach((m) => state.selectedMsgIds.delete(Number(m.id)));
    }
    syncCheckboxState();
  });

  // 邀请码设置
  dom.btnSaveInvite.addEventListener("click", saveInviteSettings);
  dom.inviteCodeInput.addEventListener("keydown", (e) => e.key === "Enter" && saveInviteSettings());

  // 文档管理
  dom.btnDocsRetry.addEventListener("click", loadDocsPanel);
  dom.btnSaveDocs.addEventListener("click", saveDocsChanges);

  // 创建用户弹窗
  dom.btnCreateUser.addEventListener("click", openCreateModal);
  dom.btnCreateClose.addEventListener("click", closeCreateModal);
  dom.btnCreateCancel.addEventListener("click", closeCreateModal);
  dom.btnCreateSubmit.addEventListener("click", submitCreateUser);
  dom.btnCopyPassword.addEventListener("click", copyPassword);
  dom.btnCreateDone.addEventListener("click", closeCreateModal);
  dom.createModal.addEventListener("click", (e) => {
    if (e.target === dom.createModal) closeCreateModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeConfirm();
      closeCreateModal();
    }
  });
}

// ========== 启动 ==========
function init() {
  bindEvents();
  tryRestoreSession();
}

init();
