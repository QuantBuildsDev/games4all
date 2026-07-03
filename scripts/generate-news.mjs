// ============================================================
//  generate-news.mjs — fetch a real VIDEO-GAME story, write an
//  original take with Gemini, and prepend it to news/articles.json
// ============================================================
//
//  Runs in GitHub Actions once a day (see .github/workflows/news.yml).
//  Needs env var GEMINI_API_KEY (a GitHub secret; locally read from .env).
//
//  To stay well under the Gemini free-tier rate limits, a run makes only
//  TWO API calls:
//    1) ONE call classifies a shortlist of recent headlines and picks the
//       first that is genuinely about video games (games, consoles/hardware,
//       or the games industry) — skipping movies/TV/actors/anime/music, even
//       game adaptations. Uses the cheap, high-limit flash-lite model.
//    2) ONE call writes the ~100-word take on the chosen article's full text.
//
//  Set DRY_RUN=1 to preview the chosen article without writing the file.
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
const CLASSIFY_MODEL = "gemini-2.5-flash-lite"; // cheap + high free limits for the GAME/SKIP pick
const WRITE_MODEL    = "gemini-2.5-flash";      // nicer prose for the take (swap to gemini-3.5-flash for newer)
const MAX_CANDIDATES = 15;   // recent items considered in the single classification call
const MAX_ARTICLES   = 30;   // cap the file size
const ARTICLES_PATH  = new URL("../news/articles.json", import.meta.url);

// ---------- Helpers ----------
const strip = (html) => (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const wc = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
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

// Shared Gemini call. 2.5 models are "thinking" models; disable thinking so the
// whole token budget goes to the answer. Retries on rate limits (429) and 5xx.
async function gemini(key, prompt, { model = WRITE_MODEL, maxOutputTokens = 600, temperature = 0.9 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const backoffs = [4000, 12000, 30000];
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
      lastErr = e;
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
      if (res.status !== 429 && res.status < 500) throw lastErr; // fail fast on bad key etc.
      if (attempt < backoffs.length) console.log(`  (rate-limited, retrying in ${backoffs[attempt] / 1000}s…)`);
    }
    if (attempt < backoffs.length) await sleep(backoffs[attempt]);
  }
  throw lastErr;
}

// ONE call: from the shortlist, return the index of the first real video-game
// story, or -1 if none qualify.
async function pickGameIndex(key, shortlist) {
  const list = shortlist.map((c, i) => {
    const t = (c.item.title || "").trim();
    const s = strip(c.item.contentSnippet || c.item.content || c.item.summary || "").slice(0, 140);
    return `${i + 1}. ${t}${s ? " — " + s : ""}`;
  }).join("\n");

  const prompt =
`You curate a VIDEO GAMES news feed. From the numbered list below, pick the FIRST item
that is primarily about a video game (releases, gameplay, updates, patches, DLC, reviews),
video game hardware/consoles (PlayStation, Xbox, Nintendo, Switch, Steam, PC, handhelds),
or the video game industry/business (studios, sales, layoffs, acquisitions, showcases).

Ignore anything primarily about movies, TV shows, streaming series, actors, celebrities,
comics, anime, or music — EVEN IF it involves or adapts a video game.

Reply with ONLY that item's number. If none qualify, reply 0.

${list}`;

  const ans = await gemini(key, prompt, { model: CLASSIFY_MODEL, maxOutputTokens: 8, temperature: 0 });
  const n = parseInt((ans.match(/\d+/) || ["0"])[0], 10);
  return (Number.isInteger(n) && n >= 1 && n <= shortlist.length) ? n - 1 : -1;
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
  return gemini(key, prompt, { model: WRITE_MODEL, maxOutputTokens: 600, temperature: 0.9 });
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

// Rotate the starting feed per post so sources vary across days.
const start = articles.length % FEEDS.length;
const order = FEEDS.map((_, i) => FEEDS[(start + i) % FEEDS.length]);

// Collect a shortlist of recent unposted items (no API calls here).
const candidates = [];
for (const feed of order) {
  let parsed;
  try {
    parsed = await rss.parseURL(feed.url);
  } catch (e) {
    console.log(`· ${feed.name}: feed error (${e.message}), skipping`);
    continue;
  }
  for (const it of parsed.items) {
    if (!it.link || posted.has(it.link)) continue;
    candidates.push({ feed, item: it });
  }
  if (candidates.length >= MAX_CANDIDATES) break;
}
const shortlist = candidates.slice(0, MAX_CANDIDATES);

if (!shortlist.length) {
  console.log("No new articles across any feed today. Nothing to post.");
  process.exit(0);
}
console.log(`Considering ${shortlist.length} recent headlines…`);

// ONE classification call picks the first genuine video-game story.
const idx = await pickGameIndex(key, shortlist);
if (idx < 0) {
  console.log("No fresh video-game story among the candidates today. Nothing to post.");
  process.exit(0);
}

const { feed, item } = shortlist[idx];
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
