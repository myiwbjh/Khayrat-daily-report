import {projectAuth} from './project-auth.js';
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function parseBody(body) {
  if (typeof body === "string") {
    if (body.length > 3_000_000) throw new ApiError(413, "Request too large");
    try {
      body = JSON.parse(body);
    } catch {
      throw new ApiError(400, "Invalid JSON");
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError(400, "Invalid request");
  return body;
}
export function requireConsent(body, env = process.env) {
  if (body.consent !== true)
    throw new ApiError(403, "Explicit image transmission consent required");
  if (env.AI_FEATURES_APPROVED !== "true")
    throw new ApiError(503, "AI service awaits owner approval");
}
export async function authorizeAI(
  request,
  { env = process.env, fetchImpl = fetch } = {},
) {
  const {user,headers,base}=await projectAuth(request,{env,fetchImpl,editor:true});
  const allowed = (env.AI_ALLOWED_USER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (
    !user.id ||
    !user.email_confirmed_at ||
    !allowed.includes(String(user.email || "").toLowerCase())
  )
    throw new ApiError(403, "Account has no AI project permission");
  return { user, headers, base };
}
export function imageData(value, maxCharacters = 2_800_000) {
  if (
    typeof value !== "string" ||
    value.length > maxCharacters ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new ApiError(400, "Unsupported or oversized image");
  return value;
}

