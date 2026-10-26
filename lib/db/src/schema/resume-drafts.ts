import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { trackedJobsTable } from "./tracked-jobs";

export const resumeDraftsTable = pgTable("resume_drafts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobId: integer("job_id")
    .notNull()
    .references(() => trackedJobsTable.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertResumeDraftSchema = createInsertSchema(resumeDraftsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertResumeDraft = z.infer<typeof insertResumeDraftSchema>;
export type ResumeDraft = typeof resumeDraftsTable.$inferSelect;
