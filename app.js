// PerfectMind EventParticipants URL Builder (static, GitHub Pages friendly)

const $ = (id) => document.getElementById(id);

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function setStatus(msg, kind = "hint") {
  const status = $("status");
  status.className = kind;
  status.textContent = msg || "";
}

function setDetails(msg) {
  $("details").textContent = msg || "";
}

function normalizePerfectMindBase(inputUrl) {
  // Example:
  // https://campbellriver.perfectmind.com/23221/SocialSite/BookMe4LandingPages/Class?... -> baseRoot = https://campbellriver.perfectmind.com/23221
  const u = new URL(inputUrl);
  const parts = u.pathname.split("/").filter(Boolean); // ["23221","SocialSite",...]
  if (parts.length < 2) throw new Error("Unexpected URL path. Expected something like /23221/SocialSite/...");

  const siteId = parts[0]; // "23221"
  return {
    origin: u.origin,
    siteId,
    baseRoot: `${u.origin}/${siteId}`,
    pathParts: parts,
    searchParams: u.searchParams
  };
}

function detectScope(pathParts, override) {
  if (override) return override;
  // pathParts: ["23221","SocialSite", ...] or ["23221","Clients", ...]
  const maybeScope = pathParts[1];
  if (maybeScope === "SocialSite" || maybeScope === "Clients") return maybeScope;
  // Fallback (some links may omit scope)
  return "SocialSite";
}

function getProxyFetchUrl(proxyKind, targetUrl) {
  if (proxyKind === "allorigins_raw") {
    // allorigins: raw endpoint
    // https://api.allorigins.win/raw?url=ENCODED
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  }
  // corsproxy.io: recommended in many dev writeups; simplest format is:
  // https://corsproxy.io/?ENCODED_URL :contentReference[oaicite:2]{index=2}
  return `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
}

function extractFirst(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function extractBool(html, patterns) {
  const v = extractFirst(html, patterns);
  if (v === null) return null;
  return String(v).toLowerCase() === "true";
}

function buildEventParticipantsUrl({ baseRoot, scope, eventId, occurrenceDate, widgetId, locationId, waitListMode }) {
  const u = new URL(`${baseRoot}/${scope}/BookMe4EventParticipants`);
  u.searchParams.set("eventId", eventId);
  u.searchParams.set("occurrenceDate", occurrenceDate);
  u.searchParams.set("widgetId", widgetId);
  u.searchParams.set("locationId", locationId);
  u.searchParams.set("waitListMode", String(waitListMode));
  return u.toString();
}

async function main() {
  $("buildBtn").addEventListener("click", async () => {
    try {
      $("output").value = "";
      $("copyBtn").disabled = true;
      setDetails("");
      setStatus("Working...", "hint");

      const inputUrl = $("landingUrl").value.trim();
      if (!inputUrl) throw new Error("Paste a landing page URL first.");

      const proxyKind = $("proxy").value;
      const scopeOverride = $("scopeOverride").value;

      // Parse input URL
      const { baseRoot, pathParts, searchParams } = normalizePerfectMindBase(inputUrl);
      const scope = detectScope(pathParts, scopeOverride);

      const occurrenceDate = searchParams.get("occurrenceDate");
      const widgetId = searchParams.get("widgetId");

      if (!occurrenceDate) throw new Error("Input URL missing occurrenceDate=YYYYMMDD");
      if (!widgetId) throw new Error("Input URL missing widgetId=...");

      // Fetch HTML (via proxy)
      const fetchUrl = getProxyFetchUrl(proxyKind, inputUrl);
      const resp = await fetch(fetchUrl, { method: "GET" });

      if (!resp.ok) {
        throw new Error(`Fetch failed (${resp.status}). The proxy or target site may be blocking requests.`);
      }

      const html = await resp.text();

      // Extract parameters from HTML.
      //
      // This is intentionally regex-based and resilient to common embedding patterns:
      // - eventId: "eventId":"<GUID>"  OR  eventId=<GUID>  OR  EventId: "<GUID>" etc
      // - locationId similarly
      //
      // If PerfectMind changes their HTML/JS structure, you may need to tweak these patterns.
      const eventId = extractFirst(html, [
        /eventId["'\s:=]+("?)([0-9a-fA-F-]{36})\1/i,                    // eventId: "<guid>"
        /"eventId"\s*:\s*"([0-9a-fA-F-]{36})"/i,                        // "eventId":"<guid>"
        /EventId["'\s:=]+("?)([0-9a-fA-F-]{36})\1/i
      ]) || extractFirst(html, [
        // JSON-escaped variant: \"eventId\":\"<guid>\"
        /\\"eventId\\"\s*:\s*\\"([0-9a-fA-F-]{36})\\"/i
      ]);

      const locationId = extractFirst(html, [
        /locationId["'\s:=]+("?)([0-9a-fA-F-]{36})\1/i,
        /"locationId"\s*:\s*"([0-9a-fA-F-]{36})"/i,
        /LocationId["'\s:=]+("?)([0-9a-fA-F-]{36})\1/i
      ]) || extractFirst(html, [
        /\\"locationId\\"\s*:\s*\\"([0-9a-fA-F-]{36})\\"/i
      ]);

      // Optional: waitListMode (default false)
      const waitListModeMaybe = extractBool(html, [
        /waitListMode["'\s:=]+(true|false)/i,
        /"waitListMode"\s*:\s*(true|false)/i,
        /\\"waitListMode\\"\s*:\s*(true|false)/i
      ]);
      const waitListMode = waitListModeMaybe === null ? false : waitListModeMaybe;

      if (!eventId || !GUID_RE.test(eventId)) {
        // Debug help: show the first few GUIDs we see (without guessing)
        const guids = Array.from(html.matchAll(new RegExp(GUID_RE.source, "g"))).slice(0, 12).map(m => m[0]);
        const sample = guids.length ? `Sample GUIDs found in HTML:\n- ${guids.join("\n- ")}` : "No GUIDs found in HTML.";
        throw new Error(
          `Could not find eventId in the fetched HTML.\n\n` +
          `This usually means the eventId is loaded dynamically via an API call, or the site changed its HTML.\n\n` +
          sample
        );
      }

      if (!locationId || !GUID_RE.test(locationId)) {
        const guids = Array.from(html.matchAll(new RegExp(GUID_RE.source, "g"))).slice(0, 12).map(m => m[0]);
        const sample = guids.length ? `Sample GUIDs found in HTML:\n- ${guids.join("\n- ")}` : "No GUIDs found in HTML.";
        throw new Error(
          `Could not find locationId in the fetched HTML.\n\n` +
          `This may also be loaded dynamically.\n\n` +
          sample
        );
      }

      const outUrl = buildEventParticipantsUrl({
        baseRoot,
        scope,
        eventId,
        occurrenceDate,
        widgetId,
        locationId,
        waitListMode
      });

      $("output").value = outUrl;
      $("copyBtn").disabled = false;

      setStatus("Done.", "ok");
      setDetails(
        `Extracted:\n` +
        `- scope: ${scope}\n` +
        `- eventId: ${eventId}\n` +
        `- locationId: ${locationId}\n` +
        `- occurrenceDate: ${occurrenceDate}\n` +
        `- widgetId: ${widgetId}\n` +
        `- waitListMode: ${waitListMode}`
      );
    } catch (err) {
      setStatus(err?.message || String(err), "error");
    }
  });

  $("copyBtn").addEventListener("click", async () => {
    const val = $("output").value;
    if (!val) return;
    await navigator.clipboard.writeText(val);
    setStatus("Copied to clipboard.", "ok");
  });
}

main();
