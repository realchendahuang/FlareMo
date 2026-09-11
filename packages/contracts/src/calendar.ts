import { z } from "zod";
import { taskDtoSchema } from "./projects";

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date.");

export const calendarViewQuerySchema = z
  .object({
    from: dateKey,
    to: dateKey,
  })
  .refine(
    ({ from, to }) =>
      new Date(`${from}T00:00:00Z`).getTime() <=
      new Date(`${to}T00:00:00Z`).getTime(),
    "`from` must not be after `to`.",
  )
  .refine(({ from, to }) => {
    const span =
      (new Date(`${to}T00:00:00Z`).getTime() -
        new Date(`${from}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000);
    return span <= 92;
  }, "Calendar range is limited to 93 days.");

export const calendarViewSchema = z.object({
  // Notes per day keyed by `substr(created_at, 1, 10)`, only for days that
  // have content, within the requested range.
  notes: z.array(
    z.object({
      date: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  // Per-day count of notes written that day whose Markdown content still has
  // unchecked task-list items (payload.property.has_incomplete_tasks).
  note_tasks: z.array(
    z.object({
      date: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  // Tasks with a due date inside the range. Carrying the full task DTO keeps
  // the calendar able to render titles, statuses and priorities without a
  // second round trip.
  tasks: z.array(taskDtoSchema),
});

export type CalendarViewQuery = z.infer<typeof calendarViewQuerySchema>;
export type CalendarView = z.infer<typeof calendarViewSchema>;
