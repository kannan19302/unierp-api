import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CrmMailboxProviderClientService } from "../crm-mailbox-provider-client.service";

/**
 * L08 — dedicated tests for the responsibility extracted from
 * CrmMailboxService: raw Gmail/Microsoft Graph REST calls given a bearer
 * token. No tenant/CRM/Prisma concerns here — that stays in
 * CrmMailboxService, still covered by its own existing spec.
 */
function mockFetchSequence(responses: Array<{ ok: boolean; json?: unknown; status?: number }>) {
  let call = 0;
  global.fetch = vi.fn().mockImplementation(() => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: () => Promise.resolve(r.json ?? {}),
    });
  }) as unknown as typeof fetch;
}

describe("CrmMailboxProviderClientService", () => {
  let client: CrmMailboxProviderClientService;

  beforeEach(() => {
    client = new CrmMailboxProviderClientService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchGmailMessages extracts the bare email from an RFC 5322 'Name <addr>' From header", async () => {
    mockFetchSequence([
      { ok: true, json: { messages: [{ id: "m1" }] } },
      {
        ok: true,
        json: {
          internalDate: "1700000000000",
          payload: {
            headers: [
              { name: "From", value: "Jane Doe <jane@example.com>" },
              { name: "To", value: "sales@acme.com" },
              { name: "Subject", value: "RE: proposal" },
            ],
          },
        },
      },
    ]);

    const [msg] = await client.fetchGmailMessages("token-1", new Date());
    expect(msg.from).toBe("jane@example.com");
    expect(msg.to).toEqual(["sales@acme.com"]);
    expect(msg.subject).toBe("RE: proposal");
  });

  it("fetchGmailMessages throws a named error when the list call fails", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);
    await expect(client.fetchGmailMessages("bad-token", new Date())).rejects.toThrow("Gmail list failed: 401");
  });

  it("fetchOutlookMessages maps Graph's nested emailAddress shape to a flat from/to", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          value: [
            {
              id: "o1",
              subject: "Meeting notes",
              from: { emailAddress: { address: "bob@corp.com" } },
              toRecipients: [{ emailAddress: { address: "alice@corp.com" } }],
              receivedDateTime: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    ]);

    const [msg] = await client.fetchOutlookMessages("token-1", new Date());
    expect(msg.from).toBe("bob@corp.com");
    expect(msg.to).toEqual(["alice@corp.com"]);
  });

  it("fetchGoogleCalendarEvents maps attendee emails and defaults a missing title", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          items: [
            { id: "e1", start: { dateTime: "2026-01-01T10:00:00Z" }, end: { dateTime: "2026-01-01T11:00:00Z" }, attendees: [{ email: "x@y.com" }] },
          ],
        },
      },
    ]);

    const [event] = await client.fetchGoogleCalendarEvents("token-1", new Date());
    expect(event.subject).toBe("(no title)");
    expect(event.attendees).toEqual(["x@y.com"]);
  });

  it("fetchOutlookCalendarEvents throws a named error when the Graph call fails", async () => {
    mockFetchSequence([{ ok: false, status: 500 }]);
    await expect(client.fetchOutlookCalendarEvents("token-1", new Date())).rejects.toThrow("Graph calendar failed: 500");
  });
});
