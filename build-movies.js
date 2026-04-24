// build-movies.js
import fs from "fs";
import path from "path";

// ===============================
// CONFIG
// ===============================
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc"; // your key
const OUTPUT_DIR = ".";
const DAYS_BACK = 180;
const MAX_PAGES = 20;
const TMDB_CONCURRENCY = 8;
const MIN_VOTE_COUNT = 5;

// ===============================
// HELPERS
// ===============================
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchUSReleaseDate(id) {
  const json = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`
  );
  if (!json?.results) return null;

  const us = json.results.find((r) => r.iso_3166_1 === "US");
  if (!us?.release_dates?.length) return null;

  return (
    us.release_dates
      .map((d) => d.release_date?.slice(0, 10))
      .filter(Boolean)
      .sort()[0] || null
  );
}

async function pMap(list, fn, concurrency = TMDB_CONCURRENCY) {
  const out = new Array(list.length);
  let i = 0;

  const workers = Array(concurrency)
    .fill(0)
    .map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= list.length) break;
        try {
          out[idx] = await fn(list[idx], idx);
        } catch {
          out[idx] = null;
        }
      }
    });

  await Promise.all(workers);
  return out;
}

// ===============================
// MOVIE FETCHER
// ===============================
async function fetchMovies() {
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&region=US` +
      `&vote_count.gte=${MIN_VOTE_COUNT}` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&without_genres=27` +
      `&page=${page}`;

    const j = await fetchJSON(url);
    if (!j?.results?.length) break;

    all.push(...j.results);
    if (page >= j.total_pages) break;
  }

  const mapped = await pMap(
    all,
    async (m) => {
      if (!m?.id) return null;

      const usDate = await fetchUSReleaseDate(m.id);
      if (!usDate) return null;
      if (usDate < DATE_FROM || usDate > DATE_TO) return null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title || m.original_title || `Movie ${m.id}`,
        description: m.overview || "",
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
        releaseInfo: usDate,
      };
    },
    TMDB_CONCURRENCY
  );

  return mapped.filter(Boolean);
}

// ===============================
// TV SPECIALS FETCHER
// ===============================
async function fetchTVSpecials() {
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/tv?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&sort_by=first_air_date.desc` +
      `&first_air_date.gte=${DATE_FROM}` +
      `&first_air_date.lte=${DATE_TO}` +
      `&page=${page}`;

    const j = await fetchJSON(url);
    if (!j?.results?.length) break;

    all.push(...j.results);
    if (page >= j.total_pages) break;
  }

  return all.map((m) => ({
    id: `tmdbtv:${m.id}`,
    type: "movie", // keep addon structure unchanged
    name: m.name || m.original_name || `TV Special ${m.id}`,
    description: m.overview || "",
    poster: m.poster_path
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
      : null,
    releaseInfo: m.first_air_date || null,
  }))
  .filter((m) => m.releaseInfo);
}

// ===============================
// META BUILDER
// ===============================
async function buildMeta(id) {
  const isTV = id.startsWith("tmdbtv:");
  const tmdbId = id.split(":")[1];
  if (!tmdbId) return null;

  const endpoint = isTV ? "tv" : "movie";

  const item = await fetchJSON(
    `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`
  );

  if (!item) return null;

  return {
    meta: {
      id,
      type: "movie", // keep structure unchanged
      name: item.title || item.name,
      description: item.overview || "",
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : null,
      background: item.backdrop_path
        ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
        : null,
      released: item.release_date || item.first_air_date || null,
      imdb: item.imdb_id || null,
    },
  };
}

// ===============================
// MAIN BUILD
// ===============================
async function build() {
  console.log("Fetching movies and specials…");

  const movies = await fetchMovies();
  const specials = await fetchTVSpecials();

  const combined = [...movies, ...specials];

  const seen = new Set();
  const out = [];

  for (const item of combined) {
    if (!item) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  out.sort((a, b) =>
    b.releaseInfo.localeCompare(a.releaseInfo)
  );

  fs.mkdirSync("./catalog/movie", { recursive: true });
  fs.mkdirSync("./meta/movie", { recursive: true });

  fs.writeFileSync(
    "./catalog/movie/new_releases.json",
    JSON.stringify({ metas: out, ts: Date.now() }, null, 2)
  );

  for (const m of out) {
    const meta = await buildMeta(m.id);
    if (!meta) continue;

    fs.writeFileSync(
      `./meta/movie/${m.id}.json`,
      JSON.stringify(meta, null, 2)
    );
  }

  console.log("Done.");
}

build();
