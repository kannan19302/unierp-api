/**
 * Only nodemailer's network transport is mocked — the same pattern this
 * session mocks Prisma throughout. SmtpEmailAdapter's own logic (input
 * validation, error mapping to ExecutionResult, health-check wiring) is
 * exercised for real; a real SMTP server is not reachable in this sandbox.
 */
import { vi } from "vitest";

const verify = vi.fn();
const sendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ verify, sendMail })),
  },
}));

import { runAdapterConformanceSuite } from "../adapter-conformance-suite";
import { SmtpEmailAdapter } from "./smtp-email.adapter";

verify.mockResolvedValue(true);
sendMail.mockImplementation(async ({ to }: { to: string }) => ({
  messageId: `smtp-${to}-${Date.now()}`,
}));

runAdapterConformanceSuite(
  "SmtpEmailAdapter (real nodemailer wiring, transport mocked)",
  () =>
    new SmtpEmailAdapter("smtp-provider-1", {
      host: "smtp.example.test",
      port: 587,
      user: "test",
      password: "test",
      from: "noreply@example.test",
    }),
  {
    validInput: { to: "user@example.com", subject: "Hello", body: "<p>Hi</p>" },
    invalidInput: { subject: "Missing recipient and body" },
  },
);
