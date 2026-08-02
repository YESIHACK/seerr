import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { Watchlist } from '@server/entity/Watchlist';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Router } from 'express';

const router = Router();

router.post('/sonarr', async (req, res) => {
  const payload = req.body;

  if (payload.eventType !== 'Download') {
    return res.status(200).json({ message: 'Ignored non-Download event' });
  }

  const tvdbId = payload.series?.tvdbId;
  const externalServiceId = payload.series?.id;
  const episodes = payload.episodes;

  if (!tvdbId || !episodes || !episodes.length) {
    return res.status(400).json({ message: 'Missing series or episodes data' });
  }

  const mediaRepository = getRepository(Media);
  const media = await mediaRepository.findOne({
    where: [{ tvdbId: tvdbId }, { externalServiceId: externalServiceId }],
  });

  if (!media) {
    return res.status(200).json({ message: 'Media not found in Seerr' });
  }

  const requestRepository = getRepository(MediaRequest);
  // Find all approved requests for this media
  const requests = await requestRepository.find({
    where: { media: { id: media.id }, status: MediaRequestStatus.APPROVED },
    relations: { requestedBy: true, seasons: true },
  });

  const watchlistRepository = getRepository(Watchlist);
  const watchlists = await watchlistRepository.find({
    where: { media: { id: media.id } },
    relations: { requestedBy: true },
  });

  if (!requests.length && !watchlists.length) {
    return res
      .status(200)
      .json({ message: 'No approved requests or watchlists for this media' });
  }

  const tmdb = new TheMovieDb();
  const tv = await tmdb.getTvShow({ tvId: media.tmdbId });

  for (const episode of episodes) {
    const seasonNumber = episode.seasonNumber;

    // Find requests that asked for this season
    const relevantRequests = requests.filter((req) =>
      req.seasons.some((s) => s.seasonNumber === seasonNumber)
    );

    const notifiedUserIds = new Set<number>();

    for (const request of relevantRequests) {
      notifiedUserIds.add(request.requestedBy.id);
      notificationManager.sendNotification(Notification.EPISODE_AVAILABLE, {
        event: `Episode Downloaded`,
        subject: `${payload.series.title} - S${String(seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`,
        message: episode.title || '',
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: request.requestedBy,
        media: media,
        image: tv.poster_path
          ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`
          : undefined,
        request: request,
      });
    }

    for (const watchlist of watchlists) {
      if (!notifiedUserIds.has(watchlist.requestedBy.id)) {
        notifiedUserIds.add(watchlist.requestedBy.id);
        notificationManager.sendNotification(Notification.EPISODE_AVAILABLE, {
          event: `Episode Downloaded`,
          subject: `${payload.series.title} - S${String(seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`,
          message: episode.title || '',
          notifyAdmin: false,
          notifySystem: true,
          notifyUser: watchlist.requestedBy,
          media: media,
          image: tv.poster_path
            ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`
            : undefined,
        });
      }
    }
  }

  return res.status(200).json({ message: 'Webhook processed successfully' });
});

export default router;
