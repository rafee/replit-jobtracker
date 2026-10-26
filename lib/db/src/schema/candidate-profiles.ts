import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const candidateProfilesTable = pgTable("candidate_profiles", {
  userId: text("user_id").primaryKey(),
  fullName: text("full_name").notNull().default(""),
  baseResume: text("base_resume").notNull().default(""),
  linkedinNotes: text("linkedin_notes").notNull().default(""),
  targetTitles: text("target_titles").array().notNull().default([]),
  location: text("location").notNull().default(""),
  countryCode: text("country_code").notNull().default("US"),
  remoteOnly: boolean("remote_only").notNull().default(false),
  minSalaryUsd: integer("min_salary_usd"),
  maxSalaryUsd: integer("max_salary_usd"),
  promptPreferences: text("prompt_preferences").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCandidateProfileSchema = createInsertSchema(
  candidateProfilesTable,
).omit({ updatedAt: true });

export type InsertCandidateProfile = z.infer<typeof insertCandidateProfileSchema>;
export type CandidateProfile = typeof candidateProfilesTable.$inferSelect;
