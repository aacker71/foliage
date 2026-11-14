/** Fireworks is the sole outbound hop. No SDK, redirects, tools, silent retries or model fallback. */
import { ASSESSMENT_PROMPT, DIMENSIONS, digest, parseFindings, redactPacket, record, type Assessment, type AssessmentPacket } from "./ladybugAssessment.ts";

export function assessmentModel(env: Readonly<Record<string, string | undefined>>): string | null {
  return env["FOLIAGE_ESCALATED_INFERENCE_MODEL"]?.trim() || null;
}
export function inferenceReady(env: Readonly<Record<string, string | undefined>>): boolean {
  return !!assessmentModel(env) && !!env["FOLIAGE_ESCALATED_INFERENCE_KEY"]?.trim() && env["FOLIAGE_ASSESSMENT_PROVIDER_APPROVED"] === "true";
}
/** Shared bounded transport for assessment and owner-reviewed collaboration. */
export async function inferScarletJson(prompt: string, input: unknown, env: Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch): Promise<unknown> {
  const model = assessmentModel(env);
  if (!inferenceReady(env) || !model) throw new Error("Fireworks is not ready: configure its key, exact model id and approved provider privacy/residency settings. Nothing sent.");
  const signal = AbortSignal.timeout(90_000);
  let response: Response;
  try {
    response = await fetcher("https://api.fireworks.ai/inference/v1/chat/completions", {
      method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${env["FOLIAGE_ESCALATED_INFERENCE_KEY"]}` },
      body: JSON.stringify({ model, stream: false, store: false, max_tokens: 8_000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(input) }],
      }),
    });
  } catch {
    throw new Error(signal.aborted ? "Fireworks timed out. No assessment was accepted; retry explicitly." : "Fireworks transport failed or redirected. No assessment was accepted.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Fireworks refused the request (HTTP ${response.status}). No assessment was accepted.`);
  }
  // Bound bytes as they arrive, not after response.text() has allocated an unbounded body.
  if (!response.body) throw new Error("Fireworks returned no response body.");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 128 * 1024) throw new Error("Fireworks response exceeded the size limit.");
      chunks.push(part.value);
    }
  } catch {
    throw new Error("Fireworks response was interrupted, timed out or exceeded the size limit. Nothing accepted.");
  } finally { await reader.cancel().catch(() => undefined); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const choice = body?.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice?.message?.content !== "string") throw new Error();
    return JSON.parse(choice.message.content) as unknown;
  } catch {
    throw new Error("Ladybug's response was incomplete or failed the evidence, privacy or no-rating checks. Nothing accepted.");
  }
}

export async function assessPacket(packet: AssessmentPacket, env: Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch): Promise<Assessment> {
  if (digest(redactPacket(packet)) !== digest(packet)) throw new Error("The evidence packet needs a fresh redaction review. Nothing sent.");
  const result = await inferScarletJson(ASSESSMENT_PROMPT, packet, env, fetcher);
  try {
    const output = record(result, ["findings"]);
    const findings = parseFindings(output["findings"], packet);
    if (findings.length !== DIMENSIONS.length || findings.some((f, i) => f.dimension !== DIMENSIONS[i])) throw new Error();
    return { model: assessmentModel(env)!, assessedAt: new Date().toISOString(), packetDigest: digest(packet), findings };
  } catch {
    throw new Error("Ladybug's response was incomplete or failed the evidence, privacy or no-rating checks. Nothing accepted.");
  }
}
