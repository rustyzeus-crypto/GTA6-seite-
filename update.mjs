import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const FILE = process.env.TARGET_FILE || "index.html";
const FEED =
  process.env.FEED_URL ||
  "https://news.google.com/rss/search?q=%22GTA+6%22+OR+%22Grand+Theft+Auto+VI%22+when%3A2d&hl=de&gl=DE&ceid=DE:de";
const MAX_NEW = 10;
const MAX_TOTAL = 500;
const BLOCK = /(\/\*NEWS_START\*\/)([\s\S]*?)(\/\*NEWS_END\*\/)/;

const fail = (msg) => { console.error("FEHLER: " + msg); process.exit(1); };
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };
const dec = (s) =>
  s.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e) => ENT[e]).trim();
const tag = (x, n) => {
  const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`));
  return m ? dec(m[1]) : "";
};
const category = (t) =>
  /trailer|teaser/i.test(t) ? "Trailer" : /patch|update|release|erscheinung|termin/i.test(t) ? "Updates" : "News";

async function fetchNews() {
  const res = await fetch(FEED, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fan-site-updater)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((it) => {
    let title = tag(it, "title");
    const link = tag(it, "link");
    const source = tag(it, "source");
    const date = new Date(tag(it, "pubDate"));
    const i = title.lastIndexOf(" - ");
    if (i > 0) title = title.slice(0, i);
    return {
      id: sha(link || title),
      d: isNaN(date) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10),
      t: title,
      x: source ? "Quelle: " + source : "Externe Quelle",
      c: category(title),
      u: /^https:\/\//.test(link) ? link : "",
    };
  }).filter((n) => n.t);
}

const html = await readFile(FILE, "utf8");
const m = html.match(BLOCK);
if (!m) fail(`Marker NEWS_START/NEWS_END nicht in ${FILE} gefunden.`);

let old;
try { old = JSON.parse(m[2]); if (!Array.isArray(old)) throw 0; }
catch { fail("Der Block zwischen den Markern ist kein gültiges JSON-Array."); }

let fetched;
try { fetched = await fetchNews(); }
catch (e) { console.warn("Quelle nicht erreichbar, nichts geändert: " + e.message); process.exit(0); }

const ids = new Set(old.map((n) => n.id || sha(n.u || n.t + n.d)));
const titles = new Set(old.map((n) => norm(n.t)));
const fresh = [];
for (const n of fetched) {
  const k = norm(n.t);
  if (ids.has(n.id) || titles.has(k)) continue;
  ids.add(n.id); titles.add(k); fresh.push(n);
}
fresh.sort((a, b) => b.d.localeCompare(a.d));
const added = fresh.slice(0, MAX_NEW);

if (!added.length) { console.log("Keine neuen Einträge."); process.exit(0); }

const all = [...added, ...old].sort((a, b) => b.d.localeCompare(a.d)).slice(0, MAX_TOTAL);
const body = "[\n" + all.map((n) => " " + JSON.stringify(n)).join(",\n") + "\n]";
const out = html.replace(BLOCK, (_, a, _b, c) => a + body + c);

if (out !== html) {
  await writeFile(FILE, out);
  console.log(`${added.length} neue Einträge hinzugefügt (gesamt ${all.length}).`);
}
