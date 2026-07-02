// ============================================================
//  generate-news.mjs — fetch a real gaming story, write an
//  original take with Gemini, and prepend it to news/articles.json
// ============================================================
//
//  Runs in GitHub Actions once a day (see .github/workflows/news.yml).
//  Needs env var GEMINI_API_KEY (a GitHub secret; locally read from .env).
//
//  Flow: RSS feed → newest unposted story that is genuinely about VIDEO GAMES
//  (Gemini filters out movie/TV/celebrity items, even game adaptations) →
//  extract FULL article text (fallback: RSS summary) → Gemini writes a
//  ~100-word take → save one file.  Set DRY_RUN=1 to preview without writing.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared Gemini call. 2.5-flash is a "thinking" model; disable thinking so the
// whole token budget goes to the answer (not internal reasoning). Retries on
// rate limits (429) and transient 5xx so the daily run doesn't drop a story.
async function gemini(key, prompt, { maxOutputTokens = 600, temperature = 0.9 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const backoffs = [3000, 10000, 25000];
  let lastErr;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
    } catch (e) {
      lastErr = e; // network blip — retry
      if (attempt < backoffs.length) { await sleep(backoffs[attempt]); continue; }
      throw lastErr;
    }

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
      lastErr = new Error("Gemini returned no text: " + JSON.stringify(data).slice(0, 200));
    } else {
      lastErr = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 150)}`);
      // Only retry rate limits / server errors; fail fast on 4xx like bad key.
      if (res.status !== 429 && res.status < 500) throw lastErr;
    }
    if (attempt < backoffs.length) await sleep(backoffs[attempt]);
  }
  throw lastErr;
}

// Gate: is this story ACTUALLY about video games (incl. consoles + industry)?
// Movies, TV, actors etc. are rejected even when they involve/adapt a game.
async function isVideoGameStory({ key, title, summary }) {
  const prompt =
`Classify this news item for a VIDEO GAMES news feed. Reply with exactly one word: GAME or SKIP.

GAME = primarily about a video game (releases, gameplay, updates, patches, DLC, reviews),
       video game hardware or consoles (PlayStation, Xbox, Nintendo, Switch, Steam, PC, handhelds),
       or the video game industry/business (studios, sales, layoffs, acquisitions, showcases).
SKIP = primarily about movies, TV shows, streaming series, actors, celebrities, comics, anime,
       music, or other entertainment — EVEN IF it involves or adapts a video game
       (a game being turned into a film or TV show is SKIP).

TITLE: ${title}
SUMMARY: ${summary}`;
  try {
    const ans = (await gemini(key, prompt, { maxOutputTokens: 5, temperature: 0 })).toUpperCase();
    return ans.includes("GAME") && !ans.includes("SKIP");
  } catch (e) {
    console.log(`  (classify error: ${e.message} — treating as SKIP)`);
    return false;
  }
}

async function writeTake({ key, title, body, sourceName }) {
  const clipped = body.slice(0, 4000);
  const prompt =
`You are the editor of a fun, upbeat browser-games site called Games4All.
Write an original ~100-word take on the VIDEO GAME news article below for our news feed.

Rules:
- Around 100 words, 3-4 sentences. Plain text only (no markdown, no headings).
- Fun, punchy, opinionated voice — but accurate. Do NOT invent facts not in the article.
- Focus on the video game / gaming angle (the game, console, or studio).
- Ignore website boilerplate (timestamps, "image credit", "follow", nav text).
- Don't just repeat the headline; add insight and a reason readers should care.
- Do not start with "In this article" or restate the source name.
- Vary your opening line. Avoid clichéd hooks like "Hold onto your hats",
  "Hold the phone", "Get ready", or "Attention gamers". Just start with the substance.

HEADLINE: ${title}
SOURCE: ${sourceName}
ARTICLE TEXT:
${clipped}`;
  return gemini(key, prompt, { maxOutputTokens: 600, temperature: 0.9 });
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

// Walk candidates across feeds (in rotation order) and pick the newest
// unposted story that is genuinely about video games.
const MAX_CANDIDATES = 12; // bound how many classification calls we make
let chosen = null;
let checked = 0;

outer:
for (const feed of order) {
  let parsed;
  try {
    parsed = await rss.parseURL(feed.url);
  } catch (e) {
    console.log(`· ${feed.name}: feed error (${e.message}), trying next`);
    continue;
  }
  for (const it of parsed.items) {
    if (!it.link || posted.has(it.link)) continue;
    if (checked >= MAX_CANDIDATES) break outer;
    checked++;
    const t = (it.title || "").trim();
    const s = strip(it.contentSnippet || it.content || it.summary || "");
    if (await isVideoGameStory({ key, title: t, summary: s })) {
      chosen = { feed, item: it };
      break outer;
    }
    console.log(`· skip (not a game): [${feed.name}] ${t.slice(0, 60)}`);
  }
}

if (!chosen) {
  console.log("No fresh video-game story found today. Nothing to post.");
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

if (process.env.DRY_RUN === "1") {
  console.log("DRY_RUN — would post this entry (articles.json NOT modified):");
  console.log(JSON.stringify(entry, null, 2));
  process.exit(0);
}

const updated = [entry, ...articles].slice(0, MAX_ARTICLES);
writeFileSync(ARTICLES_PATH, JSON.stringify(updated, null, 2) + "\n");
console.log(`✅ Wrote news/articles.json (${updated.length} articles total).`);
