import { LanguageContext } from '@app/context/LanguageContext';
import dayGridPlugin from '@fullcalendar/daygrid';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import Head from 'next/head';
import { useContext, useEffect, useRef, useState } from 'react';

export default function CalendarPage() {
  const { locale } = useContext(LanguageContext);
  const calendarRef = useRef<any>(null); // or more properly: RefObject<FullCalendar>

  const [calendarView, setCalendarView] = useState('dayGridMonth');
  const [events, setEvents] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'tv' | 'movie'>('all');
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const formatEpisodeCode = (code: string): string => {
    const singleMatch = code.match(/^S(\d+)E(\d+)$/i);
    if (singleMatch) {
      const season = parseInt(singleMatch[1], 10);
      const episode = parseInt(singleMatch[2], 10);
      return `Season ${season}, Episode ${episode}`;
    }

    const rangeSameSeason = code.match(/^S(\d+)E(\d+)–E(\d+)$/i);
    if (rangeSameSeason) {
      const season = parseInt(rangeSameSeason[1], 10);
      const epStart = parseInt(rangeSameSeason[2], 10);
      const epEnd = parseInt(rangeSameSeason[3], 10);
      return `Season ${season}, Episodes ${epStart}–${epEnd}`;
    }

    const rangeDiffSeason = code.match(/^S(\d+)E(\d+)–S(\d+)E(\d+)$/i);
    if (rangeDiffSeason) {
      const s1 = parseInt(rangeDiffSeason[1], 10);
      const e1 = parseInt(rangeDiffSeason[2], 10);
      const s2 = parseInt(rangeDiffSeason[3], 10);
      const e2 = parseInt(rangeDiffSeason[4], 10);
      return `Season ${s1}, Episode ${e1} – Season ${s2}, Episode ${e2}`;
    }

    return code;
  };

  const extractSeasonNumber = (code: string) => {
    const match = code.match(/^S(\d+)/i);
    return match ? parseInt(match[1], 10) : '';
  };

  const extractEpisodeNumber = (code: string) => {
    const match = code.match(/E(\d+)$/i);
    return match ? parseInt(match[1], 10) : '';
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getEventClass = (_event?: any) => 'event-neutral';

  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      const view = isMobile ? 'dayGridDay' : 'dayGridMonth';
      setCalendarView(view);
      calendarRef.current?.getApi().changeView(view);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const filterWrapper = document.querySelector('.fc-customFilter-button');
    if (filterWrapper) {
      const existing = filterWrapper.querySelector('select');
      if (existing) return;

      const dropdown = document.createElement('select');
      dropdown.className = 'calendar-filter';
      dropdown.innerHTML = `
        <option value="all">All</option>
        <option value="tv">TV Only</option>
        <option value="movie">Movies Only</option>
      `;
      dropdown.value = filter;
      dropdown.onchange = (e) => {
        const val = (e.target as HTMLSelectElement).value as
          | 'all'
          | 'tv'
          | 'movie';
        setFilter(val);
      };

      filterWrapper.innerHTML = '';
      filterWrapper.appendChild(dropdown);
    }
  }, [filter]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setSelectedEvent(null);
        document.body.style.overflow = '';
      }
    }

    if (selectedEvent) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedEvent]);

  useEffect(() => {
    const loadEvents = async () => {
      try {
        const res = await fetch('/api/calendar');
        const data = await res.json();
        const enriched = data.map((e: any) => {
          const isMovie = e.type === 'movie' || (!e.type && !e.episodeCode);
          const calendarTitle = isMovie
            ? (e.year ? `${e.title} (${e.year})` : e.title) +
              (e.availabilityType ? ` [${e.availabilityType}]` : '')
            : e.episodeCode
            ? `${e.title} - ${e.episodeCode}`
            : e.title;

          const fanart =
            e.images?.find((img: any) => img.coverType === 'fanart')
              ?.remoteUrl || e.fanart;

          return {
            ...e,
            calendarTitle,
            displayTitle: e.year ? `${e.title} (${e.year})` : e.title,
            type:
              e.type ||
              (e.title.includes('S') && e.title.includes('E') ? 'tv' : 'movie'),
            tmdbId: e.tmdbId || e.series?.tmdbId || null,
            fanart,
          };
        });
        setEvents(enriched);
      } catch (err) {
        console.error('Failed to load events:', err);
      }
    };
    loadEvents();
  }, []);

  const filteredEvents = events.filter((e) =>
    filter === 'all' ? true : e.type === filter
  );

  return (
    <>
      <Head>
        <title>Calendar - Jellyseerr</title>
      </Head>
      <div className="calendar-wrapper">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin]}
          initialView={calendarView}
          locale={locale}
          firstDay={1}
          /* Default title format (Month day year) */
          titleFormat={{ month: 'long', day: 'numeric', year: 'numeric' }}
          views={{
            dayGridMonth: {
              dayHeaderFormat: { weekday: 'short' },
              // Month day year for consistency (e.g. "December 9 2025")
              titleFormat: { month: 'long', day: 'numeric', year: 'numeric' },
            },
            // Use the dayGrid week view so the left-side time gutter is not shown
            dayGridWeek: {
              // Show numeric month/day/year in week headers (MM/DD/YYYY)
              dayHeaderFormat: {
                month: '2-digit',
                day: '2-digit',
                year: 'numeric',
              },
              // Month day year for week title
              titleFormat: { month: 'long', day: 'numeric', year: 'numeric' },
            },
            dayGridDay: {
              dayHeaderFormat: {
                weekday: 'long',
                // show Month/day in header
                month: 'short',
                day: '2-digit',
              },
              titleFormat: { month: 'long', day: 'numeric', year: 'numeric' },
            },
          }}
          headerToolbar={{
            start: 'prev,today,next',
            center: 'title',
            end: 'dayGridDay,dayGridWeek,dayGridMonth customFilter',
          }}
          buttonText={{
            today: 'Today',
          }}
          customButtons={{
            customFilter: {
              text: '',
              click: () => {
                // TODO: Implement filter functionality
              },
            },
          }}
          fixedWeekCount={false}
          contentHeight="auto"
          events={filteredEvents.map((e) => ({
            title: e.calendarTitle,
            start: e.start,
            className: getEventClass(e),
            extendedProps: { ...e },
          }))}
          eventDidMount={(info) => {
            if (info.el && info.event.extendedProps.type === 'tv') {
              const title =
                info.event.extendedProps.displayTitle || info.event.title || '';
              const code = info.event.extendedProps.episodeCode || '';
              const epTitle = info.event.extendedProps.episodeTitle || '';
              const tooltipText = [title, code, epTitle]
                .filter(Boolean)
                .join('\n');
              info.el.setAttribute('title', tooltipText);
            }
          }}
          eventClick={(info) => {
            const scrollY = window.scrollY;
            info.jsEvent.preventDefault();
            info.jsEvent.stopPropagation();
            info.jsEvent.cancelBubble = true;
            info.jsEvent.stopImmediatePropagation?.();
            window.scrollTo({ top: scrollY });
            requestAnimationFrame(() => {
              window.scrollTo({ top: scrollY });
            });

            setSelectedEvent({
              fanart: info.event.extendedProps.fanart,
              title: info.event.extendedProps.title,
              displayTitle: info.event.extendedProps.displayTitle,
              start: info.event.startStr,
              status: info.event.extendedProps.status,
              description: info.event.extendedProps.description,
              episodeTitle: info.event.extendedProps.episodeTitle,
              episodeCode: info.event.extendedProps.episodeCode,
              type: info.event.extendedProps.type,
              tmdbId: info.event.extendedProps.tmdbId,
              year: info.event.extendedProps.year,
              certification: info.event.extendedProps.certification,
              runtime: info.event.extendedProps.runtime,
              genres: info.event.extendedProps.genres,
              episodes: info.event.extendedProps.episodes,
            });
            document.body.style.overflow = 'hidden';
          }}
          eventContent={(arg) => {
            const event = arg.event.extendedProps;
            const container = document.createElement('div');
            container.className = 'fc-event-custom';
            container.setAttribute('role', 'button');
            container.tabIndex = 0;

            const titleLine = document.createElement('div');
            titleLine.className = 'fc-event-title';
            const dot =
              event.type === 'tv'
                ? '<span class="media-dot tv-dot" aria-hidden="true"></span>'
                : event.type === 'movie'
                ? '<span class="media-dot movie-dot" aria-hidden="true"></span>'
                : '';
            // Prefer displayTitle then title
            titleLine.innerHTML = `${dot}<span class="fc-event-title-text">${
              event.displayTitle || event.title || arg.event.title || ''
            }</span>`;

            const subLine = document.createElement('div');
            subLine.className = 'fc-event-sub';

            // Availability and metadata
            const metaParts: string[] = [];
            let availabilityBadge = '';

            if (event.episodes && Array.isArray(event.episodes)) {
              const codes = event.episodes
                .map((e: any) => e.episodeCode)
                .filter(Boolean);
              const epText =
                codes.length === 1
                  ? codes[0]
                  : `${codes[0]}–${codes[codes.length - 1]}`;
              metaParts.push(epText);
            } else if (event.episodeCode) {
              metaParts.push(event.episodeCode);
            }

            if (event.type === 'movie') {
              const cert = event.certification || '';
              const runtime = event.runtime ? `${event.runtime}m` : '';
              if (event.availabilityType) {
                const at = (event.availabilityType || '')
                  .toString()
                  .toLowerCase();
                if (at.includes('digital'))
                  availabilityBadge =
                    '<span class="availability-badge avail-digital">Digital</span>';
                else if (
                  at.includes('cinema') ||
                  at.includes('theatre') ||
                  at.includes('theater')
                )
                  availabilityBadge =
                    '<span class="availability-badge avail-cinema">Cinema</span>';
                else if (at.includes('physical'))
                  availabilityBadge =
                    '<span class="availability-badge avail-physical">Physical</span>';
              }
              if (cert) metaParts.push(cert);
              if (runtime) metaParts.push(runtime);
            }

            // Format time for TV shows (12-hour clock, AM/PM)
            let timeText = '';
            if (event.type === 'tv' && arg.event.startStr) {
              const startDate = new Date(arg.event.startStr);
              const hrs = startDate.getHours();
              const minutes = startDate
                .getMinutes()
                .toString()
                .padStart(2, '0');
              const period = hrs >= 12 ? 'PM' : 'AM';
              const hours12 = hrs % 12 === 0 ? 12 : hrs % 12;
              timeText = `${hours12}:${minutes} ${period}`;
              metaParts.push(timeText);
            }

            // Determine download status (supports grouped episodes and single items)
            let downloadStatus = '';
            if (
              event.episodes &&
              Array.isArray(event.episodes) &&
              event.episodes.length > 0
            ) {
              downloadStatus = event.episodes[0].status || '';
            } else {
              downloadStatus = event.status || '';
            }

            let statusLabel = '';
            let statusClass = '';
            if (downloadStatus) {
              const ds = downloadStatus.toString().toLowerCase();
              if (ds === 'available') {
                statusLabel = 'Available';
                statusClass = 'available';
              } else if (ds === 'requested') {
                statusLabel = 'Requested';
                statusClass = 'requested';
              } else if (ds === 'pending') {
                statusLabel = 'Pending';
                statusClass = 'pending';
              } else if (
                ds.includes('download') ||
                ds.includes('inprogress') ||
                ds.includes('downloading')
              ) {
                statusLabel = 'Downloading';
                statusClass = 'downloading';
              } else {
                statusLabel = downloadStatus;
                statusClass = 'unknown';
              }
            }

            const statusBadge = statusLabel
              ? `<span class="download-badge download-${statusClass}">${statusLabel}</span>`
              : '';

            const metaHtml = `${metaParts.join(
              ' | '
            )} ${statusBadge} ${availabilityBadge}`;
            subLine.innerHTML = metaHtml.trim();

            // Add episode title line for TV shows
            if (event.type === 'tv' && event.episodeTitle) {
              const epTitleLine = document.createElement('div');
              epTitleLine.className = 'fc-event-episode-title';
              epTitleLine.innerHTML = event.episodeTitle;
              container.appendChild(titleLine);
              container.appendChild(subLine);
              container.appendChild(epTitleLine);
            } else {
              container.appendChild(titleLine);
              container.appendChild(subLine);
            }

            return { domNodes: [container] };
          }}
        />

        {/* ✅ LEGEND GOES HERE */}
        <div className="calendar-legend">
          <div className="legend-item">
            <span className="media-dot tv-dot"></span> TV Show
          </div>
          <div className="legend-item">
            <span className="media-dot movie-dot"></span> Movie
          </div>
          <div className="legend-item">
            <span className="download-badge download-requested">Requested</span>{' '}
            Requested
          </div>
          <div className="legend-item">
            <span className="download-badge download-pending">Pending</span>{' '}
            Pending
          </div>
          <div className="legend-item">
            <span className="download-badge download-downloading">
              Downloading
            </span>{' '}
            Downloading
          </div>
          <div className="legend-item">
            <span className="availability-badge avail-cinema">Cinema</span>{' '}
            Cinema
          </div>
          <div className="legend-item">
            <span className="availability-badge avail-digital">Digital</span>{' '}
            Digital
          </div>
          <div className="legend-item">
            <span className="availability-badge avail-physical">Physical</span>{' '}
            Physical
          </div>
        </div>

        {selectedEvent && (
          <div className="popup-overlay">
            <div className="popup-content">
              <div
                className="popup-background"
                style={{
                  backgroundImage: selectedEvent?.fanart
                    ? `url(${selectedEvent.fanart})`
                    : undefined,
                }}
              ></div>
              <div className="popup-foreground" ref={popupRef}>
                <h2 className="popup-title">
                  {selectedEvent.displayTitle || selectedEvent.title}
                </h2>

                {Array.isArray(selectedEvent.episodes) &&
                selectedEvent.episodes.length > 0 ? (
                  <>
                    <h3 className="popup-episode">
                      Season{' '}
                      {extractSeasonNumber(
                        selectedEvent.episodes[0]?.episodeCode
                      )}
                    </h3>
                    <div className="popup-episodes-list">
                      {selectedEvent.episodes.map((ep: any, idx: number) => (
                        <div key={idx} className="popup-episode">
                          Episode {extractEpisodeNumber(ep.episodeCode)}
                          {ep.episodeTitle ? ` – ${ep.episodeTitle}` : ''}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {selectedEvent.episodeCode && (
                      <h3 className="popup-episode">
                        {formatEpisodeCode(selectedEvent.episodeCode)}
                      </h3>
                    )}
                    {selectedEvent.episodeTitle && (
                      <p className="popup-description">
                        {selectedEvent.episodeTitle}
                      </p>
                    )}
                    {selectedEvent.seriesOverview && (
                      <p className="popup-description">
                        {selectedEvent.seriesOverview}
                      </p>
                    )}
                    {selectedEvent.description && (
                      <p>{selectedEvent.description}</p>
                    )}
                  </>
                )}

                {selectedEvent.type === 'movie' && (
                  <p className="popup-meta">
                    {[
                      selectedEvent.certification,
                      selectedEvent.runtime
                        ? `${selectedEvent.runtime} minutes`
                        : null,
                      selectedEvent.genres?.join(', '),
                    ]
                      .filter(Boolean)
                      .join(' | ')}
                  </p>
                )}

                <div className="popup-footer">
                  <div className="popup-status-badge">
                    {Array.isArray(selectedEvent.episodes) &&
                    selectedEvent.episodes.length > 0
                      ? (() => {
                          const statuses = selectedEvent.episodes.map(
                            (ep: any) =>
                              (ep.status || '').toString().toLowerCase()
                          );
                          const allAvailable = statuses.every(
                            (s: string) => s === 'available'
                          );
                          const anyDownloading = statuses.some(
                            (s: string) =>
                              s.includes('download') ||
                              s.includes('inprogress') ||
                              s.includes('downloading')
                          );
                          const anyPending = statuses.some(
                            (s: string) => s === 'pending'
                          );
                          const anyRequested = statuses.some(
                            (s: string) => s === 'requested'
                          );

                          if (allAvailable) {
                            return (
                              <span className="badge badge-available">
                                Available
                              </span>
                            );
                          } else if (anyDownloading) {
                            return (
                              <span className="badge badge-downloading">
                                Downloading
                              </span>
                            );
                          } else if (anyPending) {
                            return (
                              <span className="badge badge-pending">
                                Pending
                              </span>
                            );
                          } else if (anyRequested) {
                            return (
                              <span className="badge badge-requested">
                                Requested
                              </span>
                            );
                          } else {
                            return (
                              <span className="badge badge-unknown">
                                {selectedEvent.episodes[0]?.status || 'Unknown'}
                              </span>
                            );
                          }
                        })()
                      : (() => {
                          const s = (selectedEvent.status || '')
                            .toString()
                            .toLowerCase();
                          if (s === 'available')
                            return (
                              <span className="badge badge-available">
                                Available
                              </span>
                            );
                          if (
                            s.includes('download') ||
                            s.includes('inprogress') ||
                            s.includes('downloading')
                          )
                            return (
                              <span className="badge badge-downloading">
                                Downloading
                              </span>
                            );
                          if (s === 'pending')
                            return (
                              <span className="badge badge-pending">
                                Pending
                              </span>
                            );
                          if (s === 'requested')
                            return (
                              <span className="badge badge-requested">
                                Requested
                              </span>
                            );
                          return (
                            <span className="badge badge-unknown">
                              {selectedEvent.status || 'Unknown'}
                            </span>
                          );
                        })()}
                  </div>

                  <div className="popup-actions">
                    <button
                      className="popup-close-btn"
                      onClick={() => {
                        const scrollY = window.scrollY;
                        requestAnimationFrame(() => {
                          window.scrollTo({ top: scrollY });
                        });
                        setSelectedEvent(null);
                        document.body.style.overflow = '';
                      }}
                    >
                      Close
                    </button>

                    {selectedEvent.type === 'tv' && selectedEvent.tmdbId && (
                      <a
                        href={`/tv/${selectedEvent.tmdbId}`}
                        className="calendar-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Series
                      </a>
                    )}

                    {selectedEvent.type === 'movie' && selectedEvent.tmdbId && (
                      <a
                        href={`/movie/${selectedEvent.tmdbId}`}
                        className="calendar-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View Movie
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        /* Popup Layout */
        .popup-overlay {
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          width: 100vw;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10000;
        }

        .popup-content {
          position: relative;
          overflow: hidden;
          border-radius: 1rem;
          background: #1d2635;
          padding: 2rem;
          color: #fff;
          width: 90vw;
          max-width: 700px;
        }

        .popup-background {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          filter: blur(1px) brightness(0.6);
          z-index: 0;
        }
        .fc-event {
          cursor: pointer;
        }
        .event-neutral {
          color: inherit !important;
        }
        .popup-episodes-list {
          margin-bottom: 1rem;
        }

        .popup-episodes-list .popup-episode {
          font-size: 0.875rem;
          font-weight: normal;
          color: #e5e7eb;
          margin-bottom: 0.25rem;
        }

        .popup-episode {
          margin-bottom: 0.25rem;
        }
        .fc-event-title {
          font-weight: bold;
          font-size: 0.9rem;
          color: #ffffff;
        }
        .media-dot {
          display: inline-block;
          width: 0.6em;
          height: 0.6em;
          border-radius: 50%;
          margin-right: 0.4em;
          vertical-align: middle;
        }

        .tv-dot {
          background-color: #3b82f6; /* blue-500 */
        }

        .movie-dot {
          background-color: #f97316; /* orange-500 */
        }

        .fc-event-sub {
          font-size: 0.75rem;
          color: #a0aec0;
        }
        .popup-foreground {
          position: relative;
          z-index: 1;
          color: white;
        }

        .popup-title {
          font-size: 1.5rem;
          font-weight: bold;
          color: #ffffff; /* White */
          margin-bottom: 0.25rem;
        }

        .popup-episode {
          font-size: 1.1rem;
          font-weight: bold;
          margin-bottom: 0.75rem;
        }

        .popup-description {
          margin-bottom: 0.75rem;
          color: #e5e7eb; /* Light grey, same as calendar episode list */
        }

        .popup-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 1.5rem;
        }
        .calendar-legend {
          display: flex;
          gap: 1.5rem;
          margin-top: 1rem;
          font-size: 0.875rem;
          color: #e5e7eb;
          flex-wrap: wrap;
          padding-left: 0.5rem;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .popup-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .popup-close-btn {
          background-color: transparent;
          border: 1px solid #4b5563;
          color: #e5e7eb;
          padding: 6px 12px;
          border-radius: 6px;
          font-weight: 500;
          cursor: pointer;
        }

        .popup-close-btn:hover {
          background-color: #2d3748;
        }

        .popup-meta {
          font-size: 0.75rem;
          color: #a0aec0;
          margin-top: 1rem;
        }

        .popup-close {
          display: none;
        }

        .badge {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 999px;
          color: #fff;
          display: inline-block;
        }

        .badge-available {
          background-color: #22c55e;
        }

        .badge-requested {
          background-color: #6366f1;
        }

        .badge-downloading {
          background-color: #06b6d4;
        }

        .badge-pending {
          background-color: #f59e0b;
        }

        .badge-unknown {
          background-color: #9ca3af;
        }

        /* Availability badges inside events */
        .availability-badge {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          margin-left: 0.4rem;
          display: inline-block;
          vertical-align: middle;
        }
        .avail-digital {
          background: #06b6d4;
        } /* cyan */
        .avail-cinema {
          background: #f59e0b;
        } /* amber */
        .avail-physical {
          background: #8b5cf6;
        } /* violet */

        /* Download status badges used inside events */
        .download-badge {
          font-size: 0.68rem;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          margin-left: 0.4rem;
          display: inline-block;
          vertical-align: middle;
          color: #fff;
        }
        .download-available {
          background: #22c55e;
        } /* green */
        .download-requested {
          background: #6366f1;
        } /* indigo */
        .download-pending {
          background: #f59e0b;
        } /* amber */
        .download-downloading {
          background: #06b6d4;
        } /* cyan */
        .download-unknown {
          background: #9ca3af;
        } /* gray */

        /* Event layout tweaks */
        .fc-event-custom {
          white-space: normal;
          line-height: 1.1;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          align-items: flex-start;
        }
        .fc-event-title {
          font-weight: 700;
          font-size: 1.1rem;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .fc-event-title-text {
          vertical-align: middle;
        }
        .fc-event-sub {
          font-size: 0.9rem;
          color: #cbd5e1;
          display: flex;
          gap: 0.4rem;
          align-items: center;
        }
        .fc-event-episode-title {
          font-size: 0.85rem;
          color: #a0aec0;
          font-style: italic;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
        }
        .tick-icon {
          margin-left: 0.25rem;
        }

        /* Popup readability */
        .popup-content {
          max-height: 80vh;
          overflow: auto;
          background: linear-gradient(
            180deg,
            rgba(17, 24, 39, 0.9),
            rgba(17, 24, 39, 0.95)
          );
          padding: 1.25rem;
        }
        .popup-background {
          filter: blur(2px) brightness(0.5);
        }
        .popup-foreground {
          background: transparent;
        }

        /* Legend badges alignment */
        .calendar-legend .legend-item {
          gap: 0.6rem;
        }

        .calendar-link {
          display: inline-block;
          background-color: #3949ab;
          color: white;
          padding: 6px 12px;
          border-radius: 6px;
          text-decoration: none;
        }

        .calendar-link:hover {
          background-color: #5c6bc0;
        }

        /* Calendar Layout */
        .calendar-wrapper {
          width: 100%;
          max-width: 100%;
          margin: 0;
          padding: 1rem;
          border-radius: 1rem;
          background-color: #151e2c;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        }

        .calendar-filter {
          padding: 4px 8px;
          border-radius: 6px;
          background-color: #1d2635;
          color: white;
          border: 1px solid #374151;
          font-size: 0.875rem;
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
        }

        .fc {
          background-color: #1d2635;
          border-radius: 1rem;
          padding: 1rem;
          width: 100% !important;
        }

        .fc .fc-scrollgrid {
          width: 100% !important;
        }

        .fc-daygrid-event {
          border-radius: 0.5rem;
          padding: 2px 4px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .fc-daygrid-event-dot {
          display: none !important;
        }

        .event-available {
          color: #81c784 !important;
        }

        .event-pending {
          color: #ffb74d !important;
        }

        .event-expired {
          color: #e57373 !important;
        }

        .fc-toolbar-title {
          color: #ffffff;
        }

        .fc-button {
          background-color: #1d2635;
          border: 1px solid #374151;
          color: #e5e7eb;
          font-weight: 500;
          border-radius: 0.3rem;
        }

        .fc-button:hover {
          background-color: #374151;
          color: #ffffff;
        }

        .fc-col-header-cell {
          color: #ccc;
        }

        .fc-daygrid-day-number {
          color: #fff;
          font-weight: bold;
        }

        /* Highlight today's cell with a subtle lighter shade and rounded badge */
        .fc-day-today {
          background-color: rgba(255, 255, 255, 0.03) !important;
          border-radius: 0.5rem;
        }

        .fc-day-today .fc-daygrid-day-number {
          background-color: #5c6bc0; /* lighter accent than before */
          padding: 5px 7px;
          border-radius: 8px;
          color: #fff !important;
        }

        .fc-dayGridDay-view .fc-col-header {
          display: none !important;
        }

        .fc-timegrid-slot-label,
        .fc-timegrid-axis {
          display: none !important;
        }

        .fc .fc-toolbar .fc-button.fc-customFilter-button {
          background-color: transparent;
          border: none;
          box-shadow: none;
          padding: 0;
        }

        /* Mobile Styles */
        @media (max-width: 768px) {
          .fc-header-toolbar {
            flex-direction: column;
            align-items: stretch;
            gap: 0.5rem;
          }

          .fc-header-toolbar .fc-toolbar-chunk {
            width: 100%;
            justify-content: center;
            display: flex;
            flex-wrap: wrap;
          }

          .calendar-filter {
            margin-left: 0;
            margin-top: 0.5rem;
          }

          .fc-button[title='month view'],
          .fc-button[title='week view'] {
            display: none !important;
          }

          .fc-button[title='day view'] {
            font-size: 0;
          }

          .fc-button[title='day view']::after {
            content: '•';
            font-size: 0.5rem;
            color: #1d2635;
          }
          .fc-event-custom {
            white-space: normal;
            line-height: 1.2;
          }

          .fc-event-title {
            font-weight: bold;
            font-size: 0.9rem;
            color: #fff;
          }

          .fc-event-sub {
            font-size: 0.75rem;
            color: #bbb;
          }
        }
      `}</style>
    </>
  );
}
