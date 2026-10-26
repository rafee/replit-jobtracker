import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, candidateProfilesTable } from "@workspace/db";
import {
  GetProfileResponse,
  SaveProfileBody,
  SaveProfileResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function currentUserId(res: Response): string {
  return res.locals.userId as string;
}

function serializeProfile(
  profile: typeof candidateProfilesTable.$inferSelect,
) {
  return {
    ...profile,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

router.get("/profile", async (_req, res): Promise<void> => {
  const userId = currentUserId(res);
  let [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.userId, userId))
    .limit(1);

  if (!profile) {
    [profile] = await db
      .insert(candidateProfilesTable)
      .values({ userId })
      .returning();
  }

  res.json(GetProfileResponse.parse(serializeProfile(profile)));
});

router.put("/profile", async (req, res): Promise<void> => {
  const parsed = SaveProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = currentUserId(res);
  const [profile] = await db
    .insert(candidateProfilesTable)
    .values({ userId, ...parsed.data })
    .onConflictDoUpdate({
      target: candidateProfilesTable.userId,
      set: { ...parsed.data, updatedAt: new Date() },
    })
    .returning();

  res.json(SaveProfileResponse.parse(serializeProfile(profile)));
});

export default router;
