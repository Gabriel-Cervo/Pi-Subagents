import { promises as fs } from "node:fs";
import path from "node:path";

export const MAX_OUTPUT_BYTES = 50 * 1024;
export function truncate(text: string, max = MAX_OUTPUT_BYTES): string {
  if (max <= 0) return "";
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= max) return text;
  const marker = (omitted: number) => `\n\n[truncated ${omitted} bytes]`;
  // Reserve space for the notice, then reduce by UTF-8 byte length rather than
  // JavaScript code-unit length. The returned string is always <= max bytes.
  let prefix = text;
  let notice = marker(bytes);
  while (Buffer.byteLength(prefix, "utf8") + Buffer.byteLength(notice, "utf8") > max && prefix.length) {
    prefix = prefix.slice(0, -1);
    notice = marker(bytes - Buffer.byteLength(prefix, "utf8"));
  }
  if (!prefix.length && Buffer.byteLength(notice, "utf8") > max) {
    notice = notice.slice(0, max);
    while (Buffer.byteLength(notice, "utf8") > max) notice = notice.slice(0, -1);
  }
  return `${prefix}${notice}`;
}
export function textOf(message: any): string {
  if (!message || !Array.isArray(message.content)) return "";
  if (message.role !== "assistant" && message.role !== "user") return "";
  return message.content.filter((x: any) => x?.type === "text" && typeof x.text === "string").map((x: any) => x.text).join("");
}

/** Convert parent context to readable Markdown, intentionally excluding images and tool plumbing. */
export function readableContext(entries: unknown, maxBytes = MAX_OUTPUT_BYTES): string {
  const lines: string[] = [];
  const visit = (value: any): void => {
    if (!value) return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (typeof value !== "object") return;
    const role = value.role;
    const text = textOf(value);
    if (text && (role === "user" || role === "assistant")) lines.push(`### ${role === "user" ? "User" : "Assistant"}\n${text}`);
    // Session entries commonly wrap their message in `message`; recurse only through
    // known conversational containers, never arbitrary tool input/output objects.
    if (value.message) visit(value.message);
    if (value.messages) visit(value.messages);
    if (!role && value.content) visit({ role: "user", content: value.content });
  };
  visit(entries);
  return truncate(lines.join("\n\n"), maxBytes);
}
export function safeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
export async function atomicWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}
export function nearest(start: string, leaf: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, leaf);
    try { return candidate; } catch { /* continue */ }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
