import AirDateBadge from '@app/components/AirDateBadge';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
import type { SeasonWithEpisodes } from '@server/models/Tv';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.TvDetails.Season', {
  somethingwentwrong: 'Something went wrong while retrieving season data.',
  noepisodes: 'Episode list unavailable.',
});

type SeasonProps = {
  seasonNumber: number;
  tvId: number;
};

const Season = ({ seasonNumber, tvId }: SeasonProps) => {
  const intl = useIntl();
  const { data, error } = useSWR<SeasonWithEpisodes>(
    `/api/v1/tv/${tvId}/season/${seasonNumber}`
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <div>{intl.formatMessage(messages.somethingwentwrong)}</div>;
  }

  return (
    <div className="flex flex-col justify-center divide-y divide-gray-700">
      {data.episodes.length === 0 ? (
        <p>{intl.formatMessage(messages.noepisodes)}</p>
      ) : (
        data.episodes
          .slice()
          .reverse()
          .map((episode) => {
            return (
              <div
                className="flex flex-col space-y-4 py-4 xl:flex-row xl:space-x-4 xl:space-y-4"
                key={`season-${seasonNumber}-episode-${episode.episodeNumber}`}
              >
                <div className="flex-1">
                  <div className="flex flex-col space-y-2 xl:flex-row xl:items-center xl:space-x-2 xl:space-y-0">
                    <h3 className="text-lg">
                      {episode.episodeNumber} - {episode.name}
                    </h3>
                    <div className="flex items-center space-x-2">
                      {episode.airDate && (
                        <AirDateBadge airDate={episode.airDate} />
                      )}
                      {episode.hasFile && (
                        <span className="rounded-full bg-green-500 px-2 py-0.5 text-xs font-bold text-white">
                          Available on server
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Badges row for quality and languages */}
                  {(episode.quality || episode.language) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {episode.quality && (
                        <span className="rounded-full bg-gradient-to-br from-emerald-600 to-emerald-500 px-2 py-0.5 text-[0.65rem] font-bold tracking-wide text-white">
                          {episode.quality}
                        </span>
                      )}
                      {episode.language &&
                        episode.language
                          .split(',')
                          .map((lang: string) => lang.trim())
                          .filter(Boolean)
                          .map((lang: string, idx: number) => {
                            const isSub = lang.endsWith('(Sub)');
                            const bgClass = isSub
                              ? 'from-gray-500 to-gray-400 italic'
                              : 'from-indigo-600 to-violet-600';
                            return (
                              <span
                                key={idx}
                                className={`rounded-full bg-gradient-to-br px-2 py-0.5 text-[0.65rem] font-bold text-white ${bgClass} tracking-wide`}
                              >
                                {lang}
                              </span>
                            );
                          })}
                    </div>
                  )}

                  {episode.overview && (
                    <p className="mt-2">{episode.overview}</p>
                  )}
                </div>
                {episode.stillPath && (
                  <div className="relative aspect-video xl:h-32">
                    <CachedImage
                      type="tmdb"
                      className="rounded-lg object-contain"
                      src={episode.stillPath}
                      alt=""
                      fill
                    />
                  </div>
                )}
              </div>
            );
          })
      )}
    </div>
  );
};

export default Season;
