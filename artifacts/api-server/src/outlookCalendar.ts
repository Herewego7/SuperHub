import axios from 'axios';
import { outlookInstancesToDelete } from "./lib/recurrenceRule";
import { outlookToInbound, type InboundMessage } from "./ingest/parse";

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// A hanging Graph call previously blocked its request indefinitely (axios's
// default timeout is 0 = never) — the iCal fetcher already had a 15s abort
// for the exact same reason; this brings Outlook's HTTP client to parity.
const graph = axios.create({ timeout: 15_000 });

interface OutlookCalendar {
  id: string;
  name: string;
  color: string;
  canEdit: boolean;
  isDefaultCalendar: boolean;
  owner: {
    name: string;
    address: string;
  };
}

interface OutlookEvent {
  id: string;
  subject: string;
  body?: {
    content: string;
    contentType: string;
  };
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName: string;
  };
  isAllDay: boolean;
  calendar?: {
    id: string;
    name: string;
    color: string;
  };
}

export class OutlookCalendarService {
  async getAvailableCalendars(accessToken: string): Promise<OutlookCalendar[]> {
    try {
      const response = await graph.get(`${GRAPH_API_BASE}/me/calendars`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const calendars = response.data.value || [];
      console.log(`Found ${calendars.length} Outlook calendars for user`);

      return calendars.map((calendar: any) => ({
        id: calendar.id,
        name: calendar.name,
        color: calendar.color || '#0078d4', // Default Outlook blue
        canEdit: calendar.canEdit || false,
        isDefaultCalendar: calendar.isDefaultCalendar || false,
        owner: {
          name: calendar.owner?.name || 'Unknown',
          address: calendar.owner?.address || ''
        }
      }));
    } catch (error) {
      console.error('Error fetching Outlook calendars:', error);
      throw error;
    }
  }

  // selectedCalendarIds: null/undefined = sync all calendars (default,
  // backward-compatible with connections made before per-calendar selection
  // existed). An explicit array — including an empty one — restricts fetching
  // to exactly those calendar IDs.
  async getCalendarEvents(
    accessToken: string,
    selectedCalendarIds?: string[] | null,
  ): Promise<OutlookEvent[]> {
    try {
      // Get list of all calendars first
      const allCalendars = await this.getAvailableCalendars(accessToken);
      const calendars = selectedCalendarIds
        ? allCalendars.filter((c) => selectedCalendarIds.includes(c.id))
        : allCalendars;

      const allEvents: OutlookEvent[] = [];
      const windowStart = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const windowEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      let failedCount = 0;

      for (const calendar of calendars) {
        try {
          // `/events` (the old endpoint here) returns recurring series as a
          // single MASTER row at its original start time — every occurrence
          // collapses onto one date, and a series whose master started more
          // than a year ago falls outside the $filter window and disappears
          // entirely, even though it's still recurring today. `/calendarView`
          // is Graph's dedicated "expand occurrences within this window"
          // endpoint (same idea as Google's singleEvents:true) and takes
          // startDateTime/endDateTime instead of a $filter.
          let url: string | null =
            `${GRAPH_API_BASE}/me/calendars/${calendar.id}/calendarView` +
            `?startDateTime=${encodeURIComponent(windowStart)}&endDateTime=${encodeURIComponent(windowEnd)}` +
            `&$top=250&$orderby=start/dateTime`;
          let pages = 0;
          // Expanding recurring series multiplies the event count versus the
          // old single-page fetch, so unpaginated truncation is now far more
          // likely — follow @odata.nextLink rather than reading only page 1.
          while (url && pages < 20) {
            const response: any = await graph.get(url, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                // calendarView requires this header when the account/mailbox
                // observes a non-UTC preference; harmless otherwise.
                'Prefer': 'outlook.timezone="UTC"',
              },
            });

            const calendarEvents = response.data.value || [];
            calendarEvents.forEach((event: any) => {
              event.calendar = { id: calendar.id, name: calendar.name, color: calendar.color };
            });
            allEvents.push(...calendarEvents);

            url = response.data['@odata.nextLink'] || null;
            pages += 1;
          }
          console.log(`Fetched events from Outlook calendar: ${calendar.name} (${pages} page(s))`);
        } catch (calError) {
          failedCount++;
          // Elevated from warn to error: this used to be easy to lose in
          // routine log noise, with nothing downstream ever surfacing it.
          console.error(`Failed to fetch events from Outlook calendar ${calendar.name}:`, calError);
          // Continue with other calendars even if one fails — a single
          // broken calendar shouldn't blank the ones that are still working.
        }
      }

      // If EVERY calendar failed, resilience has nothing left to protect —
      // silently returning an empty array here is indistinguishable from a
      // real empty account. Throwing surfaces it through the exact same path
      // a total connection failure already does (the route's catch → 500 →
      // the frontend's existing outlookSyncError banner), no new UI needed.
      if (calendars.length > 0 && failedCount === calendars.length) {
        throw new Error(`All ${calendars.length} Outlook calendar(s) failed to load`);
      }

      console.log(`Total events fetched from all Outlook calendars: ${allEvents.length}${failedCount > 0 ? ` (${failedCount} calendar(s) failed)` : ""}`);
      return allEvents;
    } catch (error) {
      console.error('Error fetching Outlook calendar events:', error);
      throw error;
    }
  }

  async getUserProfile(accessToken: string) {
    try {
      const response = await graph.get(`${GRAPH_API_BASE}/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching Outlook user profile:', error);
      throw error;
    }
  }

  async listInbox(accessToken: string, accountId: string): Promise<InboundMessage[]> {
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const response = await graph.get(`${GRAPH_API_BASE}/me/mailFolders/inbox/messages`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        $top: 20,
        $select: "subject,from,bodyPreview,body,receivedDateTime",
        $orderby: "receivedDateTime desc",
      },
    });
    const rows = Array.isArray(response.data?.value) ? response.data.value : [];
    return rows
      .filter((row: { receivedDateTime?: string }) => !row.receivedDateTime || row.receivedDateTime >= since)
      .map((row: { subject?: string | null; bodyPreview?: string | null; body?: { content?: string | null; contentType?: string | null } | null; from?: { emailAddress?: { address?: string | null } | null } | null }) =>
        outlookToInbound(row, accountId),
      );
  }

  // Generate OAuth URL for Microsoft Graph.
  // Calendars.ReadWrite (write access) + offline_access (refresh tokens) are
  // required for two-way sync. Adding these forces existing users to re-consent.
  generateAuthUrl(clientId: string, redirectUri: string, state?: string, scopes: string[] = ['https://graph.microsoft.com/Calendars.ReadWrite', 'https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/User.Read', 'offline_access']): string {
    const baseUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      response_mode: 'query'
    });
    if (state) params.set('state', state);

    return `${baseUrl}?${params.toString()}`;
  }

  // Exchange a refresh token for a fresh access token. Outlook access tokens
  // expire (~1h); writes must refresh first when the stored token is stale.
  async refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string, scope = 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access') {
    try {
      const response = await graph.post('https://login.microsoftonline.com/common/oauth2/v2.0/token',
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return response.data; // { access_token, refresh_token?, expires_in, ... }
    } catch (error) {
      console.error('Error refreshing Outlook token:', error);
      throw error;
    }
  }

  private toGraphDateTime(d: Date, isAllDay: boolean, isEnd: boolean): { dateTime: string; timeZone: string } {
    if (isAllDay) {
      const day = new Date(d);
      // Graph all-day events are midnight-to-midnight with an EXCLUSIVE end.
      if (isEnd) day.setDate(day.getDate() + 1);
      day.setUTCHours(0, 0, 0, 0);
      return { dateTime: day.toISOString().split('.')[0], timeZone: 'UTC' };
    }
    return { dateTime: new Date(d).toISOString().split('.')[0], timeZone: 'UTC' };
  }

  // Create an event on the user's default calendar (/me/events). Returns the
  // created Graph event (its `id` is stored for later edit/delete + dedup).
  // calendarId: omit (or pass undefined) to create on the account's default
  // calendar (POST /me/events); pass a specific calendar's id to create it
  // there instead (POST /me/calendars/{id}/events).
  async createEvent(
    accessToken: string,
    eventData: {
      title: string;
      description?: string | null;
      location?: string | null;
      start: Date;
      end: Date;
      isAllDay?: boolean;
      /** Microsoft Graph PatternedRecurrence — see lib/recurrenceRule.ts.
       *  Omitted for a one-off event. */
      recurrence?: { pattern: Record<string, unknown>; range: Record<string, unknown> };
    },
    calendarId?: string,
  ): Promise<{ id: string }> {
    try {
      const body: any = {
        subject: eventData.title,
        body: { contentType: 'text', content: eventData.description ?? '' },
        start: this.toGraphDateTime(eventData.start, !!eventData.isAllDay, false),
        end: this.toGraphDateTime(eventData.end, !!eventData.isAllDay, true),
        isAllDay: !!eventData.isAllDay,
      };
      if (eventData.location) body.location = { displayName: eventData.location };
      // A local series is one row expanded on read, so this copy is the whole
      // series — the pattern is what makes Outlook show it as one.
      if (eventData.recurrence) body.recurrence = eventData.recurrence;

      const url = calendarId
        ? `${GRAPH_API_BASE}/me/calendars/${calendarId}/events`
        : `${GRAPH_API_BASE}/me/events`;
      const response = await graph.post(url, body, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      return { id: response.data.id };
    } catch (error) {
      console.error('Error creating Outlook event:', error);
      throw error;
    }
  }

  /**
   * Remove specific occurrences from a synced series.
   *
   * Microsoft Graph has no EXDATE: a `PatternedRecurrence` describes an
   * unbroken series, and the only way to punch a hole in it is to fetch the
   * expanded instances and delete the ones you don't want. Without this, an
   * occurrence detached in Family Hub ("this event only") appears TWICE on the
   * connected Outlook calendar — once in the series, once as the moved copy.
   *
   * Best-effort per instance: one failure must not abandon the rest, and none
   * of them should fail the edit that triggered this.
   */
  async deleteOccurrences(accessToken: string, seriesEventId: string, instants: Date[]): Promise<number> {
    if (instants.length === 0) return 0;
    const sorted = [...instants].sort((a, b) => a.getTime() - b.getTime());
    // Graph requires an explicit window. Pad it by a day at each end so an
    // instance whose local time sits near a boundary is still inside it.
    const from = new Date(sorted[0]!.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(sorted[sorted.length - 1]!.getTime() + 24 * 60 * 60 * 1000);
    let removed = 0;
    try {
      const url = `${GRAPH_API_BASE}/me/events/${seriesEventId}/instances` +
        `?startDateTime=${from.toISOString().split('.')[0]}` +
        `&endDateTime=${to.toISOString().split('.')[0]}&$top=200`;
      const response = await graph.get(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      const instances: any[] = response.data?.value ?? [];
      for (const id of outlookInstancesToDelete(instances, sorted)) {
        try {
          await graph.delete(`${GRAPH_API_BASE}/me/events/${id}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });
          removed += 1;
        } catch (err) {
          console.warn(`deleteOccurrences: could not remove instance ${id}:`, err);
        }
      }
    } catch (error) {
      console.error('Error listing Outlook series instances:', error);
      throw error;
    }
    return removed;
  }

  async updateEvent(accessToken: string, eventId: string, eventData: {
    title?: string;
    description?: string | null;
    location?: string | null;
    start?: Date;
    end?: Date;
    isAllDay?: boolean;
    /** Graph PatternedRecurrence, or null to stop it repeating. Undefined
     *  means "don't touch it". */
    recurrence?: { pattern: Record<string, unknown>; range: Record<string, unknown> } | null;
  }): Promise<void> {
    try {
      const body: any = {};
      if (eventData.title !== undefined) body.subject = eventData.title;
      if (eventData.description !== undefined) body.body = { contentType: 'text', content: eventData.description ?? '' };
      if (eventData.location !== undefined) body.location = { displayName: eventData.location ?? '' };
      if (eventData.start && eventData.end) {
        body.isAllDay = !!eventData.isAllDay;
        body.start = this.toGraphDateTime(eventData.start, !!eventData.isAllDay, false);
        body.end = this.toGraphDateTime(eventData.end, !!eventData.isAllDay, true);
      }
      if (eventData.recurrence !== undefined) body.recurrence = eventData.recurrence;
      await graph.patch(`${GRAPH_API_BASE}/me/events/${eventId}`, body, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error updating Outlook event:', error);
      throw error;
    }
  }

  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    try {
      await graph.delete(`${GRAPH_API_BASE}/me/events/${eventId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
    } catch (error) {
      console.error('Error deleting Outlook event:', error);
      throw error;
    }
  }

  // Exchange authorization code for access token
  async exchangeCodeForTokens(clientId: string, clientSecret: string, redirectUri: string, code: string) {
    try {
      const response = await graph.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', 
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw error;
    }
  }
}

// Create singleton instance
export const outlookCalendarService = new OutlookCalendarService();