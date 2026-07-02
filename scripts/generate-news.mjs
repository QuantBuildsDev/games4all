// ============================================================
//  generate-news.mjs — fetch a real gaming story, write an
//  original take with Gemini, and prepend it to news/articles.json
// ============================================================
//
//  Runs in GitHub Actions once a day (see .github/workflows/news.yml).
//  Needs env var GEMINI_API_KEY (a GitHub secret; locally read from .env).
//
//  Flow: RSS feed → newest unposted story → extract FULL article text
//  (fallback: RSS summary) → Gemini writes ~100-word take → save one file.
// ------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "fs";
import Parser from "rss-parser";
import { extract } from "@extractus/article-extractor";

// ---------- Config ----------
const FEEDS = [
  { name: "IGN",      url: "https://feeds.feedburner.com/ign/all" },
  { name: "Polygon",  url: "https://www.polygon.com/rss/index.xml" },
  { name: "PC Gamer", url: "https://www.pcgamer.com/rss/" },
];
const MODEL = "gemini-2.5-flash";      // swap to gemini-3.5-flash for newer prose
const MAX_ARTICLES = 30;               // cap the file size
const ARTICLES_PATH = new URL("../news/articles.json", import.meta.url);

// ---------- Helpers ----------
const strip = (html) => (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const wc = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  // Local fallback: read .env
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const m = env.match(/^GEMINI_API_KEY=(.*)$/m);
    if (m) return m[1].trim();
  } catch {}
  return "";
}

function loadArticles() {
  if (!existsSync(ARTICLES_PATH)) return [];
  try {
    const arr = JSON.parse(readFileSync(ARTICLES_PATH, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writeTake({ key, title, body, sourceName }) {
  const clipped = body.slice(0, 4000);
  const prompt =
`You are the editor of a fun, upbeat browser-games site called Games4All.
Write an original ~100-word take on the gaming news article below for our news feed.

Rules:
- Around 100 words, 3-4 sentences. Plain text only (no markdown, no headings).
- Fun, punchy, opinionated voice — but accurate. Do NOT invent facts not in the article.
- Ignore website boilerplate (timestamps, "image credit", "follow", nav text).
- Don't just repeat the headline; add insight and a reason readers should care.
- Do not start with "In this article" or restate the source name.
- Vary your opening line. Avoid clichéd hooks like "Hold onto your hats",
  "Hold the phone", "Get ready", or "Attention gamers". Just start with the substance.

HEADLINE: ${title}
SOURCE: ${sourceName}
ARTICLE TEXT:
${clipped}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 600,
        // 2.5-flash is a "thinking" model; disable thinking so the whole
        // token budget goes to the actual take (not internal reasoning).
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text: " + JSON.stringify(data).slice(0, 200));
  return text.trim();
}

// ---------- Main ----------
const key = loadKey();
if (!key || key.includes("paste-your")) {
  console.error("❌ No GEMINI_API_KEY found (env or .env).");
  process.exit(1);
}

const articles = loadArticles();
const posted = new Set(articles.map((a) => a.source));
const rss = new Parser({ timeout: 20000 });

// Rotate the starting feed per post so sources vary across days
// (IGN → Polygon → PC Gamer → …), then fall through if it has nothing new.
const start = articles.length % FEEDS.length;
const order = FEEDS.map((_, i) => FEEDS[(start + i) % FEEDS.length]);

let chosen = null;
for (const feed of order) {
  try {
    const parsed = await rss.parseURL(feed.url);
    const fresh = parsed.items.find((it) => it.link && !posted.has(it.link));
    if (fresh) { chosen = { feed, item: fresh }; break; }
    console.log(`· ${feed.name}: nothing new, trying next`);
  } catch (e) {
    console.log(`· ${feed.name}: feed error (${e.message}), trying next`);
  }
}

if (!chosen) {
  console.log("No new articles across any feed today. Nothing to post.");
  process.exit(0);
}

const { feed, item } = chosen;
const title = (item.title || "").trim();
console.log(`Chosen: [${feed.name}] ${title}`);

// Pull the full article; fall back to the RSS summary if that fails.
let body = "";
let image = "";
try {
  const art = await extract(item.link);
  body = strip(art?.content || "");
  image = art?.image || "";
  console.log(`Full text: ${wc(body)} words`);
} catch (e) {
  console.log(`Extraction failed (${e.message}) — using RSS summary`);
}
if (wc(body) < 40) {
  body = strip(item.contentSnippet || item.content || item.summary || title);
  console.log(`Fell back to summary: ${wc(body)} words`);
}
if (!image) image = item.enclosure?.url || item["media:content"]?.$?.url || "";

const take = await writeTake({ key, title, body, sourceName: feed.name });
console.log(`Gemini take: ${wc(take)} words`);

const entry = {
  title,
  take,
  source: item.link,
  sourceName: feed.name,
  image,
  postedAt: new Date().toISOString(),
};

const updated = [entry, ...articles].slice(0, MAX_ARTICLES);
writeFileSync(ARTICLES_PATH, JSON.stringify(updated, null, 2) + "\n");
console.log(`✅ Wrote news/articles.json (${updated.length} articles total).`);
