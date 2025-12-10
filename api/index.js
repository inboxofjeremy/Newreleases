export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc"; // hardcoded as requested

    // 90-day window
    const today = new Date();
    const past90 = new Date();
    past90.setDate(today.getDate() - 90);

    const gte = past90.toISOString().split("T")[0];
    const lte = today.toISOString().split("T")[0];

    const url =
        `https://api.themoviedb.org/3/discover/movie?` +
        `api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&with_original_language=en` +
        `&region=US` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${gte}` +
        `&primary_release_date.lte=${lte}` +
        `&include_adult=false`;

    let tmdb;
    try {
        const r = await fetch(url);
        tmdb = await r.json();
    } catch (e) {
        return res.status(200).json({ status: "error", message: "TMDB fetch failed", metas: [] });
    }

    if (!tmdb || !tmdb.results) {
        return res.status(200).json({ status: "error", message: "TMDB empty", metas: [] });
    }

    // Convert TMDB → Stremio metas
    const metas = tmdb.results.map(m => ({
        id: "tmdb:" + m.id,
        type: "movie",
        name: m.title,
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        description: m.overview,
        releaseInfo: m.release_date,
        background: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : null
    }));

    return res.status(200).json({
        status: "ok",
        message: "Movie addon online",
        metas
    });
}
