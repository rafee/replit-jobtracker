import { Router, type IRouter, type Response } from "express";
import {
  and,
  desc,
  eq,
} from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, candidateProfilesTable, resumeDraftsTable, trackedJobsTable } from "@workspace/db";
import {
  CreateResumeDraftBody,
  CreateResumeDraftParams,
  CreateResumeDraftResponse,
  DeleteJobParams,
  GetDashboardResponse,
  ListJobsQueryParams,
  ListJobsResponse,
  ListResumeDraftsParams,
  ListResumeDraftsResponse,
  SearchJobsBody,
  SearchJobsResponse,
  SaveJobBody,
  SaveJobResponse,
  UpdateJobBody,
  UpdateJobParams,
  UpdateJobResponse,
  UpdateResumeDraftBody,
  UpdateResumeDraftParams,
  UpdateResumeDraftResponse,
  DownloadResumeDraftParams,
} from "@workspace/api-zod";
import { generateTailoredResume } from "../lib/resume-generator";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

function currentUserId(res: Response): string {
  return res.locals.userId as string;
}

function dateToIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function serializeJob(job: typeof trackedJobsTable.$inferSelect) {
  return {
    ...job,
    postedAt: dateToIso(job.postedAt),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function serializeDraft(draft: typeof resumeDraftsTable.$inferSelect) {
  return {
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const userId = currentUserId(res);
  const jobs = await db
    .select()
    .from(trackedJobsTable)
    .where(eq(trackedJobsTable.userId, userId))
    .orderBy(desc(trackedJobsTable.updatedAt))
    .limit(50);

  const summary = {
    saved: jobs.filter((job) => job.status === "saved").length,
    applied: jobs.filter((job) => job.status === "applied").length,
    interviewing: jobs.filter((job) => job.status === "interviewing").length,
    offers: jobs.filter((job) => job.status === "offer").length,
    recentJobs: jobs.slice(0, 6).map(serializeJob),
  };
  res.json(GetDashboardResponse.parse(summary));
});

router.post("/jobs/search", async (req, res): Promise<void> => {
  const parsed = SearchJobsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const criteria = parsed.data;
  const filters: Record<string, unknown> = {
    posted_at_max_age_days: criteria.postedWithinDays,
    limit: criteria.limit,
    page: 0,
  };
  if (criteria.jobTitle.trim()) filters.job_title_or = [criteria.jobTitle.trim()];
  if (criteria.countryCode.trim()) {
    filters.job_country_code_or = [criteria.countryCode.trim().toUpperCase()];
  }
  if (criteria.remote) filters.remote = true;
  if (criteria.minSalaryUsd != null) filters.min_salary_usd = criteria.minSalaryUsd;
  if (criteria.maxSalaryUsd != null) filters.max_salary_usd = criteria.maxSalaryUsd;

  try {
    const response = await connectors.proxy("theirstack", "/v1/jobs/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(filters),
    });

    if (!response.ok) {
      req.log.warn({ status: response.status }, "TheirStack job search failed");
      const message =
        response.status === 402
          ? "The connected job-search service has no remaining search credits."
          : response.status === 429
            ? "The job-search service is rate-limiting requests. Try again shortly."
            : response.status === 401
              ? "The job-search connection needs to be reconnected."
              : "The job-search service could not complete this search.";
      res.status(502).json({ error: message });
      return;
    }

    const providerPayload = asRecord(await response.json());
    const rawJobs = Array.isArray(providerPayload.data)
      ? providerPayload.data
      : [];
    const locationNeedle = criteria.location.trim().toLocaleLowerCase();
    const results = rawJobs
      .map((value) => {
        const job = asRecord(value);
        const company = asRecord(job.company_object);
        const location =
          typeof job.location === "string"
            ? job.location
            : typeof job.job_location === "string"
              ? job.job_location
              : "";
        return {
          sourceId: String(job.id ?? job.url ?? ""),
          title: asText(job.job_title),
          company: asText(company.name) || asText(job.company_name) || "Company not listed",
          url: asText(job.url),
          location,
          remote: job.remote === true,
          postedAt: toIsoDate(job.date_posted),
          seniority: typeof job.seniority === "string" ? job.seniority : null,
          minSalaryUsd: asNumberOrNull(job.min_annual_salary_usd),
          maxSalaryUsd: asNumberOrNull(job.max_annual_salary_usd),
          description: asText(job.description).slice(0, 20000),
        };
      })
      .filter((job) => job.sourceId && job.title && job.url)
      .filter(
        (job) =>
          !locationNeedle ||
          job.location.toLocaleLowerCase().includes(locationNeedle),
      );

    const result = {
      results,
      total:
        typeof asRecord(providerPayload.metadata).total_results === "number"
          ? (asRecord(providerPayload.metadata).total_results as number)
          : results.length,
      truncated: asRecord(providerPayload.metadata).truncated_results === true,
    };
    res.json(SearchJobsResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "TheirStack integration request failed");
    res.status(502).json({ error: "The job-search service is unavailable." });
  }
});

router.get("/jobs", async (req, res): Promise<void> => {
  const parsed = ListJobsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = currentUserId(res);
  const rows = await db
    .select()
    .from(trackedJobsTable)
    .where(
      parsed.data.status
        ? and(
            eq(trackedJobsTable.userId, userId),
            eq(trackedJobsTable.status, parsed.data.status),
          )
        : eq(trackedJobsTable.userId, userId),
    )
    .orderBy(desc(trackedJobsTable.updatedAt));
  res.json(ListJobsResponse.parse(rows.map(serializeJob)));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = SaveJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = currentUserId(res);
  const input = parsed.data;
  const postedAt = input.postedAt ? new Date(input.postedAt) : null;
  const [job] = await db
    .insert(trackedJobsTable)
    .values({ ...input, userId, postedAt })
    .onConflictDoUpdate({
      target: [trackedJobsTable.userId, trackedJobsTable.sourceId],
      set: {
        title: input.title,
        company: input.company,
        url: input.url,
        location: input.location,
        remote: input.remote,
        postedAt,
        seniority: input.seniority,
        minSalaryUsd: input.minSalaryUsd,
        maxSalaryUsd: input.maxSalaryUsd,
        description: input.description,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.status(201).json(SaveJobResponse.parse(serializeJob(job)));
});

router.patch("/jobs/:jobId", async (req, res): Promise<void> => {
  const params = UpdateJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [job] = await db
    .update(trackedJobsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(trackedJobsTable.id, params.data.jobId),
        eq(trackedJobsTable.userId, currentUserId(res)),
      ),
    )
    .returning();
  if (!job) {
    res.status(404).json({ error: "Tracked job not found." });
    return;
  }
  res.json(UpdateJobResponse.parse(serializeJob(job)));
});

router.delete("/jobs/:jobId", async (req, res): Promise<void> => {
  const params = DeleteJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [job] = await db
    .delete(trackedJobsTable)
    .where(
      and(
        eq(trackedJobsTable.id, params.data.jobId),
        eq(trackedJobsTable.userId, currentUserId(res)),
      ),
    )
    .returning({ id: trackedJobsTable.id });
  if (!job) {
    res.status(404).json({ error: "Tracked job not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/jobs/:jobId/resume-drafts", async (req, res): Promise<void> => {
  const params = ListResumeDraftsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const drafts = await db
    .select()
    .from(resumeDraftsTable)
    .where(
      and(
        eq(resumeDraftsTable.jobId, params.data.jobId),
        eq(resumeDraftsTable.userId, currentUserId(res)),
      ),
    )
    .orderBy(desc(resumeDraftsTable.createdAt));
  res.json(ListResumeDraftsResponse.parse(drafts.map(serializeDraft)));
});

router.post("/jobs/:jobId/resume-drafts", async (req, res): Promise<void> => {
  const params = CreateResumeDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateResumeDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = currentUserId(res);
  const [job] = await db
    .select()
    .from(trackedJobsTable)
    .where(
      and(
        eq(trackedJobsTable.id, params.data.jobId),
        eq(trackedJobsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Tracked job not found." });
    return;
  }
  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.userId, userId))
    .limit(1);
  if (!profile?.baseResume.trim()) {
    res.status(400).json({
      error: "Add your source resume in Profile before creating a tailored draft.",
    });
    return;
  }

  try {
    const content = await generateTailoredResume({
      fullName: profile.fullName,
      sourceResume: profile.baseResume,
      linkedinNotes: profile.linkedinNotes,
      promptPreferences: profile.promptPreferences,
      userPrompt: parsed.data.prompt,
      jobTitle: job.title,
      company: job.company,
      jobDescription: job.description,
    });
    const [draft] = await db
      .insert(resumeDraftsTable)
      .values({
        userId,
        jobId: job.id,
        prompt: parsed.data.prompt,
        content,
      })
      .returning();
    res
      .status(201)
      .json(CreateResumeDraftResponse.parse(serializeDraft(draft)));
  } catch (error) {
    req.log.error({ err: error }, "Resume generation failed");
    const message =
      error instanceof Error && error.message.startsWith("Gemini is not configured")
        ? error.message
        : "Gemini could not create a resume draft. Try again in a moment.";
    res.status(502).json({ error: message });
  }
});

router.patch("/resume-drafts/:draftId", async (req, res): Promise<void> => {
  const params = UpdateResumeDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateResumeDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [draft] = await db
    .update(resumeDraftsTable)
    .set({ content: parsed.data.content, updatedAt: new Date() })
    .where(
      and(
        eq(resumeDraftsTable.id, params.data.draftId),
        eq(resumeDraftsTable.userId, currentUserId(res)),
      ),
    )
    .returning();
  if (!draft) {
    res.status(404).json({ error: "Resume draft not found." });
    return;
  }
  res.json(UpdateResumeDraftResponse.parse(serializeDraft(draft)));
});

router.get("/resume-drafts/:draftId/download", async (req, res): Promise<void> => {
  const params = DownloadResumeDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [draft] = await db
    .select()
    .from(resumeDraftsTable)
    .where(
      and(
        eq(resumeDraftsTable.id, params.data.draftId),
        eq(resumeDraftsTable.userId, currentUserId(res)),
      ),
    )
    .limit(1);
  if (!draft) {
    res.status(404).json({ error: "Resume draft not found." });
    return;
  }
  res
    .type("text/plain")
    .setHeader("Content-Disposition", 'attachment; filename="tailored-resume.txt"')
    .send(draft.content);
});

export default router;
