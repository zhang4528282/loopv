// 构建期产物：/manifest.json
// 供 admin.loopv.net 后台跨域读取，列出全部文档（含被隐藏的），
// hidden 标记该文档在本轮构建时刻是否被后台隐藏。
// 内容完全来自构建数据，无需请求参数，纯静态输出。
import { loadDocs } from "../lib/docs";

export const prerender = true;

export async function GET(): Promise<Response> {
  const { all, hidden } = await loadDocs();
  const payload = {
    docs: all.map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      group: doc.group,
      hidden: hidden.has(doc.slug),
    })),
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
