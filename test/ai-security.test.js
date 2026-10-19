import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeAI,
  requireConsent,
  imageData,
  parseBody,
} from "../server/ai-auth.js";
import {
  storedImage,
  openAIImage,
  validateVision,
  VISION_SCHEMA,
  MODEL,
} from "../server/vision-service.js";
import { ImageAnalysisProvider } from "../src/image-analysis.js";
import visionHandler from "../api/vision.js";
import configHandler from "../api/config.js";
const env = {
  SUPABASE_URL: "https://db.example",
  SUPABASE_ANON_KEY: "public",
  AI_ALLOWED_USER_EMAILS: "qa@example.test",
  AI_FEATURES_APPROVED: "true",
  VISION_PROVIDER: "openai",
  OPENAI_API_KEY: "server-test-key",
  SUPABASE_STORAGE_BUCKET: "private",
};
const request = { headers: { authorization: "Bearer genuine-test-token" } },
  user = {
    id: "user1",
    email: "qa@example.test",
    email_confirmed_at: "2026-01-01T00:00:00Z",
  };
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const result = {
  scene: "无法判断",
  visibleFacts: ["可见模板与钢筋"],
  activities: [],
  equipment: [],
  materials: ["模板", "钢筋"],
  structures: [],
  stage: "无法判断",
  inferences: [],
  limitations: ["未见人员不能判断停工"],
  summary: "需人工复核",
  confidence: 0.5,
  crossValidation: {
    status: "insufficient-evidence",
    reason: "无法确定浇筑状态",
  },
};
function sink() {
  return {
    code: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(value) {
      this.value = value;
      return this;
    },
  };
}
test("forged Authorization header and expired token are rejected using actual Supabase identity verification", async () => {
  let called = 0;
  await assert.rejects(
    () =>
      authorizeAI(
        { headers: {} },
        {
          env,
          fetchImpl: () => {
            called++;
          },
        },
      ),
    (e) => e.status === 401,
  );
  assert.equal(called, 0);
  await assert.rejects(
    () =>
      authorizeAI(request, {
        env,
        fetchImpl: async (url, options) => {
          called++;
          assert.equal(url, "https://db.example/auth/v1/user");
          assert.equal(
            options.headers.Authorization,
            "Bearer genuine-test-token",
          );
          return response({}, 401);
        },
      }),
    (e) => e.status === 401,
  );
  assert.equal(called, 1);
});
test("verified but unconfirmed, disallowed or missing-allowlist user is denied", async () => {
  for (const u of [
    { ...user, email: "other@example.test" },
    { ...user, email_confirmed_at: null },
  ])
    await assert.rejects(
      () => authorizeAI(request, { env, fetchImpl: async () => response(u) }),
      (e) => e.status === 403,
    );
  await assert.rejects(
    () =>
      authorizeAI(request, {
        env: { ...env, AI_ALLOWED_USER_EMAILS: "" },
        fetchImpl: async url => response(url.includes("project_members")?[{role:"editor",is_admin:false}]:user),
      }),
    (e) => e.status === 403,
  );
  assert.equal(
    (await authorizeAI(request, { env, fetchImpl: async url => response(url.includes("project_members")?[{role:"editor",is_admin:false}]:user) }))
      .user.id,
    "user1",
  );
});
test("owner fee approval and explicit per-request consent are both required", () => {
  assert.throws(
    () => requireConsent({ consent: false }, env),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      requireConsent(
        { consent: true },
        { ...env, AI_FEATURES_APPROVED: "false" },
      ),
    (e) => e.status === 503,
  );
  requireConsent({ consent: true }, env);
});
test("images must be actual allowed base64 data, never user supplied remote URL or oversized payload", () => {
  for (const s of [
    "http://169.254.169.254/latest/meta-data",
    "https://evil.test/image",
    "data:image/svg+xml;base64,aaa=",
    "data:image/png;base64,###",
  ])
    assert.throws(() => imageData(s));
  assert.throws(() => imageData("data:image/png;base64," + "a".repeat(30), 20));
  assert.throws(() => parseBody("not-json"));
  assert.throws(() => parseBody([]));
});
test("vision reads image row AND private storage using caller JWT; no service-role bypass", async () => {
  const auth = await authorizeAI(request, {
      env,
      fetchImpl: async url => response(url.includes("project_members")?[{role:"editor",is_admin:false}]:user),
    }),
    calls = [];
  const stored = await storedImage("image-1", auth, {
    env,
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, "Bearer genuine-test-token");
      return url.includes("/rest/")
        ? response([
            {
              payload: {
                objectPath: "khayrat/batch/evidence/image-1.png",
                sourceExcerpt: "仅该图的施工描述",
              },
            },
          ])
        : new Response(new Uint8Array([137, 80, 78, 71]), {
            headers: { "Content-Type": "image/png" },
          });
    },
  });
  assert.equal(stored.context, "仅该图的施工描述");
  assert.match(stored.dataUrl, /^data:image\/png/);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("/object/authenticated/private/khayrat/"));
});
test("inaccessible RLS row, traversal storage path and inaccessible private object deny external transmission", async () => {
  const auth = {
    base: env.SUPABASE_URL,
    headers: { Authorization: "Bearer verified" },
  };
  for (const rows of [
    [],
    [{ payload: { objectPath: "khayrat/../secret.png" } }],
  ])
    await assert.rejects(
      () =>
        storedImage("image-1", auth, {
          env,
          fetchImpl: async () => response(rows),
        }),
      (e) => e.status === 403,
    );
  await assert.rejects(
    () =>
      storedImage("image-1", auth, {
        env,
        fetchImpl: async (url) =>
          url.includes("/rest/")
            ? response([{ payload: { objectPath: "khayrat/batch/image.png" } }])
            : response({}, 403),
      }),
    (e) => e.status === 403,
  );
});
test("provider is pinned, strict outputs separate facts/text/inference and request never contains browser API keys", async () => {
  let call;
  const output = await openAIImage(
    "data:image/png;base64,YQ==",
    "配对原文",
    VISION_SCHEMA,
    {
      env,
      fetchImpl: async (url, options) => {
        call = { url, options, body: JSON.parse(options.body) };
        return response({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(result) },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 100,
            total_tokens: 200,
          },
        });
      },
    },
  );
  assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(call.body.model, MODEL);
  assert.equal(call.body.store, false);
  assert.equal(call.body.response_format.json_schema.strict, true);
  assert.equal(call.body.max_completion_tokens, 900);
  assert.match(call.body.messages[0].content, /不能仅因照片没有人员判断停工/);
  assert.equal(validateVision(output.result).scene, "无法判断");
  await assert.rejects(
    () =>
      openAIImage("", "", VISION_SCHEMA, {
        env: { ...env, VISION_MODEL: "expensive-model" },
        fetchImpl: () => {
          throw Error("should not call");
        },
      }),
    (e) => e.status === 503,
  );
});
test("malformed, truncated and upstream failures give sanitized errors without upstream details", async () => {
  assert.throws(() => validateVision({ ...result, scene: "停工" }));
  assert.throws(() => validateVision({ ...result, confidence: 2 }));
  await assert.rejects(
    () =>
      openAIImage("", "", VISION_SCHEMA, {
        env,
        fetchImpl: async () =>
          response({
            choices: [{ finish_reason: "length", message: { content: "{}" } }],
          }),
      }),
    (e) => e.status === 502,
  );
  await assert.rejects(
    () =>
      openAIImage("", "", VISION_SCHEMA, {
        env,
        fetchImpl: async () =>
          response({ error: "sensitive upstream secret" }, 401),
      }),
    (e) => e.message === "Vision provider request failed",
  );
});
test("browser provider sends ID and authenticated consent only, preserving structured evidence", async () => {
  let sent;
  const provider = new ImageAnalysisProvider({
    endpoint: "/api/vision",
    consent: true,
    accessToken: "user-jwt",
    fetchImpl: async (url, options) => {
      sent = options;
      return response({
        ...result,
        textFacts: "日报原文",
        provider: "OpenAI",
        model: MODEL,
      });
    },
  });
  const analyzed = await provider.analyze({
    imageId: "i1",
    objectPath: "khayrat/a.png",
    dataUrl: "DO-NOT-SEND",
    nearbyText: "DO-NOT-TRUST",
  });
  assert.deepEqual(JSON.parse(sent.body), { imageId: "i1", consent: true });
  assert.equal(sent.headers.Authorization, "Bearer user-jwt");
  assert.equal(analyzed.manualReviewed, false);
  assert.deepEqual(analyzed.visibleFacts, ["可见模板与钢筋"]);
  await assert.rejects(
    () => provider.analyze({ imageId: "not-uploaded" }),
    /云端/,
  );
  await assert.rejects(() => new ImageAnalysisProvider().analyze({}), /授权/);
});
test("actual API handler blocks unapproved feature before network; public config never returns AI key or ACL", async () => {
  const saved = { ...process.env },
    oldFetch = globalThis.fetch;
  try {
    Object.assign(process.env, env, { AI_FEATURES_APPROVED: "false" });
    globalThis.fetch = () => {
      throw Error("unexpected network");
    };
    const r = sink();
    await visionHandler(
      {
        method: "POST",
        headers: request.headers,
        body: { imageId: "i1", consent: true },
      },
      r,
    );
    assert.equal(r.code, 503);
    const c = sink();
    configHandler({}, c);
    assert.equal(c.value.visionEnabled, false);
    assert.ok(!JSON.stringify(c.value).includes(env.OPENAI_API_KEY));
    assert.ok(!JSON.stringify(c.value).includes(env.AI_ALLOWED_USER_EMAILS));
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    globalThis.fetch = oldFetch;
  }
});

test("background API refuses paid providers even with existing owner approval", async () => {
 const saved={...process.env},oldFetch=globalThis.fetch;
 try{Object.assign(process.env,env);let calls=0;globalThis.fetch=()=>{calls++;throw Error('must not send');};const r=sink();await visionHandler({method:'POST',headers:request.headers,body:{imageId:'i1',consent:true}},r);assert.equal(r.code,403);assert.equal(calls,0);}
 finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);globalThis.fetch=oldFetch;}
});
