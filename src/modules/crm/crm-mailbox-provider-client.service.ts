import { Injectable } from "@nestjs/common";

const GMAIL_MESSAGES_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GRAPH_MESSAGES_ENDPOINT = "https://graph.microsoft.com/v1.0/me/messages";
const GRAPH_EVENTS_ENDPOINT =
  "https://graph.microsoft.com/v1.0/me/calendarview";

/**
 * L08 — extracted from CrmMailboxService (was 808 lines). This is the ONE
 * responsibility that genuinely stands alone: raw Gmail/Microsoft Graph REST
 * calls given a bearer token. It knows nothing about tenants, CRM matching,
 * OAuth token issuance/refresh, or Prisma — CrmMailboxService owns all of
 * that and calls this client with an already-valid access token. A change
 * to Gmail's or Graph's response shape only ever touches this file.
 */
@Injectable()
export class CrmMailboxProviderClientService {
  async fetchGmailMessages(accessToken: string, since: Date) {
    const query = `after:${Math.floor(since.getTime() / 1000)}`;
    const listRes = await fetch(
      `${GMAIL_MESSAGES_ENDPOINT}?q=${encodeURIComponent(query)}&maxResults=25`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);
    const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
    const results: Array<{
      messageId: string;
      from: string;
      to: string[];
      subject: string;
      body: string;
      date: string;
    }> = [];

    for (const m of (list.messages || []).slice(0, 25)) {
      const msgRes = await fetch(
        `${GMAIL_MESSAGES_ENDPOINT}/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as {
        internalDate?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const headers = msg.payload?.headers || [];
      const get = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
          ?.value || "";
      results.push({
        messageId: m.id,
        from: this.extractEmail(get("From")),
        to: get("To")
          .split(",")
          .map((s) => this.extractEmail(s))
          .filter(Boolean),
        subject: get("Subject") || "(no subject)",
        body: "",
        date: msg.internalDate
          ? new Date(Number(msg.internalDate)).toISOString()
          : new Date().toISOString(),
      });
    }
    return results;
  }

  async fetchOutlookMessages(accessToken: string, since: Date) {
    const filter = `receivedDateTime ge ${since.toISOString()}`;
    const res = await fetch(
      `${GRAPH_MESSAGES_ENDPOINT}?$filter=${encodeURIComponent(filter)}&$top=25&$select=subject,from,toRecipients,bodyPreview,receivedDateTime`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) throw new Error(`Graph messages failed: ${res.status}`);
    const data = (await res.json()) as {
      value?: Array<{
        id: string;
        subject?: string;
        from?: { emailAddress?: { address?: string } };
        toRecipients?: Array<{ emailAddress?: { address?: string } }>;
        bodyPreview?: string;
        receivedDateTime?: string;
      }>;
    };
    return (data.value || []).map((m) => ({
      messageId: m.id,
      from: m.from?.emailAddress?.address || "",
      to: (m.toRecipients || [])
        .map((r) => r.emailAddress?.address || "")
        .filter(Boolean),
      subject: m.subject || "(no subject)",
      body: m.bodyPreview || "",
      date: m.receivedDateTime || new Date().toISOString(),
    }));
  }

  async fetchGoogleCalendarEvents(accessToken: string, since: Date) {
    const timeMin = since.toISOString();
    const timeMax = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=25`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new Error(`Google Calendar failed: ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        attendees?: Array<{ email?: string }>;
      }>;
    };
    return (data.items || []).map((e) => ({
      id: e.id,
      subject: e.summary || "(no title)",
      description: e.description,
      start: e.start?.dateTime || e.start?.date || new Date().toISOString(),
      end: e.end?.dateTime || e.end?.date || new Date().toISOString(),
      attendees: (e.attendees || []).map((a) => a.email || "").filter(Boolean),
    }));
  }

  async fetchOutlookCalendarEvents(accessToken: string, since: Date) {
    const startDateTime = since.toISOString();
    const endDateTime = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await fetch(
      `${GRAPH_EVENTS_ENDPOINT}?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&$top=25`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new Error(`Graph calendar failed: ${res.status}`);
    const data = (await res.json()) as {
      value?: Array<{
        id: string;
        subject?: string;
        bodyPreview?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        attendees?: Array<{ emailAddress?: { address?: string } }>;
      }>;
    };
    return (data.value || []).map((e) => ({
      id: e.id,
      subject: e.subject || "(no title)",
      description: e.bodyPreview,
      start: e.start?.dateTime || new Date().toISOString(),
      end: e.end?.dateTime || new Date().toISOString(),
      attendees: (e.attendees || [])
        .map((a) => a.emailAddress?.address || "")
        .filter(Boolean),
    }));
  }

  private extractEmail(raw: string): string {
    const match = raw.match(/<([^>]+)>/);
    return (match?.[1] ?? raw).trim();
  }
}
