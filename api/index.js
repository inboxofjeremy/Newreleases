import fetch from "node-fetch";

const TMDB_KEY = process.env.TMDB_KEY || "YOUR_TMDB_KEY_HERE"; // <-- replace or keep env
const REGIONS = ["US", "CA", "GB"]; // priority order
const DAYS = 90;

// Date helpers
const today = new Date();
const cutoff = new Date();
cutoff.setDate(today.getDate() - DAYS);

export default async function handler(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // -------------------------
        // MANIFEST
        // -------------------------
        if (pathname === "/manifest.json") {
            return res.status(200).json({
                id: "hollywood-new-releases",
                version: "1.0.0",
                name: "Hollywood New Releases",
                description: "Movies released in theaters / digital in the last 90 days",
                types: ["movie"],
                catalogs: [
                    {
                        type: "movie",
                        id: "recent_movies",
                        name: "New Releases"
                    }
                ]
            });
        }

        // -------------------------
        // CATALOG
        // -------------------------
        if (pathname === "/catalog/movie/recent_movies.json") {
            if (!TMDB_KEY || TMDB_KEY === "944017b839d3c040bdd2574083e4c1bc") {
                return res.status(200).json({
                    metas: [],
                    error: "TMDB key missing"
                });
            }

            // 1. Fetch newest movies sorted by popularity
            const discoverURL = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&language=en-US&include_adult=false&sort_by=popularity.desc&with_release_type=3|2|4`;

            const discover = await fetch(discoverURL);
            const discoverData = await discover.json();

            if (!discoverData.results) {
                return res.status(200).json({
                    metas: [],
                    error: "Invalid TMDB response"
                });
            }

            let movies = [];

            // 2. For each movie, fetch regional release dates
            for (const movie of discoverData.results) {
                const rdURL = `https://api.themoviedb.org/3/movie/${movie.id}/release_dates?api_key=${TMDB_KEY}`;
                const rdReq = await fetch(rdURL);
                const rdData = await rdReq.json();

                if (!rdData.results) continue;

                // Pick first available region date in priority order
                let pickedDate = null;

                for (const region of REGIONS) {
                    const regionEntry = rdData.results.find(r => r.iso_3166_1 === region);
                    if (regionEntry && regionEntry.release_dates.length > 0) {
                        // find theatrical(3), digital(4), vod(2)
                        const good = regionEntry.release_dates.find(r =>
                            [2, 3, 4].includes(r.type)
                        );
                        if (good && good.release_date) {
                            pickedDate = good.release_date;
                            break;
                        }
                    }
                }

                if (!pickedDate) continue;

                const rd = new Date(pickedDate);
                if (rd < cutoff) continue; // skip old movies

                // build meta
                movies.push({
                    id: `tmdb:${movie.id}`,
                    type: "movie",
                    name: movie.title,
                    poster: movie.poster_path
                        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                        : null,
                    background: movie.backdrop_path
                        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
                        : null,
                    releaseInfo: pickedDate.slice(0, 10),
                    popularity: movie.popularity
                });
            }

            // Sort by real release date (newest first)
            movies.sort((a, b) => new Date(b.releaseInfo) - new Date(a.releaseInfo));

            return res.status(200).json({ metas: movies });
        }

        // -------------------------
        // DEFAULT: NOT FOUND
        // -------------------------
        return res.status(404).json({ error: "Not found" });

    } catch (err) {
        return res.status(500).json({
            error: "Server error",
            details: err.message
        });
    }
}
