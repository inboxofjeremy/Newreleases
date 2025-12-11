export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const REGIONS = ["US"];
const ALL_RELEASE_TYPES = [1,2,3,4,5,6,7,8]; // include all TMDB release types

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

function cors(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function fetchUSRelease(id) {
  try {
    const r = await fetch(`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`, { cache: "no-store" });
    const j = await r.json();
    if (!j.results) return null;

    const us = j.results.find(x => REGIONS.includes(x.iso_3166_1));
    if (!us) return null;

    const valid = us.release_dates.filter(r => ALL_RELEASE_TYPES.includes(r.type));
    if (!valid.length) return null;

    return valid[0].release_date.split("T")[0];
  } catch {
    return null;
  }
}

async function fetchMovies() {
  const movies = [];
  const MAX_PAGES = 5; // fetch multiple pages to get more movies
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(
      `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&language=en-US&with_original_language=en&sort_by=primary_release_date.desc&primary_release_date.gte=${DATE_FROM}&primary_release_date.lte=${DATE_TO}&page=${page}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!j.results || !j.results.length) break;

    const results = await Promise.all(j.results.map(async m => {
      const release = await fetchUSRelease(m.id);
      if (!release) return null;
      if (release < DATE_FROM || release > DATE_TO) return null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        description: m.overview || "",
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        releaseInfo: release
      };
    }));

    movies.push(...results.filter(Boolean));
  }
  return movies;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const list = await fetchMovies();
      return cors({ metas: list });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  return cors({ ok: true });
}