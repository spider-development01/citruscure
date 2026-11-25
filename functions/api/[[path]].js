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
  "3) Infectious diseases or pests (corky canker pustules with yellow halos, serpentine leafminer tunnels, HLB blotchy mottle, greasy spot, melanose, sooty mold, aphids
