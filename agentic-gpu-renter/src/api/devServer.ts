import "../config/env.js";
import http from "http";
import { URL } from "url";
import agentStart from "./agent-start.js";
import agentTick from "./agent-tick.js";
import agentStatus from "./agent-status.js";

interface VercelRequest {
  method?: string;
  body?: any;
  query?: Record<string, string | string[]>;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
}

function parseQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = query[key];
    if (existing) {
      query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

function createResponse(res: http.ServerResponse): VercelResponse {
  return {
    status: (code: number) => {
      res.statusCode = code;
      return createResponse(res);
    },
    json: (payload: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    }
  };
}

const server = http.createServer((req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const query = parseQuery(url);

  const respond = (handler: (req: VercelRequest, res: VercelResponse) => Promise<void> | void) => {
    const vercelReq: VercelRequest = { method, query };
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", async () => {
        if (body) {
          try {
            vercelReq.body = JSON.parse(body);
          } catch (error) {
            vercelReq.body = body;
          }
        }
        await handler(vercelReq, createResponse(res));
      });
      return;
    }

    void handler(vercelReq, createResponse(res));
  };

  if (url.pathname === "/api/agent-start") {
    return respond(agentStart);
  }
  if (url.pathname === "/api/agent-tick") {
    return respond(agentTick);
  }
  if (url.pathname === "/api/agent-status") {
    return respond(agentStatus);
  }

  res.statusCode = 404;
  res.end("Not found");
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Dev server listening on http://localhost:${port}`);
});
