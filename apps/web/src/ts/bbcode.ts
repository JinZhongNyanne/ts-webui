/**
 * TeamSpeak BBCode → HTML for `v-html`.
 *
 * Chat text, channel descriptions and welcome messages are written by anyone on
 * the server, so the output must be safe no matter what the input is. That is
 * why this is a parser and not a chain of regex replacements: the input is
 * split into text and tags, the tags are checked against a whitelist and built
 * into a tree, and only then is HTML written — every piece of text and every
 * attribute value escaped on the way out. Nothing from the input reaches the
 * output without passing through `esc()`, and the only attributes ever written
 * are the fixed ones below with validated values (checked URLs, colours that
 * match a strict pattern, numbers).
 *
 * Tags that are unknown, malformed, never closed or closed out of order are
 * shown as the text they were typed as, which is what TS3 does too.
 *
 * Kept free of the i18n and store modules so it can be tested on plain node;
 * `assets.ts` wires in the translated labels and the image allowlist.
 */
import { formatBytes, ftNameOf } from "@jinz/protocol";
import { parseTs3FileUrl, type Ts3FileRef } from "../chat/files/ts3file";
import { imageMimeOf, videoMimeOf } from "../chat/files/naming";

export interface BBCodeLabels {
  /** Button that loads one external image, e.g. "Load image from i.imgur.com". */
  loadImage: (host: string) => string;
  /** Button that adds the host to the "always load" list. */
  alwaysLoad: (host: string) => string;
}

/** Buttons of a shared file's card (`ts3file://` links). */
export interface FileCardLabels {
  download: string;
  /** Loads an image into the chat, after an explicit click. */
  preview: string;
  /**
   * Fetches a video and plays it, after an explicit click. Its own word rather
   * than "preview": a video is fetched whole before anything of it can be seen
   * (chat/files/videos.ts), which is a bigger thing to ask for than a picture.
   */
  play: string;
  /** Said instead of the buttons when the file is on another server. */
  elsewhere: (host: string) => string;
}

export interface BBCodeOptions {
  /**
   * Whether an `[img]` from this host may be loaded right away. Loading an
   * external image tells its host the viewer's IP, so the default is a
   * click-to-load placeholder.
   */
  loadImage?: (host: string) => boolean;
  labels?: BBCodeLabels;
  fileLabels?: FileCardLabels;
  /**
   * Whether a `ts3file://` link is about the server this page is on (see
   * chat/files/same-server.ts). One that is not gets a card without buttons:
   * its channel and path would otherwise be read on our server.
   */
  fileHere?: (file: Ts3FileRef) => boolean;
  /** Formats a `[time]` value; defaults to the runtime's local date-time. */
  formatTime?: (date: Date) => string;
  /** Turn bare http(s) URLs in text into links (default true). */
  autolink?: boolean;
}

/** Deeper nesting is shown as text; nobody writes 20 nested tags by hand. */
export const MAX_DEPTH = 20;

/** `[size=n]`: absolute sizes are points, clamped so a message cannot swallow the chat. */
export const SIZE_MIN_PT = 6;
export const SIZE_MAX_PT = 28;
/** `[size=+n]` / `[size=-n]`: steps relative to the surrounding text. */
const SIZE_STEP_EM = 0.25;
const SIZE_MIN_EM = 0.5;
const SIZE_MAX_EM = 2.5;

type TagKind = "inline" | "block" | "raw" | "void" | "item";

/** The whitelist. Anything else in brackets stays text. */
const TAGS: Record<string, TagKind> = {
  b: "inline",
  i: "inline",
  u: "inline",
  s: "inline",
  color: "inline",
  size: "inline",
  url: "inline",
  left: "block",
  center: "block",
  right: "block",
  quote: "block",
  list: "block",
  table: "block",
  tr: "block",
  th: "block",
  td: "block",
  "*": "item",
  hr: "void",
  // Raw tags: their content is taken verbatim up to the closing tag.
  img: "raw",
  code: "raw",
  noparse: "raw",
  time: "raw",
};

/** Blocks swallow one newline on each side, so a list does not come with blank lines. */
const BLOCKS = new Set(["left", "center", "right", "quote", "list", "table", "hr", "code"]);

interface TextNode {
  type: "text";
  value: string;
}

interface TagNode {
  type: "tag";
  name: string;
  arg: string | undefined;
  /** The opening tag as typed, for when it has to fall back to text. */
  raw: string;
  children: Node[];
}

interface RawNode {
  type: "raw";
  name: string;
  arg: string | undefined;
  content: string;
  /** The whole thing as typed, for when the content turns out to be invalid. */
  source: string;
}

type Node = TextNode | TagNode | RawNode;

const TAG_RE = /\[(\/?)([a-z]+|\*)(?:=([^[\]]*))?\]/gi;

/* --------------------------------- parse ---------------------------------- */

export function parseBBCode(input: string): Node[] {
  const root: TagNode = { type: "tag", name: "", arg: undefined, raw: "", children: [] };
  const stack: TagNode[] = [root];
  const top = (): TagNode => stack[stack.length - 1]!;
  const lower = input.toLowerCase();
  const re = new RegExp(TAG_RE.source, "gi");
  let pos = 0;

  const pushText = (value: string): void => {
    if (!value) return;
    const list = top().children;
    const last = list[list.length - 1];
    if (last?.type === "text") list[list.length - 1] = { type: "text", value: last.value + value };
    else list.push({ type: "text", value });
  };

  // Folds an unclosed tag back into text: its opening tag becomes literal and
  // its children move up to the parent. It is always the parent's last child,
  // because everything after it went inside it.
  const degradeTop = (): void => {
    const node = stack.pop()!;
    const parent = top().children;
    parent.pop();
    if (node.name === "*" && top().name === "list") {
      // A list item needs no closing tag; it only degrades with its list.
      parent.push(node);
      return;
    }
    pushText(node.raw);
    for (const child of node.children) {
      if (child.type === "text") pushText(child.value);
      else parent.push(child);
    }
  };

  const close = (name: string, source: string): void => {
    let k = stack.length - 1;
    while (k > 0 && stack[k]!.name !== name) k--;
    if (k === 0) {
      pushText(source);
      return;
    }
    while (stack.length - 1 > k) {
      // Items inside a list close with it; anything else left open is broken.
      if (top().name === "*") stack.pop();
      else degradeTop();
    }
    stack.pop();
  };

  for (let m = re.exec(input); m; m = re.exec(input)) {
    const [whole, slash, rawName, arg] = m;
    const name = rawName!.toLowerCase();
    const kind = TAGS[name];
    pushText(input.slice(pos, m.index));
    pos = re.lastIndex;
    if (!kind) {
      pushText(whole);
      continue;
    }
    if (slash) {
      if (arg !== undefined) pushText(whole);
      else close(name, whole);
      continue;
    }
    if (kind === "raw" || (name === "url" && arg === undefined)) {
      const end = lower.indexOf(`[/${name}]`, pos);
      if (end < 0) {
        pushText(whole);
        continue;
      }
      const closing = end + name.length + 3;
      top().children.push({
        type: "raw",
        name,
        arg,
        content: input.slice(pos, end),
        source: input.slice(m.index, closing),
      });
      pos = closing;
      re.lastIndex = closing;
      continue;
    }
    if (kind === "void") {
      top().children.push({ type: "tag", name, arg, raw: whole, children: [] });
      continue;
    }
    if (kind === "item") {
      if (top().name === "*") stack.pop();
      if (top().name !== "list") {
        pushText(whole);
        continue;
      }
    }
    if (stack.length > MAX_DEPTH) {
      pushText(whole);
      continue;
    }
    const node: TagNode = { type: "tag", name, arg, raw: whole, children: [] };
    top().children.push(node);
    stack.push(node);
  }
  pushText(input.slice(pos));
  while (stack.length > 1) degradeTop();
  return root.children;
}

/* --------------------------------- render --------------------------------- */

interface Ctx {
  opts: Required<BBCodeOptions>;
  /** Inside a link: no nested links, no autolinking. */
  inLink: boolean;
  parent: string;
}

const DEFAULT_LABELS: BBCodeLabels = {
  loadImage: (host) => `Load image from ${host}`,
  alwaysLoad: (host) => `Always load from ${host}`,
};

const DEFAULT_FILE_LABELS: FileCardLabels = {
  download: "Download",
  preview: "Preview",
  play: "Play",
  elsewhere: (host) => `On another server (${host})`,
};

export function renderBBCode(input: string, options: BBCodeOptions = {}): string {
  const ctx: Ctx = {
    opts: {
      loadImage: options.loadImage ?? (() => false),
      labels: options.labels ?? DEFAULT_LABELS,
      fileLabels: options.fileLabels ?? DEFAULT_FILE_LABELS,
      fileHere: options.fileHere ?? (() => true),
      formatTime: options.formatTime ?? ((d) => d.toLocaleString()),
      autolink: options.autolink ?? true,
    },
    inLink: false,
    parent: "",
  };
  return renderChildren(parseBBCode(input), ctx);
}

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function renderChildren(nodes: Node[], ctx: Ctx): string {
  let out = "";
  let afterBlock = false;
  for (const node of nodes) {
    let n = node;
    if (afterBlock && n.type === "text") n = { type: "text", value: n.value.replace(/^\r?\n/, "") };
    out += renderNode(n, ctx);
    afterBlock = n.type !== "text" && BLOCKS.has(n.name);
  }
  return out;
}

/** A block's content without the newline right after its opening and before its closing tag. */
function trimBlock(nodes: Node[]): Node[] {
  if (nodes.length === 0) return nodes;
  const out = [...nodes];
  const first = out[0]!;
  if (first.type === "text") out[0] = { type: "text", value: first.value.replace(/^\r?\n/, "") };
  const last = out[out.length - 1]!;
  if (last.type === "text")
    out[out.length - 1] = { type: "text", value: last.value.replace(/\r?\n$/, "") };
  return out;
}

function renderNode(node: Node, ctx: Ctx): string {
  if (node.type === "text") return renderText(node.value, ctx);
  if (node.type === "raw") return renderRaw(node, ctx);
  return renderTag(node, ctx);
}

function renderText(text: string, ctx: Ctx): string {
  if (!ctx.opts.autolink || ctx.inLink) return lines(text);
  let out = "";
  let pos = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'[\]]+/gi)) {
    // Sentence punctuation right after a URL is almost never part of it.
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    const href = safeHttpUrl(url);
    out += lines(text.slice(pos, m.index));
    out += href ? httpLink(href, lines(url)) : lines(url);
    pos = m.index + url.length;
  }
  return out + lines(text.slice(pos));
}

function lines(text: string): string {
  return esc(text).replace(/\r?\n/g, "<br />");
}

function renderTag(node: TagNode, ctx: Ctx): string {
  const inner = (c: Ctx = ctx, nodes = node.children): string =>
    renderChildren(nodes, { ...c, parent: node.name });
  const block = (): string => inner(ctx, trimBlock(node.children));
  switch (node.name) {
    case "b":
    case "i":
    case "u":
    case "s":
      return `<${node.name}>${inner()}</${node.name}>`;
    case "color": {
      const color = safeColor(node.arg);
      return color ? `<span style="color:${color}">${inner()}</span>` : inner();
    }
    case "size": {
      const size = safeSize(node.arg);
      return size ? `<span style="font-size:${size}">${inner()}</span>` : inner();
    }
    case "left":
    case "center":
    case "right":
      return `<div class="bb-align" style="text-align:${node.name}">${block()}</div>`;
    case "quote": {
      const by = node.arg?.replace(/^["']|["']$/g, "").trim();
      const cite = by ? `<cite class="bb-quote-by">${esc(by)}</cite>` : "";
      return `<blockquote class="bb-quote">${cite}${block()}</blockquote>`;
    }
    case "hr":
      return `<hr class="bb-hr" />`;
    case "url":
      return renderLink(node.arg ?? "", () => inner({ ...ctx, inLink: true }), ctx);
    case "list":
      return renderList(node, ctx);
    case "table":
      return renderRows(node, ctx);
    case "tr":
      return renderCells(node, ctx);
    case "td":
    case "th":
      if (ctx.parent !== "tr") return block();
      return `<${node.name}>${block()}</${node.name}>`;
    case "*":
      // An item that ended up outside a list (its list was never closed).
      return lines(node.raw) + inner();
    default:
      return inner();
  }
}

const LIST_TYPES: Record<string, string> = { "1": "1", a: "a", A: "A", i: "i", I: "I" };

function renderList(node: TagNode, ctx: Ctx): string {
  const type = node.arg === undefined ? undefined : LIST_TYPES[node.arg.trim()];
  const open = type ? `<ol class="bb-list" type="${type}">` : `<ul class="bb-list">`;
  const close = type ? "</ol>" : "</ul>";
  const sub: Ctx = { ...ctx, parent: "list" };
  let items = "";
  const loose: Node[] = [];
  const flushLoose = (): void => {
    if (loose.some((n) => n.type !== "text" || n.value.trim())) {
      items += `<li>${renderChildren(trimBlock(loose), sub)}</li>`;
    }
    loose.length = 0;
  };
  for (const child of node.children) {
    if (child.type === "tag" && child.name === "*") {
      flushLoose();
      items += `<li>${renderChildren(trimItem(child.children), { ...sub, parent: "*" })}</li>`;
    } else {
      loose.push(child);
    }
  }
  flushLoose();
  return open + items + close;
}

/** Items usually sit one per line; the line breaks between them are not content. */
function trimItem(nodes: Node[]): Node[] {
  if (nodes.length === 0) return nodes;
  const out = [...nodes];
  const first = out[0]!;
  if (first.type === "text") out[0] = { type: "text", value: first.value.replace(/^\s+/, "") };
  const last = out[out.length - 1]!;
  if (last.type === "text")
    out[out.length - 1] = { type: "text", value: last.value.replace(/\s+$/, "") };
  return out;
}

const isBlank = (n: Node): boolean => n.type === "text" && !n.value.trim();

function renderRows(node: TagNode, ctx: Ctx): string {
  const sub: Ctx = { ...ctx, parent: "table" };
  let rows = "";
  for (const child of node.children) {
    if (isBlank(child)) continue;
    if (child.type === "tag" && child.name === "tr") rows += renderCells(child, sub);
    else rows += `<tr><td>${renderNode(child, { ...sub, parent: "tr" })}</td></tr>`;
  }
  return `<table class="bb-table"><tbody>${rows}</tbody></table>`;
}

function renderCells(node: TagNode, ctx: Ctx): string {
  const sub: Ctx = { ...ctx, parent: "tr" };
  // A row outside a table cannot be a row; keep its content.
  if (ctx.parent !== "table") return renderChildren(node.children, sub);
  let cells = "";
  for (const child of node.children) {
    if (isBlank(child)) continue;
    if (child.type === "tag" && (child.name === "td" || child.name === "th"))
      cells += renderNode(child, sub);
    else cells += `<td>${renderNode(child, sub)}</td>`;
  }
  return `<tr>${cells}</tr>`;
}

function renderRaw(node: RawNode, ctx: Ctx): string {
  switch (node.name) {
    case "url":
      return renderLink(node.content.trim(), () => lines(node.content), ctx);
    case "img":
      return renderImage(node, ctx);
    case "code":
      return `<pre class="bb-code"><code>${esc(node.content.replace(/^\r?\n/, ""))}</code></pre>`;
    case "time":
      return renderTime(node, ctx);
    default:
      // noparse: the content, tags and all, as plain text.
      return lines(node.content);
  }
}

/* ------------------------------ links & media ------------------------------ */

/** A TeamSpeak link to a user: `client://<clid>/<uid>~<nickname>`. */
const CLIENT_LINK_RE = /^client:\/\/(\d{1,10})\/([^~]*)(?:~.*)?$/is;
/** A TeamSpeak link to a channel: `channelid://<cid>`. */
const CHANNEL_LINK_RE = /^channelid:\/\/(\d{1,20})$/i;
/** TeamSpeak UIDs are base64 of a SHA-1; anything else is not one. */
const UID_RE = /^[A-Za-z0-9+/=]{1,64}$/;

function renderLink(target: string, label: () => string, ctx: Ctx): string {
  // A link inside a link is invalid HTML and hides where the outer one goes.
  if (ctx.inLink) return label();
  const client = CLIENT_LINK_RE.exec(target);
  if (client) {
    const uid = UID_RE.test(client[2]!) ? ` data-uid="${esc(client[2]!)}"` : "";
    return `<a class="bb-client" href="#" data-clid="${client[1]}"${uid}>${label()}</a>`;
  }
  const channel = CHANNEL_LINK_RE.exec(target);
  if (channel) return `<a class="bb-channel" href="#" data-cid="${channel[1]}">${label()}</a>`;
  if (/^ts3file:/i.test(target)) {
    const file = parseTs3FileUrl(target);
    return file ? fileCard(file, ctx) : label();
  }
  // TS3 opens "www.example.com" as a web page; so do we.
  const href = safeHttpUrl(/^www\./i.test(target) ? `http://${target}` : target);
  return href ? httpLink(href, label()) : label();
}

/**
 * A file shared in chat (see chat/files/ts3file.ts). Never an href: the
 * buttons are handled by chat/richClick.ts, which downloads through the hub
 * from the server this page is on. The card names the file the link points
 * at, not the label the sender typed, so a label cannot pass one file off as
 * another.
 */
function fileCard(file: Ts3FileRef, ctx: Ctx): string {
  const { download, preview, play, elsewhere } = ctx.opts.fileLabels;
  const name = ftNameOf(file.path);
  const image = imageMimeOf(name) !== null;
  // Only a container this browser plays gets a Play button; a .mkv or an .avi
  // is a plain file with a plain download, which is the honest offer (see
  // chat/files/naming.ts).
  const video = !image && videoMimeOf(name) !== null;
  const size = file.size === undefined ? "" : ` data-ft-size="${file.size}"`;
  const button = (act: string, text: string): string =>
    `<button type="button" class="bb-file-btn" data-ft-act="${act}">${esc(text)}</button>`;
  // Another server's file: the card names it, and nothing here can fetch it.
  const here = ctx.opts.fileHere(file);
  const open = here
    ? `<span class="bb-file" data-ft-cid="${file.cid}" data-ft-path="${esc(file.path)}"${size}>`
    : `<span class="bb-file away" data-ft-away="1"${size}>`;
  return (
    open +
    `<span class="bb-file-icon" aria-hidden="true">${image ? "🖼" : video ? "🎬" : "📄"}</span>` +
    `<span class="bb-file-name">${esc(name)}</span>` +
    (file.size === undefined ? "" : `<span class="bb-file-size">${formatBytes(file.size)}</span>`) +
    (here
      ? button("download", download) +
        (image ? button("preview", preview) : "") +
        (video ? button("play", play) : "")
      : "") +
    `<span class="bb-file-status" role="status"${here ? "" : ' data-kind="error"'}>` +
    (here ? "" : esc(elsewhere(file.host))) +
    `</span>` +
    `</span>`
  );
}

function httpLink(href: string, label: string): string {
  return `<a class="bb-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
}

/** The URL, normalised, when it is http(s); null for every other scheme. */
export function safeHttpUrl(raw: string): string | null {
  const text = raw.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderImage(node: RawNode, ctx: Ctx): string {
  const href = safeHttpUrl(node.content);
  if (!href) return lines(node.source);
  const host = new URL(href).host;
  if (ctx.opts.loadImage(host)) return imageTag(href);
  const { loadImage, alwaysLoad } = ctx.opts.labels;
  return (
    `<span class="bb-img-ph" data-bb-img="${esc(href)}">` +
    `<button type="button" class="bb-img-load" data-bb-act="load">🖼 ${esc(loadImage(host))}</button>` +
    `<button type="button" class="bb-img-always" data-bb-act="always">${esc(alwaysLoad(host))}</button>` +
    `</span>`
  );
}

/** No referrer either: the page URL is nobody else's business. */
export function imageTag(href: string): string {
  return `<img class="bb-img" src="${esc(href)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
}

function renderTime(node: RawNode, ctx: Ctx): string {
  const date = parseTime(node.content.trim());
  if (!date) return lines(node.source);
  return `<time class="bb-time" datetime="${date.toISOString()}">${esc(ctx.opts.formatTime(date))}</time>`;
}

/** Unix seconds (or milliseconds, by magnitude) or an ISO-8601 date. */
export function parseTime(text: string): Date | null {
  let ms: number;
  if (/^\d{1,15}$/.test(text)) {
    const n = Number(text);
    ms = n < 1e11 ? n * 1000 : n;
  } else if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) {
    ms = Date.parse(text);
  } else {
    return null;
  }
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date : null;
}

/* ------------------------------ style values ------------------------------ */

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLOR_RE = /^[a-z]{3,20}$/i;

/** A colour that can go into `style="color:…"` as is, or null. */
export function safeColor(arg: string | undefined): string | null {
  const value = arg?.trim().replace(/^["']|["']$/g, "") ?? "";
  // TS3 writes "#RRGGBB"; some bots leave the "#" off.
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
  if (HEX_COLOR_RE.test(value) || NAMED_COLOR_RE.test(value)) return value.toLowerCase();
  return null;
}

/** A CSS font-size for `[size=…]`, clamped, or null when the value is not a size. */
export function safeSize(arg: string | undefined): string | null {
  const m = /^\s*([+-]?)(\d{1,3})\s*$/.exec(arg ?? "");
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1]) {
    const em = 1 + (m[1] === "-" ? -n : n) * SIZE_STEP_EM;
    return `${clamp(em, SIZE_MIN_EM, SIZE_MAX_EM)}em`;
  }
  return `${clamp(n, SIZE_MIN_PT, SIZE_MAX_PT)}pt`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
