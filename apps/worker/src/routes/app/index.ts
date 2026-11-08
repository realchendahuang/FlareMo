import { Hono } from "hono";
import type { HonoBindings } from "../../context";
import { registerInstanceRoutes } from "./instance";
import { registerMeRoutes } from "./me";
import { registerMemoCrudRoutes, registerMemoListRoutes } from "./memos";
import { registerPushRoutes } from "./push";
import { registerReviewRoutes } from "./review";
import { registerSyncRoutes } from "./sync";
import { registerTimelineRoutes } from "./timeline";
import { registerUsageRoutes } from "./usage";

export const appApi = new Hono<HonoBindings>();

// Registration order is the routing contract (Hono matches in registration
// order), so the calls below follow the historical single-file order exactly:
// me/health, memo list+stats, timeline, push, usage, review, memo CRUD+tags.
// Native-sync additions are appended after the historical tree: their paths
// (`/instance`, `/sync/*`) share no prefix with anything above, so they cannot
// shadow an existing route.
registerMeRoutes(appApi);
registerMemoListRoutes(appApi);
registerTimelineRoutes(appApi);
registerPushRoutes(appApi);
registerUsageRoutes(appApi);
registerReviewRoutes(appApi);
registerMemoCrudRoutes(appApi);
registerInstanceRoutes(appApi);
registerSyncRoutes(appApi);
