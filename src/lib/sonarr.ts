import axios from 'axios';
import fs from 'fs';
import path from 'path';

function loadSettings() {
  const filePath = path.resolve(process.cwd(), 'config/settings.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export async function getSonarrUpcoming() {
  const settings = loadSettings();

  const activeInstances = settings.sonarr.filter(
    (s: any) => s.isDefault || s.syncEnabled
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
      const seriesUrl = `${apiBase}/series`;
      const qualityProfileUrl = `${apiBase}/qualityProfile`;

      const headers = {
        'X-Api-Key': instance.apiKey,
      };

      const [episodesResp, seriesResp, qualityProfileResp] = await Promise.all([
        axios.get(calendarUrl, { headers }),
        axios.get(seriesUrl, { headers }),
        axios.get(qualityProfileUrl, { headers }).catch(() => ({ data: [] })),
      ]);

      const seriesMap = new Map();
      for (const series of seriesResp.data) {
        seriesMap.set(series.id, series);
      }

      // Build quality profile lookup
      const qualityProfileMap = new Map<number, string>();
      for (const profile of qualityProfileResp.data) {
        qualityProfileMap.set(profile.id, profile.name);
      }

      // Collect unique series IDs from calendar episodes to fetch episode files
      const seriesIds = new Set<number>();
      for (const episode of episodesResp.data) {
        seriesIds.add(episode.seriesId);
      }

      // Fetch episode files for each series in the calendar range
      const episodeFileMap = new Map<string, any>(); // key: "seriesId-seasonNumber-episodeNumber"
      await Promise.all(
        Array.from(seriesIds).map(async (seriesId) => {
          try {
            const resp = await axios.get(
              `${apiBase}/episodeFile?seriesId=${seriesId}`,
              { headers }
            );
            for (const file of resp.data) {
              // Map by episode file id for lookup
              episodeFileMap.set(String(file.id), file);
            }
          } catch {
            // If episode file fetch fails, skip — quality/language just won't be shown
          }
        })
      );

      return episodesResp.data.map((episode: any) => {
        const series = seriesMap.get(episode.seriesId);
        const qualityProfileName = series?.qualityProfileId
          ? qualityProfileMap.get(series.qualityProfileId) || ''
          : '';

        // Get episode file info for quality and language
        let quality = '';
        const audioLanguages: string[] = [];
        const subtitleLanguages: string[] = [];
        if (episode.hasFile && episode.episodeFileId) {
          const epFile = episodeFileMap.get(String(episode.episodeFileId));
          if (epFile) {
            quality = epFile.quality?.quality?.name || '';
            // Audio languages from episode file (Sonarr v4 uses languages array)
            if (epFile.languages && Array.isArray(epFile.languages)) {
              for (const l of epFile.languages) {
                if (l.name && !audioLanguages.includes(l.name)) {
                  audioLanguages.push(l.name);
                }
              }
            } else if (epFile.language?.name) {
              audioLanguages.push(epFile.language.name);
            }
            // Subtitle languages from mediaInfo if available
            if (epFile.mediaInfo?.subtitles) {
              const subs =
                typeof epFile.mediaInfo.subtitles === 'string'
                  ? epFile.mediaInfo.subtitles
                      .split('/')
                      .map((s: string) => s.trim())
                  : [];
              for (const sub of subs) {
                if (sub && !subtitleLanguages.includes(sub)) {
                  subtitleLanguages.push(sub);
                }
              }
            }
          }
        }

        // Fallback language from series originalLanguage (Sonarr v4)
        if (audioLanguages.length === 0 && series?.originalLanguage?.name) {
          audioLanguages.push(series.originalLanguage.name);
        }

        // Combine into a structured language string: audio langs, then English subs only
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

        // Episode statistics from series
        const seriesStats = series?.statistics || {};

        return {
          title: series?.title || '',
          year: series?.year,
          episodeCode: `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`,
          episodeTitle: episode.title,
          start: episode.airDateUtc,
          status: episode.hasFile ? 'Available' : 'Requested',
          type: 'tv',
          tmdbId: series?.tmdbId || null,
          fanart: series?.images?.find((img: any) => img.coverType === 'fanart')
            ?.remoteUrl,
          seriesId: series?.id,
          seriesStatus: series?.status || '',
          seriesOverview: series?.overview || '',
          description: episode.overview || '',
          qualityProfileName,
          quality,
          language,
          episodeCount: seriesStats.episodeCount || 0,
          episodeFileCount: seriesStats.episodeFileCount || 0,
        };
      });
    })
  );

  return allResults.flat();
}
