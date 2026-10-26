import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { requireAuth } from "../middlewares/requireAuth";
import profileRouter from "./profile";
import jobsRouter from "./jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(profileRouter);
router.use(jobsRouter);

export default router;
