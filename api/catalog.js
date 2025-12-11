export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// CORS helper
function cors(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Fetch release dates for US (any type)
async function fetchUSRelease(id) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (!json.results) return null;
    const us = json.results.find(r => r.iso_3166_1 === "US");
    if (!us || !us.release_dates.length) return null;
    return us.release_dates[0].release_date.split("T")[0];
  } catch {
    return null;
  }
}

// Fetch one TMDb discover page
async function fetchTMDBPage(page = 1) {
  const url =
    `https://api.themoviedb.org/3/discover/movie?` +
    `api_key=${TMDB_KEY}` +
    `&sort_by=primary_release_date.desc` +
    `&primary_release_date.gte=${DATE_FROM}` +
    `&primary_release_date.lte=${DATE_TO}` +
    `&page=${page}`;
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  return json.results || [];
}

// Fetch all pages until no more results
async function fetchAllMovies() {
  const metas = [];
  let page = 1;

  while (true) {
    const list = await fetchTMDBPage(page);
    if (!list.length) break;

    const movies = await Promise.all(
      list.map(async m => {
        const releaseInfo = await fetchUSRelease(m.id);
        if (!releaseInfo) return null;
        if (releaseInfo < DATE_FROM || releaseInfo > DATE_TO) return null;

        return {
          id: `tmdb:${m.id}`,
          type: "movie",
          name: m.title,
          description: m.overview || "",
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
          releaseInfo,
        };
      })
    );

    metas.push(...movies.filter(Boolean));
    page++;
  }

  return metas;
}

// Handler
export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "Recent US Movies",
      description: `All movies released in US theatres, streaming, or digital in the last ${DAYS_BACK} days.`,
      types: ["movie"],
      catalogs: [
        {
          type: "movie",
          id: "recent_movies",
          name: "Recent US Movies",
        },
      ],
    });
  }

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const metas = await fetchAllMovies();
      return cors({ metas });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  return cors({ ok: true });
}