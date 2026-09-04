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

/* ---------- 对外查询（模块级缓存，只读一次） ---------- */

let cache: Doc[] | null = null;

function allDocs(): Doc[] {
  if (!cache) {
    cache = SOURCES.map(compileSource);
  }
  return cache;
}

/** 分组后的全部文档（组内顺序 = 源清单顺序） */
export function getDocGroups(): { name: string; items: Doc[] }[] {
  const order: string[] = [];
  const grouped = new Map<string, Doc[]>();
  for (const doc of allDocs()) {
    if (!grouped.has(doc.group)) {
      grouped.set(doc.group, []);
      order.push(doc.group);
    }
    grouped.get(doc.group)!.push(doc);
  }
  return order.map((name) => ({ name, items: grouped.get(name)! }));
}

export function getDocBySlug(slug: string): Doc | undefined {
  return allDocs().find((d) => d.slug === slug);
}
