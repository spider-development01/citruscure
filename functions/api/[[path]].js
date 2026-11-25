const LANG_CONFIG = {
  en: {
    name: "English",
    promptRule:
      "Write EVERY field (plant_name, condition, category, severity, affected_part, " +
      "symptoms, causal_agent, treatment, spoken_summary) in clear, natural English. " +
      "Keep scientific_name in Latin and status strictly as 'ok', 'deficiency', 'bad', or 'none'.",
    ttsDescOk: "a female 30s indian english voice, normal pitch, warm timbre, conversational pacing, clear register",
    ttsDescBad: "a female 30s indian english voice, normal pitch, clear timbre, steady pacing, calm register",
  },
  hi: {
    name: "Hindi",
    promptRule:
      "Translate and write EVERY field (plant_name, condition, category, severity, affected_part, " +
      "symptoms, causal_agent, treatment, spoken_summary) strictly in natural Hindi using Devanagari script " +
      "(for example severity: 'कोई नहीं'/'हल्का'/'मध्यम'/'गंभीर', category: 'स्वस्थ'/'पोषक तत्व की कमी'/'फफूंद'/'जीवाणु'/'कीट'). " +
      "Do NOT leave English words in those fields. Only keep scientific_name in Latin and status as 'ok', 'deficiency', 'bad', or 'none'.",
    ttsDescOk: "a female 30s hindi voice, normal pitch, warm timbre, conversational pacing, clear register",
    ttsDescBad: "a female 30s hindi voice, normal pitch, smooth timbre, steady pacing, calm register",
  },
};

const BASE_SYSTEM_PROMPT =
  "You are an expert citrus and plant pathologist for the Citrus Cure diagnostic station. " +
  "Examine the captured plant photograph carefully and distinguish cleanly between:\n" +
  "1) Healthy foliage -> status='ok'\n" +
  "2) Nutrient deficiencies (uniform yellowing/nitrogen, interveinal chlorosis/iron/zinc/magnesium/manganese, marginal scorch/potassium) -> status='deficiency'\n" +
  "3) Infectious diseases or pests (corky canker pustules with yellow halos, serpentine leafminer tunnels, HLB blotchy mottle, greasy spot, melanose, sooty mold, aphids/scale/mites) -> status='bad'\n" +
  "4) Blurry or non-plant image -> plant_detected=false, status='none'\n" +
  "Be strictly accurate and conservative: report only what is visually supported by the image. " +
  "NEVER output percentages or '%' symbols anywhere.";

const PLANT_REPORT_SCHEMA = {
  type: "OBJECT",
  properties: {
    plant_detected: { type: "BOOLEAN" },
    status: { type: "STRING", enum: ["ok", "deficiency", "bad", "none"] },
    plant_name: { type: "STRING" },
    scientific_name: { type: "STRING" },
    condition: { type: "STRING" },
    category: { type: "STRING" },
    severity: { type: "STRING" },
    affected_part: { type: "STRING" },
    symptoms: { type: "STRING" },
    causal_agent: { type: "STRING" },
    treatment: { type: "STRING" },
    spoken_summary: { type: "STRING" },
  },
  required: [
    "plant_detected",
    "status",
    "plant_name",
    "scientific_name",
    "condition",
    "category",
    "severity",
    "affected_part",
    "symptoms",
    "causal_agent",
    "treatment",
    "spoken_summary",
  ],
};

function cleanSecret(val) {
  let s = String(val || "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (s.toLowerCase().startsWith("bearer ")) {
    s = s.slice(7).trim();
  }
  return s;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseReportJson(rawText, lang) {
  let clean = String(rawText || "").trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let data;
  try {
    data = JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model returned invalid JSON.");
    }
    data = JSON.parse(match[0]);
  }

  if (!data.plant_detected) {
    data.status = "none";
  } else {
    let rawStatus = String(data.status || "").toLowerCase().trim();
    if (!["ok", "deficiency", "bad"].includes(rawStatus)) {
      const blob = `${data.category || ""} ${data.condition || ""} ${data.causal_agent || ""}`.toLowerCase();
      if (/(deficien|nutrient|mineral|chlorosis|पोषक|कमी|नत्रजन|आयरन|जिंक)/.test(blob)) {
        rawStatus = "deficiency";
      } else if (/(healthy|स्वस्थ)/.test(blob)) {
        rawStatus = "ok";
      } else {
        rawStatus = "bad";
      }
    }
    data.status = rawStatus;
  }

  data.language = lang;
  return data;
}

function extractGeminiText(payload) {
  const candidates = payload?.candidates || [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts || [];
    const textParts = [];
    for (const part of parts) {
      if (part?.thought) continue;
      if (typeof part?.text === "string" && part.text.trim()) {
        textParts.push(part.text);
      }
    }
    if (textParts.length > 0) {
      return textParts.join("");
    }
  }
  return "";
}

async function callGeminiGenerate(apiKey, body, models = ["gemini-3.8-flash", "gemini-4-hydrogen"]) {
  let lastError = "Gemini request failed.";

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      return await resp.json();
    }

    const errText = await resp.text();
    lastError = `Gemini (${model}) HTTP ${resp.status}: ${errText.slice(0, 220)}`;
    if (resp.status !== 503 && resp.status !== 429 && resp.status !== 404) {
      throw new Error(lastError);
    }
  }

  throw new Error(lastError);
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pcmToWav(rawBytes, mimeType = "") {
  if (
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x52 && // R
    rawBytes[1] === 0x49 && // I
    rawBytes[2] === 0x46 && // F
    rawBytes[3] === 0x46    // F
  ) {
    return rawBytes;
  }

  const match = /rate=(\d+)/i.exec(mimeType || "");
  const sampleRate = match ? parseInt(match[1], 10) : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = rawBytes.byteLength;

  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  new Uint8Array(wavBuffer, 44).set(rawBytes);
  return new Uint8Array(wavBuffer);
}

function isWavBytes(bytes) {
  return (
    bytes &&
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  );
}

async function handleAnalyze(request, env) {
  const geminiKey = cleanSecret(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (!geminiKey) {
    return jsonResponse({ error: "GEMINI_API_KEY is not configured in Cloudflare Pages environment variables." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request body." }, 400);
  }

  let imageData = String(payload?.image || "").trim();
  if (!imageData) {
    return jsonResponse({ error: "No image provided." }, 400);
  }

  let mimeType = "image/jpeg";
  if (imageData.includes(",")) {
    const [header, b64] = imageData.split(",", 2);
    const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64$/i.exec(header.trim());
    if (mimeMatch) mimeType = mimeMatch[1];
    imageData = b64;
  }

  const lang = LANG_CONFIG[payload?.language] ? payload.language : "en";
  const langInfo = LANG_CONFIG[lang];

  const geminiBody = {
    systemInstruction: {
      parts: [{ text: `${BASE_SYSTEM_PROMPT}\nLANGUAGE REQUIREMENT: ${langInfo.promptRule}` }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: imageData } },
          {
            text: `Diagnose this plant photo accurately. Every written text field MUST be strictly in ${langInfo.name}. Do not use percentages.`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: PLANT_REPORT_SCHEMA,
      maxOutputTokens: 1200,
      thinkingConfig: { thinkingLevel: "LOW" },
    },
  };

  try {
    const respJson = await callGeminiGenerate(geminiKey, geminiBody);
    const text = extractGeminiText(respJson);
    const report = parseReportJson(text, lang);
    return jsonResponse(report, 200);
  } catch (err) {
    return jsonResponse({ error: err.message || "Plant diagnosis failed." }, 500);
  }
}

async function handleTranslate(request, env) {
  const geminiKey = cleanSecret(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (!geminiKey) {
    return jsonResponse({ error: "GEMINI_API_KEY is not configured in Cloudflare Pages environment variables." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request body." }, 400);
  }

  const report = payload?.report;
  const lang = payload?.language;
  if (!report || typeof report !== "object" || !LANG_CONFIG[lang]) {
    return jsonResponse({ error: "Invalid translation payload." }, 400);
  }

  const langInfo = LANG_CONFIG[lang];
  const geminiBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Translate this plant pathology JSON report into ${langInfo.name} ONLY.\n` +
              `Rules: ${langInfo.promptRule}\n` +
              `Preserve plant_detected (${Boolean(report.plant_detected)}), status ('${report.status}'), ` +
              `and scientific_name ('${report.scientific_name}') unchanged.\n` +
              `Source JSON:\n${JSON.stringify(report)}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: PLANT_REPORT_SCHEMA,
      maxOutputTokens: 1200,
      thinkingConfig: { thinkingLevel: "LOW" },
    },
  };

  try {
    const respJson = await callGeminiGenerate(geminiKey, geminiBody);
    const text = extractGeminiText(respJson);
    const translated = parseReportJson(text, lang);
    translated.plant_detected = Boolean(report.plant_detected);
    translated.status = report.status || translated.status;
    return jsonResponse(translated, 200);
  } catch (err) {
    return jsonResponse({ error: err.message || "Translation failed." }, 500);
  }
}

async function handleSpeak(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request body." }, 400);
  }

  const cleanText = String(payload?.text || "").trim().replace(/\s+/g, " ").slice(0, 220);
  if (!cleanText) {
    return jsonResponse({ error: "No diagnosis text to speak." }, 400);
  }

  const lang = LANG_CONFIG[payload?.language] ? payload.language : "en";
  const tone = payload?.tone === "ok" ? "ok" : "bad";
  const langInfo = LANG_CONFIG[lang];

  // 1. Try Rumik Silk ("mulberry")
  const rumikKey = cleanSecret(env.RUMIK_API_KEY || env.SILK_API_KEY);
  if (rumikKey) {
    try {
      const rumikResp = await fetch("https://silk-api.rumik.ai/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${rumikKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mulberry",
          text: cleanText,
          description: tone === "ok" ? langInfo.ttsDescOk : langInfo.ttsDescBad,
        }),
      });

      if (rumikResp.ok) {
        const bytes = new Uint8Array(await rumikResp.arrayBuffer());
        if (isWavBytes(bytes)) {
          return new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": "audio/wav",
              "Cache-Control": "no-store",
            },
          });
        }
      }
    } catch {
      // Fall through to Gemini TTS
    }
  }

  // 2. Try Gemini TTS fallback
  const geminiKey = cleanSecret(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (geminiKey) {
    for (const model of ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"]) {
      try {
        const ttsResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": geminiKey,
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: cleanText }] }],
              generationConfig: { responseModalities: ["AUDIO"] },
            }),
          }
        );

        if (!ttsResp.ok) continue;
        const ttsJson = await ttsResp.json();
        const parts = ttsJson?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          const inline = part?.inlineData;
          if (inline?.data) {
            const rawBytes = base64ToUint8Array(inline.data);
            const wavBytes = pcmToWav(rawBytes, inline.mimeType || "");
            if (isWavBytes(wavBytes)) {
              return new Response(wavBytes, {
                status: 200,
                headers: {
                  "Content-Type": "audio/wav",
                  "Cache-Control": "no-store",
                },
              });
            }
          }
        }
      } catch {
        // Try next TTS model
      }
    }
  }

  // Browser will automatically fall back to Web Speech API
  return jsonResponse({ error: "Server TTS unavailable; use browser speech." }, 503);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (path === "/api/health" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      geminiConfigured: Boolean(cleanSecret(env.GEMINI_API_KEY || env.GOOGLE_API_KEY)),
      rumikConfigured: Boolean(cleanSecret(env.RUMIK_API_KEY || env.SILK_API_KEY)),
    });
  }

  if (path === "/api/analyze" && request.method === "POST") {
    return handleAnalyze(request, env);
  }

  if (path === "/api/translate" && request.method === "POST") {
    return handleTranslate(request, env);
  }

  if (path === "/api/speak" && request.method === "POST") {
    return handleSpeak(request, env);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
