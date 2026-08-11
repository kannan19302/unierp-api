import { runAdapterConformanceSuite } from "../adapter-conformance-suite";
import { LogEmailAdapter } from "./log-email.adapter";

runAdapterConformanceSuite(
  "LogEmailAdapter (dev/test backend, no network dependency)",
  () => new LogEmailAdapter("log-provider-1"),
  {
    validInput: { to: "user@example.com", subject: "Hello", body: "<p>Hi</p>" },
    invalidInput: { subject: "Missing recipient and body" },
  },
);
