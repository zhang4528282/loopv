// ========== 常量与状态 ==========
const ROOM_ID = new URLSearchParams(location.search).get("room") || "general";
const MAX_HISTORY = 50;

// 表情包列表
const EMOJIS = ["😀","😂","🤣","😍","🥰","😘","😜","🤪","😎","🤩","😤","😭","😱","🤯","🥳","🫠",
  "👍","👎","👏","🙌","🤝","💪","🫶","🔥","💯","❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔",
  "🐱","🐶","🐼","🦊","🐸","🐵","🦄","🐙","🌸","🌺","🌻","🌙","⭐","🌈","🍕","🍔","🍣","🎉","🎸","🚀"];

// 头像颜色
const AVATAR_COLORS = [
  "#6c5ce7","#a78bfa","#e879f9","#f472b6","#fb7185",
  "#f97316","#fbbf24","#34d399","#22d3ee","#38bdf8","#818cf8",
];

// 随机昵称模板
const NICK_ADJ = ["快乐的","忧郁的","愤怒的","神秘的","赛博","蒸汽","极客","咸鱼","佛系","硬核","摸鱼的","打工人","深夜","早起","下雨的"];
const NICK_NOUN = ["熊猫","企鹅","刺猬","树懒","柴犬","橘猫","海獭","考拉","水豚","蜜獾","面包","泡面","奶茶","咖啡","键盘"];

const state = {
  sessionId: genId(),
  nickname: loadNickname(),
  avatarSeed: loadAvatarSeed(),
  avatarColor: "",
  ws: null,
  reconnectTimer: null,
  pendingFile: null,
};

// ========== DOM 引用 ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  roomName: $("#room-name"),
  messages: $("#messages"),
  messagesEmpty: $("#messages-empty"),
  msgInput: $("#msg-input"),
  btnSend: $("#btn-send"),
  btnUpload: $("#btn-upload"),
  fileInput: $("#file-input"),
  btnEmoji: $("#btn-emoji"),
  emojiPicker: $("#emoji-picker"),
  emojiGrid: $("#emoji-grid"),
  uploadPreview: $("#upload-preview"),
  uploadPreviewImg: $("#upload-preview-img"),
  btnClearUpload: $("#btn-clear-upload"),
  mediaPreview: $("#media-preview"),
  mediaBackdrop: $("#media-backdrop"),
  mediaContent: $("#media-content"),
  settingsModal: $("#settings-modal"),
  nicknameInput: $("#nickname-input"),
  btnSettings: $("#btn-settings"),
  btnRandomNick: $("#btn-random-nick"),
  btnSaveNick: $("#btn-save-nick"),
  myNickname: $("#my-nickname"),
  onlineDot: $("#online-dot"),
};

// ========== 工具函数 ==========
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function randomNick() {
  const adj = NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)];
  const noun = NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)];
  return `${adj}${noun}`;
}

function loadNickname() {
  return localStorage.getItem("loopv_nickname") || randomNick();
}

function saveNickname(name) {
  localStorage.setItem("loopv_nickname", name);
  state.nickname = name;
  dom.myNickname.textContent = name;
}

function loadAvatarSeed() {
  let seed = localStorage.getItem("loopv_avatar");
  if (!seed) {
    seed = genId();
    localStorage.setItem("loopv_avatar", seed);
  }
  return seed;
}

function avatarColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ========== 初始化 ==========
function init() {
  state.avatarColor = avatarColor(state.avatarSeed);
  dom.roomName.textContent = ROOM_ID;
  dom.myNickname.textContent = state.nickname;
  dom.nicknameInput.value = state.nickname;

  loadHistory();
  connectWs();
  bindEvents();
  renderEmojiGrid();
}

// ========== 历史消息 ==========
async function loadHistory() {
  try {
    const res = await fetch(`/api/history?room=${ROOM_ID}&limit=${MAX_HISTORY}`);
    const data = await res.json();
    if (data.messages?.length) {
      dom.messagesEmpty.classList.add("hidden");
      for (const msg of data.messages) {
        appendMessage(msg, false);
      }
    }
    scrollToBottom();
  } catch {
    // 忽略加载失败
  }
}

// ========== WebSocket ==========
function connectWs() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/ws?room=${ROOM_ID}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log("WS connected");
    dom.onlineDot.style.background = "#22c55e";
    dom.onlineDot.style.boxShadow = "0 0 6px #22c55e";
  };

  state.ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "message") {
        dom.messagesEmpty.classList.add("hidden");
        appendMessage(data, true);
        scrollToBottom();
      }
    } catch {}
  };

  state.ws.onclose = () => {
    console.log("WS disconnected, reconnecting…");
    dom.onlineDot.style.background = "#f97316";
    dom.onlineDot.style.boxShadow = "0 0 6px #f97316";
    scheduleReconnect();
  };

  state.ws.onerror = () => {
    state.ws?.close();
  };
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(connectWs, 3000);
}

// ========== 消息渲染 ==========
function appendMessage(msg, animate) {
  // msg 来自 WebSocket 时字段名略有不同
  const type = msg.msg_type || msg.type;
  const content = msg.content || "";
  const mediaUrl = msg.media_url;
  const mediaType = msg.media_type;
  const nickname = msg.nickname || "匿名";
  const avatarSeed = msg.avatar_seed || "1";
  const color = avatarColor(avatarSeed);
  const time = formatTime(msg.created_at || Date.now());
  const isOwn = msg.session_id === state.sessionId;

  const row = document.createElement("div");
  row.className = `msg-row${isOwn ? " own" : ""}`;
  if (animate) row.style.animation = "fadeIn 0.2s ease-out";

  // 头像
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.style.background = color;
  avatar.textContent = nickname.charAt(0).toUpperCase();

  // 消息体
  const body = document.createElement("div");
  body.className = "msg-body";

  const nick = document.createElement("span");
  nick.className = "msg-nick";
  nick.textContent = nickname;

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  // 根据消息类型渲染内容
  switch (type) {
    case "text":
      bubble.textContent = content;
      break;
    case "image":
      if (mediaUrl) {
        const img = document.createElement("img");
        img.src = mediaUrl;
        img.alt = "图片";
        img.loading = "lazy";
        img.onclick = () => openPreview("image", mediaUrl);
        bubble.appendChild(img);
        if (content) {
          const txt = document.createElement("p");
          txt.textContent = content;
          bubble.appendChild(txt);
        }
      }
      break;
    case "video":
      if (mediaUrl) {
        const vid = document.createElement("video");
        vid.src = mediaUrl;
        vid.controls = true;
        vid.preload = "metadata";
        vid.onclick = (e) => { e.stopPropagation(); openPreview("video", mediaUrl); };
        bubble.appendChild(vid);
        if (content) {
          const txt = document.createElement("p");
          txt.textContent = content;
          bubble.appendChild(txt);
        }
      }
      break;
    case "audio":
      if (mediaUrl) {
        const aud = document.createElement("audio");
        aud.src = mediaUrl;
        aud.controls = true;
        aud.preload = "metadata";
        bubble.appendChild(aud);
        if (content) {
          const txt = document.createElement("p");
          txt.textContent = content;
          bubble.appendChild(txt);
        }
      }
      break;
    case "emoji":
      bubble.style.fontSize = "32px";
      bubble.style.padding = "6px 10px";
      bubble.textContent = content;
      break;
    default:
      bubble.textContent = content || "[未知消息类型]";
  }

  const timeEl = document.createElement("span");
  timeEl.className = "msg-time";
  timeEl.textContent = time;

  body.appendChild(nick);
  body.appendChild(bubble);
  body.appendChild(timeEl);
  row.appendChild(avatar);
  row.appendChild(body);
  dom.messages.appendChild(row);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  });
}

// ========== 发送消息 ==========
async function sendMessage(type, content, mediaUrl, mediaType) {
  const payload = {
    room_id: ROOM_ID,
    session_id: state.sessionId,
    nickname: state.nickname,
    avatar_seed: state.avatarSeed,
    type,
    content,
    media_url: mediaUrl || undefined,
    media_type: mediaType || undefined,
  };

  // 通过 WebSocket 发送
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  } else {
    // WebSocket 断开时通过 HTTP fallback
    await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  // 清空输入
  dom.msgInput.value = "";
  dom.msgInput.style.height = "auto";
}

// ========== 文件上传 ==========
async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");

  const data = await res.json();
  return data;
}

function handleFileSelected(file) {
  if (!file) return;

  // 显示预览
  if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    dom.uploadPreviewImg.src = url;
    dom.uploadPreviewImg.style.display = "block";
    dom.uploadPreview.classList.remove("hidden");
    state.pendingFile = { file, type: "image" };
  } else if (file.type.startsWith("video/")) {
    dom.uploadPreviewImg.src = "";
    dom.uploadPreviewImg.style.display = "none";
    dom.uploadPreview.classList.remove("hidden");
    state.pendingFile = { file, type: "video" };
  } else if (file.type.startsWith("audio/")) {
    dom.uploadPreviewImg.src = "";
    dom.uploadPreviewImg.style.display = "none";
    dom.uploadPreview.classList.remove("hidden");
    state.pendingFile = { file, type: "audio" };
  }
}

async function sendPendingFile() {
  if (!state.pendingFile) return false;

  const { file, type } = state.pendingFile;
  try {
    const uploaded = await uploadFile(file);
    await sendMessage(type, dom.msgInput.value.trim() || "", uploaded.url, uploaded.contentType);
    clearPendingFile();
    return true;
  } catch (e) {
    alert("文件上传失败，请重试");
    return false;
  }
}

function clearPendingFile() {
  state.pendingFile = null;
  dom.uploadPreview.classList.add("hidden");
  dom.uploadPreviewImg.src = "";
  dom.uploadPreviewImg.style.display = "block";
  dom.fileInput.value = "";
}

// ========== 媒体预览 ==========
function openPreview(type, url) {
  dom.mediaContent.innerHTML = "";
  if (type === "image") {
    const img = document.createElement("img");
    img.src = url;
    dom.mediaContent.appendChild(img);
  } else if (type === "video") {
    const vid = document.createElement("video");
    vid.src = url;
    vid.controls = true;
    vid.autoplay = true;
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
    btn.textContent = emoji;
    btn.onclick = () => {
      dom.msgInput.value += emoji;
      dom.msgInput.focus();
      dom.emojiPicker.classList.add("hidden");
    };
    dom.emojiGrid.appendChild(btn);
  }
}

// ========== 事件绑定 ==========
function bindEvents() {
  // 发送按钮
  dom.btnSend.addEventListener("click", handleSend);

  // Enter 发送
  dom.msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // 输入框自动调整高度
  dom.msgInput.addEventListener("input", () => {
    dom.msgInput.style.height = "auto";
    dom.msgInput.style.height = Math.min(dom.msgInput.scrollHeight, 120) + "px";
  });

  // 文件上传按钮
  dom.btnUpload.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", () => {
    if (dom.fileInput.files?.[0]) {
      handleFileSelected(dom.fileInput.files[0]);
    }
  });

  // 清除预览
  dom.btnClearUpload.addEventListener("click", clearPendingFile);

  // Emoji 按钮
  dom.btnEmoji.addEventListener("click", (e) => {
    e.stopPropagation();
    dom.emojiPicker.classList.toggle("hidden");
  });

  // 点击外部关闭 emoji 选择器
  document.addEventListener("click", (e) => {
    if (!dom.emojiPicker.contains(e.target) && e.target !== dom.btnEmoji) {
      dom.emojiPicker.classList.add("hidden");
    }
  });

  // 媒体预览关闭
  dom.mediaBackdrop.addEventListener("click", closePreview);

  // 设置弹窗
  dom.btnSettings.addEventListener("click", () => {
    dom.nicknameInput.value = state.nickname;
    dom.settingsModal.classList.remove("hidden");
  });

  dom.btnRandomNick.addEventListener("click", () => {
    dom.nicknameInput.value = randomNick();
  });

  dom.btnSaveNick.addEventListener("click", () => {
    const name = dom.nicknameInput.value.trim();
    if (name) {
      saveNickname(name);
      dom.settingsModal.classList.add("hidden");
    }
  });

  dom.settingsModal.addEventListener("click", (e) => {
    if (e.target === dom.settingsModal) {
      dom.settingsModal.classList.add("hidden");
    }
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

async function handleSend() {
  const text = dom.msgInput.value.trim();

  // 如果有待发送的文件
  if (state.pendingFile) {
    await sendPendingFile();
    return;
  }

  // 纯文本
  if (!text) return;
  await sendMessage("text", text);
}

// ========== 启动 ==========
init();
