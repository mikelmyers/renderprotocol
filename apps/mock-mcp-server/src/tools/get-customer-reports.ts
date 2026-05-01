import { z } from "zod";
import type { CustomerReportsResult } from "@renderprotocol/protocol-types";

export const GetCustomerReportsInput = z.object({});

const FIXTURE: CustomerReportsResult["reports"] = [
  {
    id: "report-001",
    customer: "Greenfield Energy Co.",
    subject: "Confirming inspection schedule for solar farm #4",
    preview:
      "Hi — wanted to confirm the inspection set for Tuesday morning. Site contact will be Aaron…",
    ts_iso: "2026-04-26T18:42:00Z",
    unread: true,
    priority: "normal",
  },
  {
    id: "report-002",
    customer: "Pemberton Vineyards",
    subject: "Frost flyover request — early Friday",
    preview:
      "Forecast shows a hard frost overnight Thursday into Friday. Can we get a flyover before sunrise…",
    ts_iso: "2026-04-26T15:11:00Z",
    unread: true,
    priority: "high",
  },
  {
    id: "report-003",
    customer: "Buckeye Tower Authority",
    subject: "Re: missing footage from Tower 14",
    preview:
      "Got the package, thanks — but it looks like the south-side footage from Tower 14 is missing…",
    ts_iso: "2026-04-26T11:03:00Z",
    unread: false,
    priority: "high",
  },
  {
    id: "report-004",
    customer: "Lakeline HOA",
    subject: "Quote for Q3 perimeter checks",
    preview:
      "The board approved adding two additional perimeter check days per month starting in July…",
    ts_iso: "2026-04-25T22:17:00Z",
    unread: false,
    priority: "low",
  },
  {
    id: "report-005",
    customer: "Albemarle County FD",
    subject: "Standby request for controlled burn",
    preview:
      "We're scheduled for a controlled burn on the 3rd; would like a thermal-equipped flight on standby…",
    ts_iso: "2026-04-25T14:50:00Z",
    unread: false,
    priority: "normal",
  },
];

export const getCustomerReportsDefinition = {
  name: "get_customer_reports",
  title: "Get customer reports",
  description:
    "Returns the inbox of customer reports / inquiries with subject, preview, timestamp, and priority. Suitable for tabular rendering.",
  inputSchema: GetCustomerReportsInput,
} as const;

export function handleGetCustomerReports() {
  const result: CustomerReportsResult = {
    generated_at_iso: new Date().toISOString(),
    reports: FIXTURE,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
