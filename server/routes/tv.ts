import { getMetadataProvider } from '@server/api/metadata';
import RottenTomatoes from '@server/api/rating/rottentomatoes';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type { TmdbKeyword } from '@server/api/themoviedb/interfaces';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { mapTvResult } from '@server/models/Search';
import { mapSeasonWithEpisodes, mapTvDetails } from '@server/models/Tv';
import { Router } from 'express';

const tvRoutes = Router();

tvRoutes.get('/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const tmdbTv = await tmdb.getTvShow({
      tvId: Number(req.params.id),
    });
    const metadataProvider = tmdbTv.keywords.results.some(
      (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
    )
      ? await getMetadataProvider('anime')
      : await getMetadataProvider('tv');
    const tv = await metadataProvider.getTvShow({
      tvId: Number(req.params.id),
      language: (req.query.language as string) ?? req.locale,
    });
    const media = await Media.getMedia(tv.id, MediaType.TV);

    const onUserWatchlist = await getRepository(Watchlist).exist({
      where: {
        tmdbId: Number(req.params.id),
        mediaType: MediaType.TV,
        requestedBy: {
          id: req.user?.id,
        },
      },
    });

    const data = mapTvDetails(tv, media, onUserWatchlist);

    // TMDB issue where it doesnt fallback to English when no overview is available in requested locale.
    if (!data.overview) {
      const tvEnglish = await metadataProvider.getTvShow({
        tvId: Number(req.params.id),
      });
      data.overview = tvEnglish.overview;
    }

    // Try to enrich season availability with live Sonarr data
    const tvdbId = tmdbTv.external_ids?.tvdb_id;
    if (tvdbId || (media && media.externalServiceId)) {
      const settings = getSettings();
      const activeSonarrs = settings.sonarr.filter(
        (s) => s.isDefault || s.syncEnabled || s.id === media?.serviceId
      );

      let sonarrInstance = null;
      let sonarrSeriesId = null;

      if (media && media.externalServiceId && media.serviceId !== undefined) {
        sonarrInstance = settings.sonarr.find((s) => s.id === media.serviceId);
        sonarrSeriesId = media.externalServiceId;
      }

      if (!sonarrInstance && tvdbId) {
        for (const sonarrSettings of activeSonarrs) {
          try {
            const sonarr = new SonarrAPI({
              url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
              apiKey: sonarrSettings.apiKey,
            });
            const seriesInfo = await sonarr.getSeriesByTvdbId(tvdbId);
            if (seriesInfo && seriesInfo.id) {
              sonarrInstance = sonarrSettings;
              sonarrSeriesId = seriesInfo.id;
              break;
            }
          } catch {
            // not found
          }
        }
      }

      if (sonarrInstance && sonarrSeriesId) {
        try {
          const sonarr = new SonarrAPI({
            url: SonarrAPI.buildUrl(sonarrInstance, '/api/v3'),
            apiKey: sonarrInstance.apiKey,
          });
          const sonarrSeries = await sonarr.getSeriesById(sonarrSeriesId);

          if (sonarrSeries && sonarrSeries.seasons) {
            for (const sonarrSeason of sonarrSeries.seasons) {
              const matchedSeason = data.seasons.find(
                (s) => s.seasonNumber === sonarrSeason.seasonNumber
              );
              if (matchedSeason && sonarrSeason.statistics) {
                if (sonarrSeason.statistics.percentOfEpisodes === 100) {
                  matchedSeason.sonarrHasFile = true;
                } else if (sonarrSeason.statistics.percentOfEpisodes > 0) {
                  matchedSeason.sonarrIsPartial = true;
                }
              }
            }
          }
        } catch (e) {
          logger.debug(
            'Failed to fetch Sonarr series data for season enrichment',
            {
              label: 'API',
              errorMessage: e.message,
            }
          );
        }
      }
    }

    return res.status(200).json(data);
  } catch (e) {
    logger.debug('Something went wrong retrieving series', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series.',
    });
  }
});

tvRoutes.get('/:id/season/:seasonNumber', async (req, res, next) => {
  try {
    const tmdb = new TheMovieDb();
    const tmdbTv = await tmdb.getTvShow({
      tvId: Number(req.params.id),
    });
    const metadataProvider = tmdbTv.keywords.results.some(
      (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
    )
      ? await getMetadataProvider('anime')
      : await getMetadataProvider('tv');

    const season = await metadataProvider.getTvSeason({
      tvId: Number(req.params.id),
      seasonNumber: Number(req.params.seasonNumber),
      language: (req.query.language as string) ?? req.locale,
    });

    const mappedSeason = mapSeasonWithEpisodes(season);

    // Try to enrich with Sonarr file data
    const media = await Media.getMedia(Number(req.params.id), MediaType.TV);
    const tvdbId = tmdbTv.external_ids?.tvdb_id;

    logger.debug('Starting Sonarr enrichment', {
      label: 'API',
      tvId: req.params.id,
      tvdbId,
      hasMedia: !!media,
      externalServiceId: media?.externalServiceId,
      serviceId: media?.serviceId,
    });

    const settings = getSettings();
    const activeSonarrs = settings.sonarr.filter(
      (s) => s.isDefault || s.syncEnabled || s.id === media?.serviceId
    );

    let sonarrInstance = null;
    let sonarrSeriesId = null;

    if (media && media.externalServiceId && media.serviceId !== undefined) {
      sonarrInstance = settings.sonarr.find((s) => s.id === media.serviceId);
      sonarrSeriesId = media.externalServiceId;
    }

    // If we didn't find a direct mapping, try to search active sonarrs by tvdbId
    if (!sonarrInstance && tvdbId) {
      for (const sonarrSettings of activeSonarrs) {
        try {
          const sonarr = new SonarrAPI({
            url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
            apiKey: sonarrSettings.apiKey,
          });
          const seriesInfo = await sonarr.getSeriesByTvdbId(tvdbId);
          if (seriesInfo && seriesInfo.id) {
            sonarrInstance = sonarrSettings;
            sonarrSeriesId = seriesInfo.id;
            break;
          }
        } catch {
          // not found on this instance
        }
      }
    }

    if (sonarrInstance && sonarrSeriesId) {
      logger.debug('Found Sonarr instance and series ID', {
        label: 'API',
        sonarrSeriesId,
      });
      try {
        const sonarr = new SonarrAPI({
          url: SonarrAPI.buildUrl(sonarrInstance, '/api/v3'),
          apiKey: sonarrInstance.apiKey,
        });

        const episodeFiles = await sonarr.getEpisodeFiles(sonarrSeriesId);
        logger.debug(`Fetched ${episodeFiles.length} episode files`, {
          label: 'API',
        });

        const episodeFileMap = new Map<string, any>();
        for (const file of episodeFiles) {
          episodeFileMap.set(String(file.id), file);
        }

        const sonarrEpisodes = await sonarr.getEpisodes(sonarrSeriesId);
        logger.debug(`Fetched ${sonarrEpisodes.length} episodes from Sonarr`, {
          label: 'API',
        });

        let enrichmentCount = 0;
        for (const ep of mappedSeason.episodes) {
          const sEp = sonarrEpisodes.find(
            (se: any) =>
              se.seasonNumber === ep.seasonNumber &&
              se.episodeNumber === ep.episodeNumber
          );
          if (sEp && sEp.hasFile && sEp.episodeFileId) {
            const epFile = episodeFileMap.get(String(sEp.episodeFileId));
            if (epFile) {
              ep.hasFile = true;
              ep.quality = epFile.quality?.quality?.name || '';

              const audioLanguages: string[] = [];
              const subtitleLanguages: string[] = [];

              if (epFile.languages && Array.isArray(epFile.languages)) {
                for (const l of epFile.languages) {
                  if (l.name && !audioLanguages.includes(l.name)) {
                    audioLanguages.push(l.name);
                  }
                }
              } else if (epFile.language?.name) {
                audioLanguages.push(epFile.language.name);
              }

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

              const allLanguages = [
                ...audioLanguages,
                ...subtitleLanguages
                  .filter(
                    (s: string) =>
                      !audioLanguages.includes(s) &&
                      s.toLowerCase() === 'english'
                  )
                  .map((s: string) => `${s} (Sub)`),
              ];

              ep.language = allLanguages.join(', ');
              enrichmentCount++;
            }
          }
        }
        logger.debug(`Enriched ${enrichmentCount} episodes`, { label: 'API' });
      } catch (err) {
        logger.debug('Failed to fetch Sonarr episode data for enrichment', {
          label: 'API',
          errorMessage: err.message,
        });
      }
    } else {
      logger.debug('Could not find Sonarr instance or series ID for TV show', {
        label: 'API',
      });
    }

    return res.status(200).json(mappedSeason);
  } catch (e) {
    logger.debug('Something went wrong retrieving season', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
      seasonNumber: req.params.seasonNumber,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve season.',
    });
  }
});

tvRoutes.get('/:id/recommendations', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.getTvRecommendations({
      tvId: Number(req.params.id),
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      results.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results,
      results: results.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (req) => req.tmdbId === result.id && req.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving series recommendations', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series recommendations.',
    });
  }
});

tvRoutes.get('/:id/similar', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.getTvSimilar({
      tvId: Number(req.params.id),
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      results.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results,
      results: results.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (req) => req.tmdbId === result.id && req.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving similar series', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve similar series.',
    });
  }
});

tvRoutes.get('/:id/ratings', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const rtapi = new RottenTomatoes();

  try {
    const tv = await tmdb.getTvShow({
      tvId: Number(req.params.id),
    });

    const rtratings = await rtapi.getTVRatings(
      tv.name,
      tv.first_air_date ? Number(tv.first_air_date.slice(0, 4)) : undefined
    );

    if (!rtratings) {
      return next({
        status: 404,
        message: 'Rotten Tomatoes ratings not found.',
      });
    }

    return res.status(200).json(rtratings);
  } catch (e) {
    logger.debug('Something went wrong retrieving series ratings', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series ratings.',
    });
  }
});

export default tvRoutes;
