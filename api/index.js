// api/index.js  — single-file legacy Vercel handler
// Hard-coded TMDB key (replace if you want env var)
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";

// Config
const DAYS_WINDOW = 90;
const DISCOVER_PAGES = 5; // scan discover pages
const POPULAR_PAGES = 8;  // scan popular pages as fallback
const CONCURRENCY = 8;
const ALLOWED_COUNTRIES = ["US", "CA", "GB"];
const ALLOWED_TYPES = new Set([2,3,4,5,6]); // theatrical, digital, physical, tv/streaming, vod
const MIN_VOTE_COUNT = 5;    // filter out pure festival items
const MIN_POPULARITY = 1.0;

// ---- utilities ----
function daysAgoISO(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0,10);
}

function isoToDate(s) {
  if (!s) return null;
  return new Date(s);
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function addCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

// small concurrency map
async function pMap(list, fn, concurrency = 5) {
  let i = 0;
  const results = new Array(list.length);
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= list.length) break;
      try {
        results[idx] = await fn(list[idx], idx);
      } catch (e) {
        results[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- TMDB helpers ----
function discoverUrl(page, start, end) {
  // use primary_release_date and release_date together
  const qs = new URLSearchParams({
    api_key: TMDB_KEY,
    language: "en-US",
    with_original_language: "en",
    sort_by: "primary_release_date.desc",
    primary_release_date_gte: start,
    primary_release_date_lte: end,
    release_date_gte: start,
    release_date_lte: end,
    page: String(page),
    include_adult: "false"
  });
  // note: do not set region here (we rely on release_dates for precise country checks), but using US region in discover sometimes helps; we'll leave it out to keep candidate pool broad
  return `https://api.themoviedb.org/3/discover/movie?${qs.toString()}`.replace(/_gte/g, ".gte").replace(/_lte/g, ".lte");
}

function popularUrl(page) {
  const qs = new URLSearchParams({
    api_key: TMDB_KEY,
    language: "en-US",
    page: String(page)
  });
  return `https://api.themoviedb.org/3/movie/popular?${qs.toString()}`;
}

async function getReleaseDates(tmdbId) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/release_dates?api_key=${TMDB_KEY}`;
  const j = await fetchJSON(url);
  return j?.results || null;
}

async function getExternalImdb(tmdbId) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`;
  const j = await fetchJSON(url);
  return j?.imdb_id || null;
}

// ---- acceptance logic ----
function passesBasicHollywoodFilters(m) {
  if (!m) return false;
  if ((m.original_language || "").toLowerCase() !== "en") return false;
  if ((m.vote_count || 0) < MIN_VOTE_COUNT && (m.popularity || 0) < MIN_POPULARITY) return false;
  return true;
}

function releaseDateInWindow(dateISO, startISO, endISO) {
  if (!dateISO) return false;
  const d = new Date(dateISO);
  const s = new Date(startISO);
  const e = new Date(endISO);
  return d >= s && d <= e;
}

async function checkMovieHasAllowedRelease(movie, startISO, endISO) {
  // Accept if primary release_date on object is in window
  if (movie.release_date && releaseDateInWindow(movie.release_date, startISO, endISO)) {
    return { accepted: true, reason: "primary_release_date", when: movie.release_date };
  }

  // Otherwise check release_dates endpoint for US/CA/GB
  const results = await getReleaseDates(movie.id);
  if (!results) return { accepted: false };

  for (const entry of results) {
    const country = entry.iso_3166_1;
    if (!ALLOWED_COUNTRIES.includes(country)) continue;
    if (!entry.release_dates) continue;
    for (const rd of entry.release_dates) {
      if (!ALLOWED_TYPES.has(rd.type)) continue;
      if (!rd.release_date) continue;
      if (releaseDateInWindow(rd.release_date, startISO, endISO)) {
        return { accepted: true, reason: `release_dates ${country}`, when: rd.release_date };
      }
    }
  }

  return { accepted: false };
}

// ---- main builder ----
async function buildMoviesAll() {
  const startISO = daysAgoISO(DAYS_WINDOW);
  const endISO = daysAgoISO(0);

  // 1) discover pages
  const discoverPromises = [];
  for (let p = 1; p <= DISCOVER_PAGES; p++) {
    discoverPromises.push(fetchJSON(discoverUrl(p, startISO, endISO)));
  }
  const discoverPages = await Promise.all(discoverPromises);
  let candidates = [];
  for (const page of discoverPages) {
    if (page?.results) candidates.push(...page.results);
  }

  // 2) popular pages fallback
  const popularPromises = [];
  for (let p = 1; p <= POPULAR_PAGES; p++) {
    popularPromises.push(fetchJSON(popularUrl(p)));
  }
  const popularPages = await Promise.all(popularPromises);
  for (const p of popularPages) {
    if (p?.results) candidates.push(...p.results);
  }

  // dedupe by id
  const byId = new Map();
  for (const c of candidates) {
    if (!c || !c.id) continue;
    if (!byId.has(c.id)) byId.set(c.id, c);
    else {
      // keep the one with higher popularity or more fields
      const cur = byId.get(c.id);
      if ((c.popularity || 0) > (cur.popularity || 0)) byId.set(c.id, c);
    }
  }

  const unique = Array.from(byId.values());

  // 3) apply basic filters
  const filteredBasic = unique.filter(passesBasicHollywoodFilters);

  // 4) concurrency check release_dates for each candidate
  const checks = await pMap(filteredBasic, async (movie) => {
    try {
      const res = await checkMovieHasAllowedRelease(movie, startISO, endISO);
      if (res.accepted) {
        const imdb = await getExternalImdb(movie.id).catch(()=>null);
        return {
          id: `tmdb:${movie.id}`,
          tmdb_id: movie.id,
          imdb,
          title: movie.title,
          overview: movie.overview || "",
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
          background: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
          release: res.when,
          reason: res.reason,
          popularity: movie.popularity || 0,
          vote_count: movie.vote_count || 0
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }, CONCURRENCY);

  const accepted = checks.filter(Boolean);

  // sort newest -> oldest by release date
  accepted.sort((a,b) => new Date(b.release) - new Date(a.release));

  return accepted;
}

// ---- convert to Stremio metas ----
function toStremioMeta(item) {
  return {
    id: item.id,
    type: "movie",
    name: item.title,
    poster: item.poster,
    background: item.background,
    description: item.overview,
    releaseInfo: item.release,
    // include imdb if available as extra field
    imdb: item.imdb || null
  };
}

// ---- manifest
const manifest = {
  id: "recent_movies_final",
  version: "1.0.0",
  name: "Recent Movies (90 days)",
  description: "Movies released in the past 90 days (US theatrical / streaming / VOD), English only.",
  catalogs: [{ type: "movie", id: "recent_movies", name: "Recent Movies" }],
  resources: ["catalog","meta"],
  types: ["movie"],
  idPrefixes: ["tmdb"]
};

// ---- handler (legacy module.exports)
module.exports = async (req, res) => {
  addCORS(res);
  if (req.method === "OPTIONS") return res.end();

  const path = req.url || "";

  // manifest
  if (path.includes("/manifest.json")) {
    res.setHeader("Content-Type","application/json");
    return res.end(JSON.stringify(manifest));
  }

  // debug
  if (path.includes("/api/debug")) {
    // produce counts and sample
    const start = daysAgoISO(DAYS_WINDOW);
    const end = daysAgoISO(0);
    const sampleReq = {
      start, end,
      discoverPages: DISCOVER_PAGES,
      popularPages: POPULAR_PAGES,
      concurrency: CONCURRENCY
    };
    return res.end(JSON.stringify({ status:"ok", config: sampleReq }, null, 2));
  }

  // catalog
  if (path.includes("/catalog/movie/recent_movies.json")) {
    try {
      const list = await buildMoviesAll();
      const metas = list.map(i => ({
        id: i.id,
        type: "movie",
        name: i.title,
        poster: i.poster,
        background: i.background,
        description: i.overview,
        releaseInfo: i.release,
        imdb: i.imdb
      }));
      res.setHeader("Content-Type","application/json");
      return res.end(JSON.stringify({ metas }, null, 2));
    } catch (err) {
      res.setHeader("Content-Type","application/json");
      return res.end(JSON.stringify({ metas: [], error: String(err) }, null, 2));
    }
  }

  // meta route: minimal
  if (path.includes("/meta/movie/")) {
    const id = path.split("/").pop().replace(".json","").replace("tmdb:","");
    if (!id) return res.end(JSON.stringify({ meta: { id, type: "movie", name: "Unknown" }}));
    const m = await fetchJSON(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&language=en-US`);
    if (!m) return res.end(JSON.stringify({ meta: { id: `tmdb:${id}`, type: "movie", name: "Unknown" }}));
    const meta = {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title,
      description: m.overview && m.overview.replace(/<[^>]+>/g,"").trim(),
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      background: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
      videos: []
    };
    res.setHeader("Content-Type","application/json");
    return res.end(JSON.stringify({ meta }, null, 2));
  }

  // default
  res.setHeader("Content-Type","application/json");
  return res.end(JSON.stringify({ status:"ok", message:"recent movies addon" }));
};
