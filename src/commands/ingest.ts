import { CardStore } from "../core/store.js";
import { stringifyFrontmatter } from "../core/parser.js";
import { writeCommand } from "./write.js";

export type IngestContentKind = "research-paper" | "article" | "youtube-video" | "web-page";
export type IngestKindSelection = "auto" | IngestContentKind;

export interface IngestUrlOptions {
  dryRun?: boolean;
  slug?: string;
  title?: string;
  kind?: IngestKindSelection;
  source?: string;
  timeoutMs?: number;
  maxContentChars?: number;
  fetchFn?: typeof globalThis.fetch;
  now?: Date;
  afterWrite?: (ctx: { slug: string; content: string }) => Promise<void>;
}

export interface IngestUrlResult {
  output: string;
  exitCode: number;
  ingestedSlugs: string[];
}

interface FetchSnapshot {
  finalUrl: string;
  host: string;
  contentType: string;
  status: number;
  html: string;
  text: string;
  truncated: boolean;
}

interface ExtractedSignals {
  title: string;
  description: string;
  abstractText: string;
  authors: string[];
  published: string;
  doi: string;
  arxivId: string;
  ogType: string;
  citationPdfUrl: string;
  firstParagraph: string;
  excerpt: string;
}

interface KindConfig {
  label: string;
  category: string;
  flatPrefix: string;
  nestedDir: string;
  kindTag: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONTENT_CHARS = 2_000_000;
const DEFAULT_EXCERPT_CHARS = 1800;
const INGEST_USER_AGENT = "memex-ingest/0.1 (+https://github.com/iamtouchskyer/memex)";

const KIND_CONFIG: Record<IngestContentKind, KindConfig> = {
  "research-paper": {
    label: "Research Paper",
    category: "research",
    flatPrefix: "paper",
    nestedDir: "reference/papers",
    kindTag: "paper",
  },
  article: {
    label: "Article",
    category: "reference",
    flatPrefix: "article",
    nestedDir: "reference/articles",
    kindTag: "article",
  },
  "youtube-video": {
    label: "YouTube Video",
    category: "reference",
    flatPrefix: "video",
    nestedDir: "reference/videos",
    kindTag: "video",
  },
  "web-page": {
    label: "Web Page",
    category: "reference",
    flatPrefix: "web",
    nestedDir: "reference/web",
    kindTag: "web",
  },
};

export async function ingestUrlCommand(
  store: CardStore,
  urlInput: string,
  options: IngestUrlOptions = {},
): Promise<IngestUrlResult> {
  const parsedUrl = parseHttpUrl(urlInput);
  if (!parsedUrl) {
    return {
      output: `Error: Invalid URL '${urlInput}'. Only http/https URLs are supported.`,
      exitCode: 1,
      ingestedSlugs: [],
    };
  }

  const kindSelection = options.kind ?? "auto";
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;

  let snapshot: FetchSnapshot;
  try {
    snapshot = await fetchSnapshot(parsedUrl, fetchFn, timeoutMs, maxContentChars);
  } catch (error) {
    return {
      output: `Error: Failed to fetch URL: ${(error as Error).message}`,
      exitCode: 1,
      ingestedSlugs: [],
    };
  }

  if (snapshot.status >= 400) {
    return {
      output: `Error: Failed to fetch URL (HTTP ${snapshot.status})`,
      exitCode: 1,
      ingestedSlugs: [],
    };
  }

  const signals = extractSignals(snapshot, parsedUrl);
  const detectedKind = detectKind(parsedUrl, snapshot, signals, kindSelection);
  const config = KIND_CONFIG[detectedKind];

  const resolvedTitle = resolveTitle(options.title, signals.title, parsedUrl, detectedKind);
  const resolvedSlug = await resolveTargetSlug(store, resolvedTitle, detectedKind, options.slug);
  if (!resolvedSlug) {
    return {
      output: `Error: Could not resolve slug for '${resolvedTitle}'.`,
      exitCode: 1,
      ingestedSlugs: [],
    };
  }

  if (options.slug) {
    const existing = await store.resolve(options.slug);
    if (existing) {
      return {
        output: `Error: Slug already exists: ${options.slug}`,
        exitCode: 1,
        ingestedSlugs: [],
      };
    }
  }

  const summaryText = resolveSummaryText(detectedKind, signals, snapshot);
  const keyPoints = extractKeyPoints(summaryText, detectedKind);
  const sourceValue = (options.source || "ingest-url").trim() || "ingest-url";

  const now = options.now ?? new Date();
  const today = now.toISOString().split("T")[0];

  const tags = buildTags(detectedKind, snapshot.host);
  const frontmatter: Record<string, unknown> = {
    title: resolvedTitle,
    created: today,
    source: sourceValue,
    category: config.category,
    tags: tags.join(", "),
    url: snapshot.finalUrl,
    ingestedType: detectedKind,
    ingestedHost: snapshot.host,
    ingestedAt: today,
  };

  if (signals.published) frontmatter.published = signals.published;
  if (signals.doi) frontmatter.doi = signals.doi;
  if (signals.arxivId) frontmatter.arxiv = signals.arxivId;
  if (signals.authors.length > 0) frontmatter.authors = signals.authors.join(", ");

  const body = buildBody({
    detectedKind,
    config,
    summaryText,
    keyPoints,
    signals,
    snapshot,
    now: today,
  });

  const content = stringifyFrontmatter(body, frontmatter);

  if (options.dryRun) {
    return {
      output: [
        `[dry-run] Ingest preview`,
        `Detected content type: ${detectedKind}`,
        `Target slug: ${resolvedSlug}`,
        `Category: ${config.category}`,
        `Tags: ${tags.join(", ")}`,
        "",
        previewContent(content),
      ].join("\n"),
      exitCode: 0,
      ingestedSlugs: [],
    };
  }

  let writeResult: Awaited<ReturnType<typeof writeCommand>>;
  try {
    writeResult = await writeCommand(store, resolvedSlug, content, {
      afterWrite: options.afterWrite,
    });
  } catch (error) {
    return {
      output: `Error: ${(error as Error).message}`,
      exitCode: 1,
      ingestedSlugs: [],
    };
  }

  if (!writeResult.success) {
    return {
      output: `Error: ${writeResult.error ?? "Failed to write card"}`,
      exitCode: 1,
      ingestedSlugs: [],
    };
  }

  return {
    output: [
      `Ingested URL into '${resolvedSlug}'.`,
      `Detected content type: ${detectedKind}`,
      `Category: ${config.category}`,
      `Tags: ${tags.join(", ")}`,
      snapshot.truncated ? "Note: Source content was truncated during ingestion." : "",
    ].filter(Boolean).join("\n"),
    exitCode: 0,
    ingestedSlugs: [resolvedSlug],
  };
}

function parseHttpUrl(input: string): URL | null {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchSnapshot(
  parsedUrl: URL,
  fetchFn: typeof globalThis.fetch,
  timeoutMs: number,
  maxContentChars: number,
): Promise<FetchSnapshot> {
  const signal = createTimeoutSignal(timeoutMs);
  const response = await fetchFn(parsedUrl.toString(), {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": INGEST_USER_AGENT,
      "accept": "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.8",
    },
    signal,
  });

  const finalUrl = response.url || parsedUrl.toString();
  const finalParsed = parseHttpUrl(finalUrl) ?? parsedUrl;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  let raw = "";
  if (shouldReadAsText(contentType)) {
    raw = await response.text();
  }

  let truncated = false;
  if (raw.length > maxContentChars) {
    raw = raw.slice(0, maxContentChars);
    truncated = true;
  }

  const html = looksLikeHtml(raw) ? raw : "";
  const text = html ? htmlToText(html) : normalizeWhitespace(raw);

  return {
    finalUrl,
    host: finalParsed.hostname.toLowerCase(),
    contentType,
    status: response.status,
    html,
    text,
    truncated,
  };
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  const timeoutFn = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof timeoutFn === "function" ? timeoutFn(timeoutMs) : undefined;
}

function shouldReadAsText(contentType: string): boolean {
  if (!contentType) return true;
  if (contentType.includes("application/pdf")) return false;
  if (contentType.includes("application/octet-stream")) return false;
  return contentType.includes("text/") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("html");
}

function looksLikeHtml(raw: string): boolean {
  const sample = raw.slice(0, 500).toLowerCase();
  return sample.includes("<html") || sample.includes("<head") || sample.includes("<body") || sample.includes("<!doctype html");
}

function extractSignals(snapshot: FetchSnapshot, originalUrl: URL): ExtractedSignals {
  const meta = parseMeta(snapshot.html);
  const title = firstNonEmpty(
    getMeta(meta, "citation_title"),
    getMeta(meta, "og:title"),
    getHtmlTitle(snapshot.html),
  );
  const description = firstNonEmpty(
    getMeta(meta, "citation_abstract"),
    getArxivAbstract(snapshot.html),
    getMeta(meta, "description"),
    getMeta(meta, "og:description"),
  );

  const authors = uniqueNonEmpty([
    ...getMetaAll(meta, "citation_author"),
    ...splitAuthors(getMeta(meta, "author")),
  ]);

  const published = firstNonEmpty(
    getMeta(meta, "citation_publication_date"),
    getMeta(meta, "article:published_time"),
    getMeta(meta, "dc.date"),
    getMeta(meta, "date"),
  );

  const doiFromMeta = firstNonEmpty(
    getMeta(meta, "citation_doi"),
    getMeta(meta, "dc.identifier"),
  );
  const doi = firstNonEmpty(doiFromMeta, extractDoi(snapshot.text));

  const arxivId = firstNonEmpty(
    extractArxivId(originalUrl.toString()),
    extractArxivId(snapshot.finalUrl),
  );

  const ogType = getMeta(meta, "og:type");
  const citationPdfUrl = getMeta(meta, "citation_pdf_url");
  const firstParagraph = extractFirstParagraph(snapshot.html);
  const abstractText = firstNonEmpty(getMeta(meta, "citation_abstract"), getArxivAbstract(snapshot.html));
  const excerpt = (snapshot.text || "").slice(0, DEFAULT_EXCERPT_CHARS);

  return {
    title,
    description,
    abstractText,
    authors,
    published,
    doi,
    arxivId,
    ogType,
    citationPdfUrl,
    firstParagraph,
    excerpt,
  };
}

function detectKind(
  parsedUrl: URL,
  snapshot: FetchSnapshot,
  signals: ExtractedSignals,
  kindSelection: IngestKindSelection,
): IngestContentKind {
  if (kindSelection !== "auto") return kindSelection;

  const finalUrl = snapshot.finalUrl || parsedUrl.toString();
  if (isYouTubeUrl(finalUrl)) return "youtube-video";

  const hasResearchSignals =
    snapshot.contentType.includes("application/pdf") ||
    snapshot.host.includes("arxiv.org") ||
    snapshot.host === "doi.org" ||
    !!signals.doi ||
    !!signals.arxivId ||
    !!signals.citationPdfUrl ||
    signals.title.toLowerCase().includes("arxiv");

  if (hasResearchSignals) return "research-paper";

  const hasArticleSignals =
    signals.ogType.toLowerCase() === "article" ||
    /<article[\s>]/i.test(snapshot.html) ||
    !!signals.description ||
    !!signals.firstParagraph;

  if (hasArticleSignals) return "article";

  return "web-page";
}

function resolveTitle(
  titleOverride: string | undefined,
  extractedTitle: string,
  parsedUrl: URL,
  kind: IngestContentKind,
): string {
  const cleanOverride = normalizeWhitespace(titleOverride || "");
  if (cleanOverride) return cleanOverride;

  const cleanExtracted = normalizeWhitespace(extractedTitle);
  if (cleanExtracted) return cleanExtracted;

  if (kind === "youtube-video" && parsedUrl.searchParams.get("v")) {
    return `YouTube video ${parsedUrl.searchParams.get("v")}`;
  }

  const pathname = decodeURIComponent(parsedUrl.pathname || "").replace(/^\/+|\/+$/g, "");
  const fallback = pathname.split("/").pop() || parsedUrl.hostname;
  return fallback.replace(/[-_]+/g, " ").slice(0, 80) || "Ingested content";
}

async function resolveTargetSlug(
  store: CardStore,
  resolvedTitle: string,
  kind: IngestContentKind,
  explicitSlug?: string,
): Promise<string | null> {
  if (explicitSlug) {
    const trimmed = explicitSlug.trim();
    return trimmed || null;
  }

  const stem = slugify(resolvedTitle) || "untitled";
  const config = KIND_CONFIG[kind];
  const base = store.isNestedSlugsEnabled()
    ? `${config.nestedDir}/${stem}`
    : `${config.flatPrefix}-${stem}`;

  return resolveUniqueSlug(store, base);
}

async function resolveUniqueSlug(store: CardStore, base: string): Promise<string | null> {
  const normalized = base.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return null;

  const maxAttempts = 200;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = i === 0 ? normalized : `${normalized}-${i + 1}`;
    const existing = await store.resolve(candidate);
    if (!existing) return candidate;
  }

  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function buildTags(kind: IngestContentKind, host: string): string[] {
  const hostTag = host.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return uniqueNonEmpty([
    "ingested",
    KIND_CONFIG[kind].kindTag,
    hostTag ? `src-${hostTag}` : "",
  ]);
}

function resolveSummaryText(kind: IngestContentKind, signals: ExtractedSignals, snapshot: FetchSnapshot): string {
  if (kind === "research-paper") {
    return firstNonEmpty(signals.abstractText, signals.description, signals.firstParagraph, signals.excerpt);
  }

  if (kind === "youtube-video") {
    return firstNonEmpty(
      signals.description,
      signals.firstParagraph,
      `Video page captured from ${snapshot.host}.`,
    );
  }

  return firstNonEmpty(signals.description, signals.firstParagraph, signals.excerpt);
}

function extractKeyPoints(summaryText: string, kind: IngestContentKind): string[] {
  const cleaned = normalizeWhitespace(summaryText);
  if (!cleaned) {
    if (kind === "youtube-video") {
      return ["No transcript was available during ingestion. Add notes manually after reviewing the video."];
    }
    return ["No clear summary could be extracted from the source."];
  }

  const sentences = splitSentences(cleaned)
    .map((s) => normalizeWhitespace(s))
    .filter((s) => s.length >= 24);

  if (sentences.length === 0) {
    return [truncate(cleaned, 220)];
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(truncate(sentence, 260));
    if (unique.length >= 5) break;
  }

  return unique;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildBody(input: {
  detectedKind: IngestContentKind;
  config: KindConfig;
  summaryText: string;
  keyPoints: string[];
  signals: ExtractedSignals;
  snapshot: FetchSnapshot;
  now: string;
}): string {
  const lines: string[] = [];
  lines.push(`Source URL: ${input.snapshot.finalUrl}`);
  lines.push(`Detected Type: ${input.detectedKind} (${input.config.label})`);
  lines.push(`Ingested: ${input.now}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(input.summaryText || "No summary extracted.");
  lines.push("");

  lines.push("## Key Points");
  for (const point of input.keyPoints) {
    lines.push(`- ${point}`);
  }
  lines.push("");

  lines.push("## Metadata");
  lines.push(`- host: ${input.snapshot.host}`);
  if (input.snapshot.contentType) lines.push(`- content-type: ${input.snapshot.contentType}`);
  if (input.signals.authors.length > 0) lines.push(`- authors: ${input.signals.authors.join(", ")}`);
  if (input.signals.published) lines.push(`- published: ${input.signals.published}`);
  if (input.signals.doi) lines.push(`- doi: ${input.signals.doi}`);
  if (input.signals.arxivId) lines.push(`- arxiv: ${input.signals.arxivId}`);
  if (input.signals.citationPdfUrl) lines.push(`- pdf: ${input.signals.citationPdfUrl}`);
  lines.push("");

  if (input.signals.excerpt) {
    lines.push("## Extracted Excerpt");
    lines.push(truncate(input.signals.excerpt, DEFAULT_EXCERPT_CHARS));
  }

  return lines.join("\n");
}

function previewContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= 80) return content;
  return `${lines.slice(0, 80).join("\n")}\n...\n(Preview truncated)`;
}

function parseMeta(html: string): Record<string, string[]> {
  if (!html) return {};

  const meta: Record<string, string[]> = {};
  const metaTagRe = /<meta\s+[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaTagRe.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.name || attrs.property || attrs.itemprop || "").toLowerCase().trim();
    const value = decodeHtmlEntities(attrs.content || "").trim();
    if (!key || !value) continue;

    if (!meta[key]) meta[key] = [];
    meta[key].push(value);
  }

  return meta;
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrRe.exec(tag)) !== null) {
    const key = attrMatch[1].toLowerCase();
    const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
    attrs[key] = value;
  }

  return attrs;
}

function getMeta(meta: Record<string, string[]>, key: string): string {
  const values = meta[key.toLowerCase()];
  if (!values || values.length === 0) return "";
  return normalizeWhitespace(values[0]);
}

function getMetaAll(meta: Record<string, string[]>, key: string): string[] {
  return uniqueNonEmpty((meta[key.toLowerCase()] || []).map((v) => normalizeWhitespace(v)));
}

function getHtmlTitle(html: string): string {
  if (!html) return "";
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeWhitespace(decodeHtmlEntities(stripHtml(match[1]))) : "";
}

function getArxivAbstract(html: string): string {
  if (!html) return "";
  const blockquote = html.match(/<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (!blockquote) return "";
  const text = normalizeWhitespace(decodeHtmlEntities(stripHtml(blockquote[1])));
  return text.replace(/^abstract:\s*/i, "");
}

function extractFirstParagraph(html: string): string {
  if (!html) return "";
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!match) return "";
  return normalizeWhitespace(decodeHtmlEntities(stripHtml(match[1])));
}

function extractDoi(text: string): string {
  if (!text) return "";
  const doiMatch = text.match(/10\.\d{4,9}\/[\-._;()/:A-Za-z0-9]+/);
  return doiMatch ? doiMatch[0] : "";
}

function extractArxivId(url: string): string {
  const absMatch = url.match(/arxiv\.org\/abs\/([^?#]+)/i);
  if (absMatch) return absMatch[1].replace(/\/$/, "");

  const pdfMatch = url.match(/arxiv\.org\/pdf\/([^?#]+?)(?:\.pdf)?$/i);
  if (pdfMatch) return pdfMatch[1].replace(/\/$/, "");

  return "";
}

function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "youtu.be" || host.endsWith("youtube.com");
  } catch {
    return false;
  }
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const stripped = stripHtml(withoutScripts);
  return normalizeWhitespace(decodeHtmlEntities(stripped));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function splitAuthors(value: string): string[] {
  if (!value) return [];
  return value
    .split(/[;,]|\band\b/gi)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }

  return out;
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function normalizeWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}
