// ============================================================
// tools/chat-response.js — AI response cleanup & action extraction pipeline
// ============================================================

const TAG_PATTERNS = {
  PROVIDER_SEARCH: /PROVIDER_SEARCH:\{[\s\S]*?\}/g,
  CALL_REQUEST: /CALL_REQUEST:\{[\s\S]*?\}/g,
  CALENDAR_EVENT: /CALENDAR_EVENT:\{[\s\S]*?\}/g,
  EMAIL_DRAFT: /EMAIL_DRAFT:\{[\s\S]*?\}/g,
};

// Strip all machine-readable tags from the reply text
function cleanupAIResponse(text) {
  let cleaned = text;
  for (const pattern of Object.values(TAG_PATTERNS)) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

// Extract a JSON payload from a tagged string (e.g. CALL_REQUEST:{...})
function extractTag(text, tagName) {
  const pattern = new RegExp(tagName + ':(\\{[\\s\\S]*?\\})');
  const match = text.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.log(`${tagName} parse error:`, e.message);
    return null;
  }
}

// Extract all actions from the AI reply in one pass
function extractActions(reply) {
  return {
    emailDraft: extractTag(reply, 'EMAIL_DRAFT'),
    callRequest: extractTag(reply, 'CALL_REQUEST'),
    calendarEvent: extractTag(reply, 'CALENDAR_EVENT'),
    providerSearch: extractTag(reply, 'PROVIDER_SEARCH'),
  };
}

// Build a consistent response shape for the frontend
function buildChatResponse(reply, overrides = {}) {
  return {
    reply: cleanupAIResponse(reply),
    calendarEvent: null,
    hasPendingEmail: false,
    hasPendingCall: false,
    providerLinks: null,
    ...overrides,
  };
}

module.exports = { cleanupAIResponse, extractTag, extractActions, buildChatResponse };
