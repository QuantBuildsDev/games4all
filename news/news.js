// ============================================================
//  News — fetch news/articles.json and render the feed
// ============================================================

const listEl = document.getElementById("newsList");

// Prevent HTML injection from stored article data
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function card(a) {
  const img = a.image
    ? `<div class="news-thumb"><img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"
         onerror="this.closest('.news-thumb').classList.add('is-fallback'); this.remove();"/></div>`
    : `<div class="news-thumb is-fallback"></div>`;

  return `
    <article class="news-card">
      ${img}
      <div class="news-body">
        <div class="news-meta">
          <span class="news-source">${esc(a.sourceName || hostOf(a.source))}</span>
          <span class="news-dot">·</span>
          <span class="news-date">${esc(fmtDate(a.postedAt))}</span>
        </div>
        <h2 class="news-title">${esc(a.title)}</h2>
        <p class="news-take">${esc(a.take)}</p>
        <a class="news-src-link" href="${esc(a.source)}" target="_blank" rel="noopener noreferrer">
          Read the full story at ${esc(a.sourceName || hostOf(a.source))}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><polyline points="7 7 17 7 17 17"/></svg>
        </a>
      </div>
    </article>`;
}

async function load() {
  let articles;
  try {
    const res = await fetch("/news/articles.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    articles = await res.json();
  } catch (err) {
    console.error("Failed to load news:", err);
    listEl.innerHTML = `<p class="news-empty">Couldn't load the news right now — please try again later.</p>`;
    return;
  }

  if (!Array.isArray(articles) || articles.length === 0) {
    listEl.innerHTML = `<p class="news-empty">No articles yet — the first drop is on its way. Check back soon! 🎮</p>`;
    return;
  }

  listEl.innerHTML = articles.map(card).join("");
}

load();
