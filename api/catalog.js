export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const REGIONS = ["US"];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

function cors(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchRegionalDate(id) {
  const json = await fetchJSON(`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`);
  if (!json?.results) return null;
  const us = json.results.find(r => REGIONS.includes(r.iso_3166_1));
  if (!us) return null;
  const first = us.release_dates.sort((a,b)=>new Date(a.release_date)-new Date(b.release_date))[0];
  return first?.release_date?.split("T")[0] || null;
}

async function fetchMovies() {
  let allMovies = [];
  for (let page=1; page<=5; page++) { // fetch first 5 pages (20 movies per page)
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&region=US&with_original_language=en&sort_by=primary_release_date.desc&primary_release_date.gte=${DATE_FROM}&primary_release_date.lte=${DATE_TO}&page=${page}`;
    const json = await fetchJSON(url);
    if (!json?.results?.length) break;
    allMovies.push(...json.results);
  }

  const movies = await Promise.all(allMovies.map(async m=>{
    const release = await fetchRegionalDate(m.id);
    if (!release || release < DATE_FROM || release > DATE_TO) return null;
    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title,
      description: m.overview || "",
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      releaseInfo: release
    };
  }));

  return movies.filter(Boolean);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const list = await fetchMovies();
      return cors({ metas: list });
    } catch(err) {
      return cors({ metas: [], error: err.message });
    }
  }

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "US Recent Movie Releases",
      description: "Movies released in the US in the last 180 days",
      types: ["movie"],
      catalogs: [{ id: "recent_movies", type: "movie", name: "Recent US Releases" }]
    });
  }

  return cors({ ok: true });
}