import axios from 'axios';
import fs from 'fs';
import path from 'path';

function loadSettings() {
  const filePath = path.resolve(process.cwd(), 'config/settings.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export async function getRadarrUpcoming() {
  const settings = loadSettings();
  const activeInstances = settings.radarr.filter(
    (r: any) => r.isDefault || r.syncEnabled
  );

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);

  const end = new Date(today);
  end.setDate(end.getDate() + 60);

  const allResults = await Promise.all(
    activeInstances.map(async (instance: any) => {
      const scheme = instance.useSsl ? 'https' : 'http';
      const baseUrl = instance.baseUrl || '';
      const apiBase = `${scheme}://${instance.hostname}:${instance.port}${baseUrl}/api/v3`;
      const calendarUrl = `${apiBase}/calendar?start=${start.toISOString()}&end=${end.toISOString()}`;
      const movieUrl = `${apiBase}/movie`;
      const qualityProfileUrl = `${apiBase}/qualityProfile`;

      try {
        const [calendarRes, movieRes, qualityProfileRes] = await Promise.all([
          axios.get(calendarUrl, {
            headers: { 'X-Api-Key': instance.apiKey },
          }),
          axios.get(movieUrl, {
            headers: { 'X-Api-Key': instance.apiKey },
          }),
          axios
            .get(qualityProfileUrl, {
              headers: { 'X-Api-Key': instance.apiKey },
            })
            .catch(() => ({ data: [] })),
        ]);

        const movieDetailsById: Record<number, any> = {};
        for (const movie of movieRes.data) {
          movieDetailsById[movie.id] = movie;
        }

        // Build quality profile lookup
        const qualityProfileMap = new Map<number, string>();
        for (const profile of qualityProfileRes.data) {
          qualityProfileMap.set(profile.id, profile.name);
        }

        return calendarRes.data
          .filter(
            (item: any) =>
              item?.title &&
              (item?.inCinemas ||
                item?.digitalRelease ||
                item?.physicalRelease ||
                item?.releaseDate)
          )
          .flatMap((item: any) => {
            const movieDetails = movieDetailsById[item.id] || {};
            const fanart =
              movieDetails.images?.find(
                (img: any) => img.coverType === 'fanart'
              )?.remoteUrl || null;

            // Get quality profile name
            const qualityProfileName =
              qualityProfileMap.get(
                item.qualityProfileId || movieDetails.qualityProfileId
              ) || '';

            // Get file quality if downloaded
            let quality = '';
            const audioLanguages: string[] = [];
            const subtitleLanguages: string[] = [];
            const movieFile = movieDetails.movieFile || item.movieFile;
            if (movieFile) {
              quality = movieFile.quality?.quality?.name || '';
              // Audio languages from mediaInfo (can be comma or slash separated)
              if (movieFile.mediaInfo?.audioLanguages) {
                const rawAudio = movieFile.mediaInfo.audioLanguages;
                const langs =
                  typeof rawAudio === 'string'
                    ? rawAudio.split(/[,/]/).map((s: string) => s.trim())
                    : [];
                for (const lang of langs) {
                  if (lang && !audioLanguages.includes(lang)) {
                    audioLanguages.push(lang);
                  }
                }
              }
              // Subtitle languages from mediaInfo
              if (movieFile.mediaInfo?.subtitles) {
                const rawSubs = movieFile.mediaInfo.subtitles;
                const subs =
                  typeof rawSubs === 'string'
                    ? rawSubs.split(/[,/]/).map((s: string) => s.trim())
                    : [];
                for (const sub of subs) {
                  if (sub && !subtitleLanguages.includes(sub)) {
                    subtitleLanguages.push(sub);
                  }
                }
              }
              // Radarr v4+ may have languages array on the movie file
              if (movieFile.languages && Array.isArray(movieFile.languages)) {
                for (const l of movieFile.languages) {
                  if (l.name && !audioLanguages.includes(l.name)) {
                    audioLanguages.push(l.name);
                  }
                }
              }
            }

            // Fallback: originalLanguage from the movie object
            if (
              audioLanguages.length === 0 &&
              (item.originalLanguage?.name ||
                movieDetails.originalLanguage?.name)
            ) {
              audioLanguages.push(
                item.originalLanguage?.name ||
                  movieDetails.originalLanguage?.name
              );
            }

            // Combine: audio langs, then English subs only
            const allLanguages = [
              ...audioLanguages,
              ...subtitleLanguages
                .filter(
                  (s: string) =>
                    !audioLanguages.includes(s) && s.toLowerCase() === 'english'
                )
                .map((s: string) => `${s} (Sub)`),
            ];
            const language = allLanguages.join(', ');

            const events: any[] = [];

            const baseEvent = {
              title: item.title,
              description: item.overview,
              type: 'movie',
              tmdbId: item.tmdbId,
              year: item.year,
              certification: item.certification,
              runtime: item.runtime,
              genres: item.genres,
              fanart,
              qualityProfileName,
              quality,
              language,
            };

            if (item.inCinemas) {
              events.push({
                ...baseEvent,
                start: item.inCinemas,
                status: item.hasFile ? 'Available' : 'Pending',
                downloadStatus: item.grabbed
                  ? 'Downloading'
                  : item.hasFile
                    ? 'Available'
                    : 'Pending',
                availabilityType: 'Cinema',
              });
            }

            if (item.digitalRelease) {
              events.push({
                ...baseEvent,
                start: item.digitalRelease,
                status: item.hasFile ? 'Available' : 'Pending',
                downloadStatus: item.grabbed
                  ? 'Downloading'
                  : item.hasFile
                    ? 'Available'
                    : 'Pending',
                availabilityType: 'Digital',
              });
            }

            if (item.physicalRelease) {
              events.push({
                ...baseEvent,
                start: item.physicalRelease,
                status: item.hasFile ? 'Available' : 'Pending',
                downloadStatus: item.grabbed
                  ? 'Downloading'
                  : item.hasFile
                    ? 'Available'
                    : 'Pending',
                availabilityType: 'Physical',
              });
            }

            return events;
          });
      } catch (err: any) {
        console.error(
          `❌ Radarr (${instance.hostname}) fetch failed:`,
          err.message
        );
        return [];
      }
    })
  );

  return allResults.flat();
}
