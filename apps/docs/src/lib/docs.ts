import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

/* ------------------------------------------------------------------
 * 仓库根目录定位
 * 本文件位于 apps/docs/src/lib/docs.ts，相对 import.meta.url 上溯 4 级：
 *   lib → src → docs → apps → 仓库根
 * 用 import.meta.url 而不是 process.cwd()，保证 dev / build / preview
 * 三种执行场景定位一致（pnpm --filter 执行时 cwd 恰好也在 apps/docs，
 * 两种方式结果相同，但前者与调用目录彻底解耦，更稳）。
 * ------------------------------------------------------------------ */
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/* ------------------------------------------------------------------
 * 源文件清单（相对仓库根）。内容只读不改，构建时按需加载。
 * 展示顺序即分组内顺序：README → 项目上下文 → 开发日志 → 协作约定
 * ------------------------------------------------------------------ */
interface SourceDef {
  repoPath: string;
  slug: string;
  group: string;
}

const SOURCES: SourceDef[] = [
  { repoPath: "README.md", slug: "readme", group: "项目文档" },
  { repoPath: "CONTEXT.md", slug: "context", group: "项目文档" },
  { repoPath: "CHANGELOG.md", slug: "changelog", group: "项目文档" },
  { repoPath: "AGENTS.md", slug: "agents", group: "项目文档" },
  { repoPath: "docs/chat-manual.md", slug: "chat-manual", group: "操作手册" },
];

/** 分组的固定顺序（按源清单首次出现次序）——分组是稳定身份，展示序号会随可见性重新编排 */
const GROUP_ORDER: string[] = SOURCES.reduce<string[]>((acc, s) => {
  if (!acc.includes(s.group)) acc.push(s.group);
  return acc;
}, []);

/** 全部已知 slug，用于过滤后台下发的隐藏列表 */
const KNOWN_SLUGS = new Set(SOURCES.map((s) => s.slug));

/* ------------------------------------------------------------------
 * slugify：中英文都可用。把标题切成"中文段 / 非中文段"交替，再各自清洗：
 *   中文段整体保留；西文段去标点、空格转连字符。最终段间用 '-' 相连，
 *   避免「一、聊天室（chat.loopv.net）」粘连成一串；重复 h2/h3 交给
 *   markdown-it-anchor 自动去重加后缀。
 * ------------------------------------------------------------------ */
function slugify(raw: string): string {
  const cleaned = String(raw)
    .trim()
    .toLowerCase()
    .split(/([\u4e00-\u9fa5]+)/g)
    .map((part) => {
      if (!part) return "";
      if (/^[\u4e00-\u9fa5]+$/.test(part)) return part; // 纯中文段
      // 西文/数字段：空白与斜杠先转连字符，再剔除其余非法字符（保留 '.'，如 chat.loopv.net）
      return part
        .replace(/[\s/]+/g, "-")
        .replace(/[^a-z0-9_.-]/g, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-|-$/g, "");
    })
    .filter(Boolean)
    .join("-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "section";
}

/* ------------------------------------------------------------------
 * markdown-it：html + linkify 按任务要求开启；typographer 关闭。
 * markdown-it-anchor 只给 h2/h3 挂锚点 id（正文目录用）。
 * ------------------------------------------------------------------ */
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
md.use(markdownItAnchor as any, { level: [2, 3], slugify });

/* ------------------------------------------------------------------
 * 构建产物：单篇文档的数据结构
 * ------------------------------------------------------------------ */
export interface Doc {
  /** 页面 slug，如 readme / chat-manual */
  slug: string;
  /** 相对仓库根的源文件路径，如 docs/chat-manual.md */
  repoPath: string;
  /** 所属分组 */
  group: string;
  /** 标题：frontmatter title → 首个 h1 文本 → 文件名 */
  title: string;
  /** 摘要：正文第一段有意义的文本（无段落时退回第一条列表项） */
  summary: string;
  /** 渲染后的正文 HTML（已去掉第一个 h1，标题由页面单独展示） */
  bodyHtml: string;
}

/* ---------- 后处理工具 ---------- */

/** 去掉正文中第一个 <h1>（标题已在页面层展示，避免重复） */
function stripLeadingH1(html: string): string {
  return html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/, "");
}

/** 给表格套横向滚动容器（窄屏时表内滚动，不撑破布局） */
function wrapTables(html: string): string {
  return html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

/**
 * 重写站内相对 .md 链接 → 本文档站对应页面。
 * 目前只有 README 底部的 `docs/chat-manual.md` 一处，指向仓库文件而非
 * 线上 URL，直接照搬会在文档站里 404，所以做最小必要的映射。
 * 若映射目标是后台隐藏的文档，这里仍先生成站内 href，由后续
 * unlinkHiddenTargets 把整条链接还原成纯文本（见下）。
 */
function rewriteInternalLinks(html: string): string {
  const byRepoPath = new Map(SOURCES.map((s) => [s.repoPath, s]));
  const byFileName = new Map(SOURCES.map((s) => [path.basename(s.repoPath), s]));
  return html.replace(/href="([^"]*\.md)(#[^"]*)?"/g, (whole, target: string, hash = "") => {
    const clean = target.replace(/^\.\//, "");
    const doc = byRepoPath.get(clean) ?? byFileName.get(clean);
    return doc ? `href="/${doc.slug}${hash}"` : whole;
  });
}

/**
 * 把指向"已被后台隐藏"文档的站内 <a> 还原为纯文本。
 * 隐藏的 slug 没有生成页面，保留链接会落 404，故只保留链接文字。
 */
function unlinkHiddenTargets(html: string, hidden: Set<string>): string {
  if (hidden.size === 0) return html;
  return html.replace(
    /<a href="\/([a-z0-9._-]+)(?:#[^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi,
    (whole, slug: string, inner: string) => (hidden.has(slug) ? inner : whole),
  );
}

/** 把一段 HTML 压成纯文本（解码少量实体、折叠空白） */
function toPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 摘取"正文第一段"。严格取字面第一段在某些文件里会是「最后更新: 2026-09-02」
 * 这类元信息，观感不佳。故做一层轻规则：
 *   优先 → 含句号且较长（≥15 字）的段落
 *   其次 → 任意含句号的段落 / 任意较长的段落 / 第一个段落
 *   全文无段落（如 CHANGELOG 几乎全是列表）→ 退回第一条列表文字
 * 规则完全由内容驱动，不针对单篇写死文案。
 */
function extractSummary(bodyHtml: string): string {
  const paragraphs = [...bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => toPlainText(m[1]))
    .filter((t) => t.length > 0);

  const pick =
    paragraphs.find((t) => t.includes("。") && t.length >= 15) ??
    paragraphs.find((t) => t.includes("。")) ??
    paragraphs.find((t) => t.length >= 15) ??
    paragraphs[0];

  if (pick) return pick;

  const firstLi = bodyHtml.match(/<li[^>]*>([\s\S]*?)<\/li>/);
  return firstLi ? toPlainText(firstLi[1]) : "";
}

/* ---------- 编译单份文档 ---------- */

function compileSource(src: SourceDef): Doc {
  const absPath = path.join(REPO_ROOT, src.repoPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`[docs] 找不到源文档: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, "utf8");
  const { data, content } = matter(raw);

  const baseName = path.basename(src.repoPath, path.extname(src.repoPath));
  const title =
    (typeof (data as any)?.title === "string" && (data as any).title.trim()) ||
    content.match(/^#\s+(.+)/)?.[1]?.trim() ||
    baseName;

  let html = md.render(content);
  html = stripLeadingH1(html);
  html = wrapTables(html);
  html = rewriteInternalLinks(html);

  return {
    slug: src.slug,
    repoPath: src.repoPath,
    group: src.group,
    title,
    summary: extractSummary(html),
    bodyHtml: html,
  };
}

/* ------------------------------------------------------------------
 * 可见性数据源（后台控制"哪些文档显示"）
 *
 * 契约：GET https://chat.loopv.net/api/docs/visibility → 200
 *   { "hidden": ["changelog"] }（无隐藏时为 { "hidden": [] }），无鉴权。
 *
 * 失败降级（fail-open）：请求失败 / 超时 / 非 200 / JSON 解析异常 / 格式
 * 不符，一律当作 hidden=[]（全部显示），绝不因拉取失败而让构建崩溃。
 * ------------------------------------------------------------------ */
const VISIBILITY_ENDPOINT =
  process.env.DOCS_VISIBILITY_URL ?? "https://chat.loopv.net/api/docs/visibility";

/** 拉取超时：4 秒（AbortController + setTimeout，兼容性最稳） */
const FETCH_TIMEOUT_MS = 4000;

async function fetchHiddenSlugs(): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(VISIBILITY_ENDPOINT, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[docs] 可见性接口返回 HTTP ${res.status}，按"全部显示"处理`);
      return [];
    }
    const data: unknown = await res.json();
    const rawHidden = (data as { hidden?: unknown }).hidden;
    if (!Array.isArray(rawHidden)) {
      console.warn('[docs] 可见性接口格式异常（缺 hidden 数组），按"全部显示"处理');
      return [];
    }
    // trim + 去重 + 只保留本站确实收录的 slug
    return [...new Set(rawHidden.map((x) => (typeof x === "string" ? x.trim() : "")).filter((s) => s !== "" && KNOWN_SLUGS.has(s)))];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[docs] 拉取文档可见性失败（${reason}），按"全部显示"处理`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/*
 * 构建期每个模块实例会被多个入口（首页 / 各 slug 页 / manifest）分别加载，
 * 缓存挂在 globalThis 上保证整个构建进程只真正拉取一次接口。
 */
const HIDDEN_CACHE_KEY = "__loopv_docs_hidden_v1";

/** 后台隐藏的 slug 列表（已 trim / 去重 / 过滤未知 slug）。失败时返回 []。 */
export function getHiddenSlugs(): Promise<string[]> {
  const g = globalThis as unknown as Record<string, Promise<string[]> | undefined>;
  g[HIDDEN_CACHE_KEY] ??= fetchHiddenSlugs();
  return g[HIDDEN_CACHE_KEY];
}

/* ------------------------------------------------------------------
 * 可见性过滤 + 对外查询
 * ------------------------------------------------------------------ */

export interface DocsSnapshot {
  /** 仓库全部收录（含被隐藏的），顺序 = 源清单顺序 */
  all: Doc[];
  /** 可见子集：正文已处理"指向隐藏文档的链接还原为纯文本" */
  visible: Doc[];
  /** 被后台隐藏的 slug 集合 */
  hidden: Set<string>;
}

async function buildSnapshot(): Promise<DocsSnapshot> {
  const hidden = new Set(await getHiddenSlugs());
  const all = SOURCES.map(compileSource);
  // 隐藏文档的页面不会被渲染；对可见文档处理指向隐藏目标的站内链接
  const visible =
    hidden.size === 0
      ? all
      : all
          .filter((d) => !hidden.has(d.slug))
          .map((d) => ({ ...d, bodyHtml: unlinkHiddenTargets(d.bodyHtml, hidden) }));

  return { all, visible, hidden };
}

const SNAPSHOT_CACHE_KEY = "__loopv_docs_snapshot_v1";

/** 文档可见性快照（构建期一次性，缓存于 globalThis，全进程共享） */
export function loadDocs(): Promise<DocsSnapshot> {
  const g = globalThis as unknown as Record<string, Promise<DocsSnapshot> | undefined>;
  g[SNAPSHOT_CACHE_KEY] ??= buildSnapshot();
  return g[SNAPSHOT_CACHE_KEY];
}

export interface DocGroupView {
  /** 展示序号（0 起）：只统计"有可见文档"的分组并顺延重新编号 */
  index: number;
  name: string;
  /** 该分组可见文档（组内顺序 = 源清单顺序） */
  items: Doc[];
}

/**
 * 可见分组的目录视图：按 GROUP_ORDER 遍历，空分组（全部被隐藏）剔除。
 * 首页列表与单篇页面包屑都从这里取序号，保证两处编号一致。
 */
export async function getVisibleGroupViews(): Promise<DocGroupView[]> {
  const { visible } = await loadDocs();
  const views: DocGroupView[] = [];
  for (const name of GROUP_ORDER) {
    const items = visible.filter((d) => d.group === name);
    if (items.length > 0) {
      views.push({ index: views.length, name, items });
    }
  }
  return views;
}
