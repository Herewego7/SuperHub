import { google, calendar_v3 } from 'googleapis';
import { toInbound, type InboundMessage } from './ingest/parse';
import { inboxTokenExpiry } from './ingest/process';

// Calendar plus read-only mail. No userinfo.email/userinfo.profile. Those
// identity scopes are what makes Google's consent screen read as
// "<App> wants to use <Google Account> to sign in", even though this flow
// only connects an already-authenticated profile and never establishes an
// app session. The connected account's email is read off the primary
// calendar itself (see getUserEmail below) instead.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export class GoogleCalendarService {
  private getRedirectUri(requestHost?: string): string {
    // If request host is provided, use it directly (for dynamic redirect based on request origin)
    if (requestHost) {
      const protocol = requestHost.includes('localhost') ? 'http' : 'https';
      return `${protocol}://${requestHost}/api/auth/google/callback`;
    }
    
    // Fallback: use environment variables
    if (process.env.REPLIT_DEV_DOMAIN) {
      return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/google/callback`;
    } else if (process.env.REPLIT_DOMAINS) {
      const domains = process.env.REPLIT_DOMAINS.split(',');
      return `https://${domains[0]}/api/auth/google/callback`;
    }
    return 'http://localhost:5000/api/auth/google/callback';
  }

  private createOAuth2Client(requestHost?: string) {
    const redirectUri = this.getRedirectUri(requestHost);
    console.log('Creating OAuth2 client with redirect URI:', redirectUri);
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  }

  getAuthUrl(state?: string, requestHost?: string): string {
    const oauth2Client = this.createOAuth2Client(requestHost);
    const authUrlParams: any = {
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent select_account',
      include_granted_scopes: true
    };
    
    if (state) {
      authUrlParams.state = state;
    }
    
    return oauth2Client.generateAuthUrl(authUrlParams);
  }

  async exchangeCodeForTokens(code: string, requestHost?: string) {
    try {
      const oauth2Client = this.createOAuth2Client(requestHost);
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens) {
        throw new Error('Failed to get tokens from Google');
      }
      return tokens;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw error;
    }
  }

  async getUserEmail(accessToken: string): Promise<string | null> {
    try {
      // No userinfo scope is requested (see SCOPES above), so the account's
      // email is read from the primary calendar's own id instead — for the
      // "primary" calendar, Google's Calendar API always returns the
      // connected account's email address as its id.
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      oauth2Client.setCredentials({ access_token: accessToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const { data } = await calendar.calendarList.get({ calendarId: 'primary' });
      return data.id ?? null;
    } catch (error) {
      console.warn('Failed to get user email from Google:', error);
      return null;
    }
  }

  async revokeToken(accessToken: string): Promise<void> {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      
      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      await oauth2Client.revokeCredentials();
      console.log('Successfully revoked Google Calendar token');
    } catch (error) {
      // Ignore errors when revoking (token might already be invalid)
      console.warn('Failed to revoke token (may already be invalid):', error);
    }
  }

  // selectedCalendarIds: null/undefined = sync all calendars (default,
  // backward-compatible with connections made before per-calendar selection
  // existed). An explicit array — including an empty one — restricts fetching
  // to exactly those calendar IDs.
  async getCalendarEvents(
    accessToken: string,
    refreshToken?: string,
    selectedCalendarIds?: string[] | null,
  ): Promise<calendar_v3.Schema$Event[]> {
    try {
      // Set up OAuth2 client properly
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );

      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // First, get list of all calendars
      const calendarListResponse = await calendar.calendarList.list();
      const calendars = calendarListResponse.data.items || [];

      console.log(`Found ${calendars.length} calendars for user`);

      // Fetch events from all calendars
      const allEvents: calendar_v3.Schema$Event[] = [];

      for (const cal of calendars) {
        try {
          // Skip calendars that are hidden or don't have read access. Hidden
          // calendars are intentionally unchecked by the user in Google Calendar
          // and aren't shown in our Settings picker either, so fetching their
          // events would surface uncontrollable, un-toggleable entries.
          if (cal.hidden || cal.accessRole === 'none') {
            continue;
          }
          // User's explicit calendar selection (Settings), if they've made one.
          if (selectedCalendarIds && !selectedCalendarIds.includes(cal.id!)) {
            continue;
          }
          
          // Get events from 1 year back through 1 year out
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          oneYearAgo.setHours(0, 0, 0, 0);
          const oneYearOut = new Date();
          oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);

          // Paginate through ALL events in the window. A single page caps at
          // maxResults; busy calendars (e.g. imported feeds) can exceed it, and
          // orderBy:startTime would then return only the OLDEST events, silently
          // dropping current/future ones. Loop on nextPageToken to get them all.
          const calendarEvents: calendar_v3.Schema$Event[] = [];
          let pageToken: string | undefined = undefined;
          const MAX_PAGES = 20; // safety cap: 20 * 2500 = 50k events per calendar
          for (let page = 0; page < MAX_PAGES; page++) {
            const eventsResponse: any = await calendar.events.list({
              calendarId: cal.id!,
              timeMin: oneYearAgo.toISOString(),
              timeMax: oneYearOut.toISOString(),
              maxResults: 2500,
              singleEvents: true,
              orderBy: 'startTime',
              pageToken,
            });
            calendarEvents.push(...(eventsResponse.data.items || []));
            pageToken = eventsResponse.data.nextPageToken || undefined;
            if (!pageToken) break;
          }
          console.log(`Fetched ${calendarEvents.length} events from calendar: ${cal.summary}`);
          
          // Add calendar name/color info to events for better identification
          calendarEvents.forEach(event => {
            if (!event.extendedProperties) {
              event.extendedProperties = {};
            }
            if (!event.extendedProperties.private) {
              event.extendedProperties.private = {};
            }
            event.extendedProperties.private!['calendar_name'] = cal.summary || 'Unknown Calendar';
            event.extendedProperties.private!['calendar_color'] = cal.backgroundColor || cal.colorId || '#1976D2';
            event.extendedProperties.private!['google_calendar_id'] = cal.id!; // Store the Google Calendar ID
            
            // Extract profile IDs if they exist
            if (event.extendedProperties.private!['familyhub_profile_ids']) {
              try {
                event.extendedProperties.private!['familyhub_profile_ids'] = event.extendedProperties.private!['familyhub_profile_ids'];
              } catch (e) {
                // Invalid JSON, ignore
              }
            }
          });
          
          allEvents.push(...calendarEvents);
        } catch (calError) {
          console.warn(`Failed to fetch events from calendar ${cal.summary}:`, calError);
          // Continue with other calendars even if one fails
        }
      }
      
      console.log(`Total events fetched from all calendars: ${allEvents.length}`);
      return allEvents;
      
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      throw error;
    }
  }

  async getAvailableCalendars(accessToken: string, refreshToken?: string) {
    try {
      // Set up OAuth2 client properly
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      
      // Get list of all calendars
      const calendarListResponse = await calendar.calendarList.list();
      const calendars = calendarListResponse.data.items || [];
      
      console.log(`Found ${calendars.length} calendars for user`);
      
      // Filter out hidden calendars and format the data
      const availableCalendars = calendars
        .filter(cal => !cal.hidden && cal.accessRole !== 'none')
        .map(cal => ({
          id: cal.id!,
          name: cal.summary || 'Unnamed Calendar',
          color: cal.backgroundColor || cal.colorId || '#1976D2',
          accessRole: cal.accessRole,
          primary: cal.primary || false
        }));
      
      return availableCalendars;
    } catch (error) {
      console.error('Error fetching available calendars:', error);
      throw error;
    }
  }

  async listInbox(accessToken: string, refreshToken: string | undefined, accountId: string, tokenExpiry?: Date | string | null): Promise<InboundMessage[]> {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: inboxTokenExpiry(tokenExpiry, !!refreshToken),
    });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const listed = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:2d in:inbox",
      maxResults: 20,
    });
    const out: InboundMessage[] = [];
    for (const item of listed.data.messages ?? []) {
      if (!item.id) continue;
      const full = await gmail.users.messages.get({
        userId: "me",
        id: item.id,
        format: "full",
      });
      out.push(toInbound({
        id: item.id,
        snippet: full.data.snippet ?? undefined,
        payload: {
          mimeType: full.data.payload?.mimeType ?? "text/plain",
          headers: (full.data.payload?.headers ?? []).flatMap((header) =>
            header.name && header.value ? [{ name: header.name, value: header.value }] : [],
          ),
        },
      }, accountId));
    }
    return out;
  }

  async getUserProfile(accessToken: string) {
    try {
      // Set up OAuth2 client properly  
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      
      oauth2Client.setCredentials({
        access_token: accessToken
      });

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const response = await oauth2.userinfo.get();
      return response.data;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }
  }

  /**
   * Create a new event on a Google calendar. Used by two-way sync to mirror an
   * app-created event onto each assigned profile's calendar. Pass calendarId
   * "primary" to target the account's primary calendar.
   *
   * The event is tagged with private extended properties so that when it is
   * later pulled back during a read, the server can recognise it as
   * app-originated and suppress it (preventing a duplicate alongside the local
   * DB row). `familyhub_local_id` links the Google copy to the local event.
   */
  async createEvent(
    accessToken: string,
    refreshToken: string | undefined,
    calendarId: string,
    eventData: {
      title: string;
      description?: string | null;
      location?: string | null;
      start: Date;
      end: Date;
      isAllDay?: boolean;
      profileIds?: string[];
      localEventId: string;
      /** iCalendar RRULE/EXDATE lines — see lib/recurrenceRule.ts. Omitted
       *  for a one-off event, which is what Google treats as no recurrence. */
      recurrence?: string[];
      /** IANA zone. Google REQUIRES start.timeZone/end.timeZone on a
       *  recurring event and rejects the insert without them. */
      timeZone?: string;
    }
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );

      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const requestBody: calendar_v3.Schema$Event = {
        summary: eventData.title,
        description: eventData.description ?? undefined,
        location: eventData.location ?? undefined,
        extendedProperties: {
          private: {
            familyhub_origin: 'app',
            familyhub_local_id: eventData.localEventId,
            familyhub_profile_ids: JSON.stringify(eventData.profileIds ?? []),
          },
        },
      };

      // A local series is one row expanded on read, so THIS copy is the whole
      // series — the rule is what makes Google show it as one.
      if (eventData.recurrence?.length) requestBody.recurrence = eventData.recurrence;

      if (eventData.isAllDay) {
        // Google all-day events use an EXCLUSIVE end date, so add one day.
        const startDate = new Date(eventData.start);
        const endDate = new Date(eventData.end);
        endDate.setDate(endDate.getDate() + 1);
        requestBody.start = { date: startDate.toISOString().split('T')[0] };
        requestBody.end = { date: endDate.toISOString().split('T')[0] };
      } else {
        // ⚠️ timeZone is REQUIRED for a recurring event — Google rejects the
        // insert without it, which is why a series created in Family Hub never
        // appeared on the connected calendar while one-off events did
        // (reported 2026-09-12). Harmless on a non-recurring event, so it is
        // always sent rather than conditionally.
        requestBody.start = { dateTime: new Date(eventData.start).toISOString(), timeZone: eventData.timeZone };
        requestBody.end = { dateTime: new Date(eventData.end).toISOString(), timeZone: eventData.timeZone };
      }

      const response = await calendar.events.insert({
        calendarId,
        requestBody,
      });

      console.log(`Created event ${response.data.id} in calendar ${calendarId}`);
      return response.data;
    } catch (error) {
      console.error('Error creating Google Calendar event:', error);
      throw error;
    }
  }

  async updateEvent(
    accessToken: string,
    refreshToken: string | undefined,
    calendarId: string,
    eventId: string,
    eventData: {
      title?: string;
      description?: string;
      location?: string;
      start?: Date;
      end?: Date;
      isAllDay?: boolean;
      profileIds?: string[];
      /** Present only when Family Hub owns this series (see
       *  lib/recurrenceRule.ts). An empty array clears the rule, turning the
       *  copy back into a one-off; undefined means "don't touch it", which is
       *  what a Google-originated event gets. */
      recurrence?: string[];
      /** See createEvent — required on a recurring event. */
      timeZone?: string;
    }
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const existingEvent = await calendar.events.get({
        calendarId: calendarId,
        eventId: eventId,
      });

      const updatedEvent: calendar_v3.Schema$Event = {
        ...existingEvent.data,
      };

      // Check if this is a recurring event
      const isRecurringEvent = !!(existingEvent.data.recurrence || existingEvent.data.recurringEventId);
      // ...but one WE own is different. The date guard below exists so that
      // editing a Google-originated series doesn't drag its anchor around;
      // for a Family Hub series the anchor and the rule are exactly what the
      // app is authoritative about, and passing `recurrence` is how the caller
      // says so. Without this, a rescheduled local series silently kept its
      // old time on every connected calendar.
      const ownedSeries = eventData.recurrence !== undefined;

      if (eventData.title !== undefined) {
        updatedEvent.summary = eventData.title;
      }
      if (eventData.description !== undefined) {
        updatedEvent.description = eventData.description;
      }
      if (eventData.location !== undefined) {
        updatedEvent.location = eventData.location;
      }
      
      // Only update dates if this is NOT a recurring event
      // For recurring events, we preserve the original dates and recurrence rules
      if (eventData.start && eventData.end && (!isRecurringEvent || ownedSeries)) {
        if (eventData.isAllDay) {
          const startDate = new Date(eventData.start);
          const endDate = new Date(eventData.end);
          endDate.setDate(endDate.getDate() + 1);
          updatedEvent.start = { date: startDate.toISOString().split('T')[0] };
          updatedEvent.end = { date: endDate.toISOString().split('T')[0] };
        } else {
          updatedEvent.start = { dateTime: eventData.start.toISOString(), timeZone: eventData.timeZone };
          updatedEvent.end = { dateTime: eventData.end.toISOString(), timeZone: eventData.timeZone };
        }
      }

      if (ownedSeries) {
        // An empty array means "no longer repeats" — Google wants the field
        // absent for that, not an empty list.
        if (eventData.recurrence!.length > 0) updatedEvent.recurrence = eventData.recurrence;
        else delete updatedEvent.recurrence;
      }

      if (eventData.profileIds !== undefined) {
        if (!updatedEvent.extendedProperties) {
          updatedEvent.extendedProperties = {};
        }
        if (!updatedEvent.extendedProperties.private) {
          updatedEvent.extendedProperties.private = {};
        }
        updatedEvent.extendedProperties.private['familyhub_profile_ids'] = JSON.stringify(eventData.profileIds);
      }

      const response = await calendar.events.update({
        calendarId: calendarId,
        eventId: eventId,
        requestBody: updatedEvent,
      });

      console.log(`Updated event ${eventId} in calendar ${calendarId}`);
      return response.data;
    } catch (error) {
      console.error('Error updating Google Calendar event:', error);
      throw error;
    }
  }

  async deleteEvent(
    accessToken: string,
    refreshToken: string | undefined,
    calendarId: string,
    eventId: string
  ): Promise<void> {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      await calendar.events.delete({
        calendarId: calendarId,
        eventId: eventId,
      });

      console.log(`Deleted event ${eventId} from calendar ${calendarId}`);
    } catch (error: any) {
      // A 404/410 means the event is already gone from Google's side (a
      // double-tap, a stale client cache, or someone deleted it from the
      // native Calendar app first) — that's the outcome the caller wanted,
      // not a real failure, so treat it as success instead of surfacing a
      // "Failed to delete" toast for something that's already done.
      const status = error?.code ?? error?.response?.status;
      if (status === 404 || status === 410) {
        console.log(`Event ${eventId} already gone from calendar ${calendarId} (${status}) — treating as deleted`);
        return;
      }
      console.error('Error deleting Google Calendar event:', error?.response?.data ?? error);
      throw error;
    }
  }
}