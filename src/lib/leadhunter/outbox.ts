import { createHash } from "node:crypto";

interface SendSchedule { sendDays: string[]; sendStart: string; sendEnd: string; timezone: string }
function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: get("weekday").toLowerCase(), time: `${get("hour")}:${get("minute")}` };
}

export function nextDeliveryWindow(from: Date, schedule: SendSchedule): Date {
  for (let minute = 0; minute <= 14 * 24 * 60; minute += 15) {
    const candidate = new Date(from.getTime() + minute * 60_000);
    const local = localParts(candidate, schedule.timezone);
    if (schedule.sendDays.map((day) => day.toLowerCase()).includes(local.weekday) && local.time >= schedule.sendStart && local.time <= schedule.sendEnd) return candidate;
  }
  throw new Error("No delivery window found");
}

export interface MailCommandDraft { logicalStep: number; dueAt: Date; subject: string; body: string; idempotencyKey: string }
export function buildMailCommands(input: { enrollmentId: string; messageVersionId: string; recipient: string; initial: { subject: string; body: string }; followUps: Array<{ delayDays: number; subjectInstruction: string; bodyInstruction: string }>; firstDueAt: Date }): MailCommandDraft[] {
  const messages = [input.initial, ...input.followUps.map((step) => ({ subject: step.subjectInstruction, body: step.bodyInstruction }))];
  let elapsedDays = 0;
  return messages.map((message, logicalStep) => {
    if (logicalStep > 0) elapsedDays += input.followUps[logicalStep - 1]!.delayDays;
    return { ...message, logicalStep, dueAt: new Date(input.firstDueAt.getTime() + elapsedDays * 86_400_000), idempotencyKey: createHash("sha256").update(`${input.enrollmentId}:${logicalStep}:${input.messageVersionId}`).digest("hex") };
  });
}

export type MailTransportCommand = { outboxId: string; recipient: string; subject: string; body: string; dueAt: string; idempotencyKey: string };
