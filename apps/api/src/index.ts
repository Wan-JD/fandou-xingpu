import { cors } from "hono/cors";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { demoCohorts, demoPeople, demoTree } from "./data";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  return cors({
    origin: c.env.ALLOWED_ORIGIN ?? "*",
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  })(c, next);
});

app.get("/api/health", (c) =>
  c.json({ ok: true, environment: c.env.API_ENV ?? "demo", timestamp: new Date().toISOString() })
);

app.get("/api/tree", (c) => c.json({ data: demoTree }));

app.get("/api/people/:id", (c) => {
  const person = demoPeople.find((candidate) => candidate.id === c.req.param("id"));
  if (!person) {
    throw new HTTPException(404, { message: "Person not found" });
  }
  return c.json({ data: person, demo: true });
});

app.get("/api/cohorts", (c) => c.json({ data: demoCohorts, demo: true }));

app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  console.error("Unhandled API error", error);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
