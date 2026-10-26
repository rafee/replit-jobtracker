import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trackedJobsTable = pgTable(
  "tracked_jobs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    sourceId: text("source_id").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    url: text("url").notNull(),
    location: text("location").notNull().default(""),
    remote: boolean("remote").notNull().default(false),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    seniority: text("seniority"),
    minSalaryUsd: integer("min_salary_usd"),
    maxSalaryUsd: integer("max_salary_usd"),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("saved"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("tracked_jobs_user_source_uidx").on(table.userId, table.sourceId),
    index("tracked_jobs_user_status_idx").on(table.userId, table.status),
  ],
);

export const insertTrackedJobSchema = createInsertSchema(trackedJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTrackedJob = z.infer<typeof insertTrackedJobSchema>;
export type TrackedJob = typeof trackedJobsTable.$inferSelect;
