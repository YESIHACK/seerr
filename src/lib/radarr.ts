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
      const calendarUrl = `${scheme}://${instance.hostname}:${
        instance.port
      }${baseUrl}/api/v3/calendar?start=${start.toISOString()}&end=${end.toISOString()}`;
      const movieUrl = `${scheme}://${instance.hostname}:${instance.port}${baseUrl}/api/v3/movie`;

      try {
        const [calendarRes, movieRes] = await Promise.all([
          axios.get(calendarUrl, {
            headers: { 'X-Api-Key': instance.apiKey },
          }),
          axios.get(movieUrl, {
            headers: { 'X-Api-Key': instance.apiKey },
          }),
        ]);

        const movieDetailsById: Record<number, any> = {};
        for (const movie of movieRes.data) {
          movieDetailsById[movie.id] = movie;
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

            const events: any[] = [];

            if (item.inCinemas) {
              events.push({
                title: item.title,
                start: item.inCinemas,
                status: item.hasFile ? 'Available' : 'Pending',
                downloadStatus: item.grabbed
                  ? 'Downloading'
                  : item.hasFile
                  ? 'Available'
                  : 'Pending',
                description: item.overview,
                type: 'movie',
                tmdbId: item.tmdbId,
                year: item.year,
                certification: item.certification,
                runtime: item.runtime,
                genres: item.genres,
                fanart,
                availabilityType: 'Cinema',
              });
            }

            if (item.digitalRelease) {
              events.push({
                title: item.title,
                start: item.digitalRelease,
                status: item.hasFile ? 'Available' : 'Pending',
                downloadStatus: item.grabbed
                  ? 'Downloading'
                  : item.hasFile
                  ? 'Available'
                  : 'Pending',
                description: item.overview,
                type: 'movie',
                tmdbId: item.tmdbId,
                year: item.year,
                certification: item.certification,
                runtime: item.runtime,
                genres: item.genres,
                fanart,
                availabilityType: 'Digital',
              });
            }

            if (item.physicalRelease) {
              events.push({
                title: item.title,
                start: item.physicalRelease,
                status: item.hasFile ? 'Available' : 'Pending',
                downloadStatus: item.grabbed
                  ? 'Downloading'
                  : item.hasFile
                  ? 'Available'
                  : 'Pending',
                description: item.overview,
                type: 'movie',
                tmdbId: item.tmdbId,
                year: item.year,
                certification: item.certification,
                runtime: item.runtime,
                genres: item.genres,
                fanart,
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
