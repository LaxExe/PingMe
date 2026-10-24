export interface Env {
  PINGME_SETTINGS: KVNamespace;
  REMINDER_SCHEDULER: DurableObjectNamespace;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  PINGME_SECRET: string;
}

const TWILIO_VOICE = "Polly.Matthew-Neural";

function escapeXml(unsafe: string | null | undefined): string {
  if (!unsafe) return "";
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

function say(text: string): string {
  return `<Say voice="${TWILIO_VOICE}">${escapeXml(text)}</Say>`;
}

// Helper to push actions to the sync queue in KV with error boundary and size limit
async function pushSyncAction(env: Env, action: any) {
  try {
    const raw = await env.PINGME_SETTINGS.get("sync_queue");
    let queue: any[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) queue = parsed;
      } catch {
        queue = [];
      }
    }
    queue.push(action);
    // Keep max 100 items to prevent unbounded KV record growth
    if (queue.length > 100) queue = queue.slice(-100);
    await env.PINGME_SETTINGS.put("sync_queue", JSON.stringify(queue));
  } catch (err) {
    console.error("pushSyncAction error:", err);
  }
}

const DEFAULT_PRESETS: Record<string, string> = {
  morning: "08:00",
  afternoon: "13:00",
  evening: "18:00",
  night: "21:00"
};

// Time calculation helpers in user timezone with robust fallbacks
function getSlotTimestamp(slotName: string, presets: any, userTz: string, isTomorrow: boolean): number {
  const timeStr = presets?.[slotName] || DEFAULT_PRESETS[slotName] || "09:00";
  const [hStr, mStr] = timeStr.split(":");
  const h = Number(hStr) || 9;
  const m = Number(mStr) || 0;
  const now = new Date();

  let safeTz = userTz || "America/Toronto";
  let dateStr = "";
  let offsetClean = "";

  try {
    dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: safeTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);

    const tzOffsetFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: safeTz,
      timeZoneName: "longOffset"
    });
    const offsetPart = tzOffsetFormatter.format(now).split(" ").pop() || "GMT";
    offsetClean = offsetPart.replace("GMT", "");
  } catch {
    // Fallback to UTC if timezone is invalid
    safeTz = "UTC";
    dateStr = now.toISOString().slice(0, 10);
    offsetClean = "Z";
  }

  const [yr, mo, dy] = dateStr.split("-").map(Number);
  let targetDate = new Date(`${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${offsetClean || 'Z'}`);

  if (isNaN(targetDate.getTime())) {
    targetDate = new Date(Date.now() + 60 * 60 * 1000);
  }

  if (isTomorrow) {
    targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  }

  return targetDate.getTime();
}

function calculateNextPingAt(currentPingAt: number, recurrence: 'none' | 'daily' | 'weekly' | number): number | null {
  if (!recurrence || recurrence === 'none') return null;
  const now = Date.now();
  let next = currentPingAt || now;
  let interval = 0;

  if (recurrence === 'daily') {
    interval = 24 * 60 * 60 * 1000;
  } else if (recurrence === 'weekly') {
    interval = 7 * 24 * 60 * 60 * 1000;
  } else if (typeof recurrence === 'number') {
    interval = recurrence * 60 * 1000;
  }

  if (interval <= 0 || isNaN(interval)) return null;

  // Protect against infinite loop with loop limit
  let loops = 0;
  while (next <= now && loops < 1000) {
    next += interval;
    loops++;
  }
  return next;
}

// ─── Durable Object: ReminderScheduler ───────────────────────────────────────

export class ReminderScheduler {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/schedule" && request.method === "POST") {
        const data: any = await request.json();
        const nextPingAt = Number(data.nextPingAt) || (Date.now() + 10 * 60 * 1000);

        await this.state.storage.put("reminderId", data.reminderId || "");
        await this.state.storage.put("reminderText", data.reminderText || "PingMe reminder");
        await this.state.storage.put("nextPingAt", nextPingAt);
        await this.state.storage.put("recurrence", data.recurrence || "none");
        await this.state.storage.put("workerUrl", data.workerUrl || "");
        await this.state.storage.put("attemptCount", 0);
        await this.state.storage.put("status", "pending");

        await this.state.storage.setAlarm(nextPingAt);
        return new Response("Scheduled", { status: 200 });
      }

      if (url.pathname === "/schedule" && request.method === "DELETE") {
        await this.state.storage.deleteAll();
        await this.state.storage.deleteAlarm();
        return new Response("Canceled", { status: 200 });
      }

      if (url.pathname === "/info" && request.method === "GET") {
        const reminderText = (await this.state.storage.get("reminderText")) || "PingMe reminder";
        const recurrence = (await this.state.storage.get("recurrence")) || "none";
        return new Response(JSON.stringify({ reminderText, recurrence }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/reschedule" && request.method === "POST") {
        const data: any = await request.json();
        const nextPingAt = Number(data.nextPingAt) || (Date.now() + 10 * 60 * 1000);
        await this.state.storage.put("nextPingAt", nextPingAt);
        await this.state.storage.put("status", data.status || "pending");
        await this.state.storage.put("attemptCount", 0);
        await this.state.storage.setAlarm(nextPingAt);
        return new Response("Rescheduled", { status: 200 });
      }

      if (url.pathname === "/done" && request.method === "POST") {
        const recurrence: any = (await this.state.storage.get("recurrence")) || "none";
        const currentPingAt = (await this.state.storage.get("nextPingAt") as number) || Date.now();
        const nextPingAt = calculateNextPingAt(currentPingAt, recurrence);

        if (nextPingAt) {
          await this.state.storage.put("nextPingAt", nextPingAt);
          await this.state.storage.put("attemptCount", 0);
          await this.state.storage.put("status", "pending");
          await this.state.storage.setAlarm(nextPingAt);
          return new Response(JSON.stringify({ nextPingAt, rescheduled: true }), {
            headers: { "Content-Type": "application/json" }
          });
        } else {
          await this.state.storage.deleteAll();
          await this.state.storage.deleteAlarm();
          return new Response(JSON.stringify({ deleted: true }), {
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      return new Response("Not found", { status: 404 });
    } catch (err: any) {
      console.error("DurableObject error:", err);
      return new Response(JSON.stringify({ error: err.message || "Internal DO error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  async alarm() {
    try {
      const reminderId = (await this.state.storage.get("reminderId") as string) || "";
      const reminderText = (await this.state.storage.get("reminderText") as string) || "PingMe reminder";
      const workerUrl = (await this.state.storage.get("workerUrl") as string) || "";
      let attemptCount = (await this.state.storage.get("attemptCount") as number) || 0;

      // Load settings to fetch phoneNumber and reping interval
      const rawSettings = await this.env.PINGME_SETTINGS.get("settings");
      let settings: any = null;
      try {
        settings = rawSettings ? JSON.parse(rawSettings) : null;
      } catch {
        settings = null;
      }
      if (!settings || !settings.phoneNumber) return;

      if (attemptCount >= 3) {
        await this.state.storage.put("status", "callsStopped");
        await pushSyncAction(this.env, { type: "callsStopped", reminderId });
        return;
      }

      // Call Twilio outbound API
      try {
        const basicAuth = btoa(`${this.env.TWILIO_ACCOUNT_SID}:${this.env.TWILIO_AUTH_TOKEN}`);
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.env.TWILIO_ACCOUNT_SID}/Calls.json`;

        const params = new URLSearchParams();
        params.append("To", settings.phoneNumber);
        params.append("From", this.env.TWILIO_PHONE_NUMBER);
        params.append("Url", `${workerUrl}/twiml?reminderId=${encodeURIComponent(reminderId)}`);
        params.append("StatusCallback", `${workerUrl}/webhook?reminderId=${encodeURIComponent(reminderId)}`);
        params.append("StatusCallbackEvent", "completed");

        await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params.toString()
        });
      } catch (e) {
        console.error("Twilio call initiation failed:", e);
      }

      attemptCount++;
      await this.state.storage.put("attemptCount", attemptCount);
      await pushSyncAction(this.env, { type: "attemptIncremented", reminderId, attemptCount });

      // Fallback re-ping interval (in minutes)
      const repingInterval = Number(settings.repingIntervalMinutes) || 10;
      const nextPingAt = Date.now() + repingInterval * 60 * 1000;
      await this.state.storage.put("nextPingAt", nextPingAt);
      await this.state.storage.setAlarm(nextPingAt);
    } catch (err) {
      console.error("Alarm execution failed:", err);
    }
  }
}

// ─── Worker Routing & Logic ──────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Dynamic CORS Headers
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-PingMe-Secret"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Determine if request is from Twilio or from Frontend
    const isTwilioRoute = url.pathname.startsWith("/twiml") || url.pathname === "/webhook";

    if (!isTwilioRoute) {
      // Frontend Authenticated requests
      const secret = request.headers.get("X-PingMe-Secret");
      if (secret !== env.PINGME_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    try {
      // Route: POST /schedule
      if (url.pathname === "/schedule" && request.method === "POST") {
        let data: any = {};
        try {
          data = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        if (!data.reminderId) {
          return new Response(JSON.stringify({ error: "Missing reminderId" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const id = env.REMINDER_SCHEDULER.idFromName(data.reminderId);
        const stub = env.REMINDER_SCHEDULER.get(id);

        const payload = {
          ...data,
          workerUrl: url.origin
        };

        const doRes = await stub.fetch("http://do/schedule", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        return new Response("Scheduled", { status: doRes.status, headers: corsHeaders });
      }

      // Route: DELETE /schedule/:id
      if (url.pathname.startsWith("/schedule/") && request.method === "DELETE") {
        const parts = url.pathname.split("/");
        const reminderId = parts[parts.length - 1];
        if (!reminderId) {
          return new Response(JSON.stringify({ error: "Missing reminderId" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const id = env.REMINDER_SCHEDULER.idFromName(reminderId);
        const stub = env.REMINDER_SCHEDULER.get(id);

        await stub.fetch("http://do/schedule", { method: "DELETE" });
        return new Response("Canceled", { headers: corsHeaders });
      }

      // Route: GET /sync
      if (url.pathname === "/sync" && request.method === "GET") {
        const raw = await env.PINGME_SETTINGS.get("sync_queue");
        let actions = [];
        try {
          actions = raw ? JSON.parse(raw) : [];
        } catch {
          actions = [];
        }
        await env.PINGME_SETTINGS.put("sync_queue", "[]");
        return new Response(JSON.stringify({ actions }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Route: GET /db
      if (url.pathname === "/db" && request.method === "GET") {
        const db = await env.PINGME_SETTINGS.get("db_sync");
        return new Response(db || "{}", {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Route: POST /db
      if (url.pathname === "/db" && request.method === "POST") {
        const db = await request.text();
        await env.PINGME_SETTINGS.put("db_sync", db);
        return new Response(JSON.stringify({ saved: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Route: POST /settings
      if (url.pathname === "/settings" && request.method === "POST") {
        const settings = await request.json();
        await env.PINGME_SETTINGS.put("settings", JSON.stringify(settings));
        return new Response(JSON.stringify({ saved: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // ─── Twilio Call Flow endpoints (Voice IVR Decision Tree) ──────────────────

      // Route: POST /twiml
      if (url.pathname === "/twiml" && request.method === "POST") {
        const reminderId = url.searchParams.get("reminderId") || "";
        if (!reminderId) {
          const emptyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("No reminder ID was specified. Goodbye.")}
  <Hangup/>
</Response>`;
          return new Response(emptyTwiml, { headers: { "Content-Type": "text/xml" } });
        }

        const id = env.REMINDER_SCHEDULER.idFromName(reminderId);
        const stub = env.REMINDER_SCHEDULER.get(id);

        let reminderText = "scheduled reminder";
        try {
          const infoRes = await stub.fetch("http://do/info");
          if (infoRes.ok) {
            const info = await infoRes.json() as any;
            if (info?.reminderText) reminderText = info.reminderText;
          }
        } catch (e) {
          console.error("Failed to fetch DO info:", e);
        }

        const rawSettings = await env.PINGME_SETTINGS.get("settings");
        let settings: any = null;
        try {
          settings = rawSettings ? JSON.parse(rawSettings) : null;
        } catch {
          settings = null;
        }
        const name = settings?.name?.trim() || "friend";

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(`Hi ${name}, you have a reminder: ${reminderText}.`)}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=main" timeout="10" bargeIn="true">
    ${say("Press 1 to snooze, press 2 to push, press 0 to mark as done.")}
  </Gather>
  ${say("Sorry, I didn't hear an option.")}
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;

        return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
      }

      // Route: POST /twiml/gather
      if (url.pathname === "/twiml/gather" && request.method === "POST") {
        const reminderId = url.searchParams.get("reminderId") || "";
        const step = url.searchParams.get("step") || "main";

        let rawDigits = "";
        try {
          const formData = await request.formData();
          rawDigits = formData.get("Digits")?.toString() || "";
        } catch {
          // If formData parsing fails, try query param
        }
        if (!rawDigits) {
          rawDigits = url.searchParams.get("Digits") || "";
        }
        rawDigits = rawDigits.trim();

        if (!reminderId) {
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Invalid reminder ID. Goodbye.")}
  <Hangup/>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }

        const id = env.REMINDER_SCHEDULER.idFromName(reminderId);
        const stub = env.REMINDER_SCHEDULER.get(id);

        const rawSettings = await env.PINGME_SETTINGS.get("settings");
        let settings: any = null;
        try {
          settings = rawSettings ? JSON.parse(rawSettings) : null;
        } catch {
          settings = null;
        }
        const presets = settings?.presets || DEFAULT_PRESETS;
        const userTz = settings?.timezone || "America/Toronto";

        // ── Sub-step: MAIN MENU ──
        if (step === "main") {
          // Mark done: 0
          if (rawDigits === "0" || rawDigits.startsWith("0")) {
            try {
              const res = await stub.fetch("http://do/done", { method: "POST" });
              const status = (await res.json()) as any;

              if (status?.rescheduled) {
                await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt: status.nextPingAt });
                const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Done. Next occurrence scheduled. Goodbye.")}
  <Hangup/>
</Response>`;
                return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
              } else {
                await pushSyncAction(env, { type: "done", reminderId });
                const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Done. Reminder marked as completed. Goodbye.")}
  <Hangup/>
</Response>`;
                return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
              }
            } catch (e) {
              console.error("Done processing error:", e);
              const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Done. Reminder completed. Goodbye.")}
  <Hangup/>
</Response>`;
              return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
            }
          }

          // Snooze: 1 or fast-key e.g. "115"
          if (rawDigits === "1") {
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("How many minutes? Enter the number, then press the pound key.")}
  <Gather finishOnKey="#" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=snooze" timeout="12" bargeIn="true">
  </Gather>
  ${say("I didn't hear a number.")}
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          }

          // User quickly pressed "1" and the snooze minutes in one go (e.g. "115")
          if (rawDigits.startsWith("1") && rawDigits.length > 1) {
            const minutes = parseInt(rawDigits.slice(1).replace(/\D/g, ""), 10);
            if (!isNaN(minutes) && minutes > 0 && minutes <= 1440) {
              const nextPingAt = Date.now() + minutes * 60 * 1000;
              await stub.fetch("http://do/reschedule", {
                method: "POST",
                body: JSON.stringify({ nextPingAt, status: "snoozed" })
              });
              await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt });
              const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(`Snoozed for ${minutes} minutes. Goodbye.`)}
  <Hangup/>
</Response>`;
              return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
            }
          }

          // Push later: 2
          if (rawDigits === "2") {
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Press 1 for today, press 2 for tomorrow.")}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=push-day" timeout="10" bargeIn="true">
  </Gather>
  ${say("I didn't get that.")}
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          }

          // User quickly pressed "21" (Push Today) or "22" (Push Tomorrow)
          if (rawDigits === "21") {
            return handlePushTodayRoute(url, env, stub, reminderId, presets, userTz);
          }
          if (rawDigits === "22") {
            return handlePushTomorrowPrompt(url, reminderId);
          }

          // Unrecognized digit pressed rapidly or invalid option
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("I didn't recognize that option. Press 1 to snooze, press 2 to push, or press 0 to mark as done.")}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=main" timeout="10" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }

        // ── Sub-step: SNOOZE MINUTES ──
        if (step === "snooze") {
          const minutes = parseInt(rawDigits.replace(/\D/g, ""), 10);
          if (!isNaN(minutes) && minutes > 0 && minutes <= 1440) {
            const nextPingAt = Date.now() + minutes * 60 * 1000;
            await stub.fetch("http://do/reschedule", {
              method: "POST",
              body: JSON.stringify({ nextPingAt, status: "snoozed" })
            });
            await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt });
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(`Snoozed for ${minutes} minutes. Goodbye.`)}
  <Hangup/>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          } else {
            // Friendly error re-prompt
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Please enter a valid number of minutes between 1 and 1440, then press pound.")}
  <Gather finishOnKey="#" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=snooze" timeout="12" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          }
        }

        // ── Sub-step: PUSH TODAY vs TOMORROW ──
        if (step === "push-day") {
          if (rawDigits.startsWith("1")) {
            return handlePushTodayRoute(url, env, stub, reminderId, presets, userTz);
          }

          if (rawDigits.startsWith("2")) {
            return handlePushTomorrowPrompt(url, reminderId);
          }

          // Invalid input on push-day
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Invalid selection. Press 1 for today, or press 2 for tomorrow.")}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=push-day" timeout="10" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }

        // ── Sub-step: PUSH TODAY SELECT ──
        if (step === "push-today") {
          const slotsStr = url.searchParams.get("slots") || "morning,afternoon,evening,night";
          const availableSlots = slotsStr.split(",").filter(Boolean);
          const index = parseInt(rawDigits, 10) - 1;

          if (!isNaN(index) && index >= 0 && index < availableSlots.length) {
            const selectedSlot = availableSlots[index];
            const nextPingAt = getSlotTimestamp(selectedSlot, presets, userTz, false);

            await stub.fetch("http://do/reschedule", {
              method: "POST",
              body: JSON.stringify({ nextPingAt, status: "pushed" })
            });
            await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt });
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(`Pushed to today ${selectedSlot}. Goodbye.`)}
  <Hangup/>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          } else {
            // Re-prompt available options
            let optionsText = "";
            availableSlots.forEach((s, idx) => {
              optionsText += `Press ${idx + 1} for ${s}. `;
            });
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(`Invalid selection. ${optionsText}`)}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=push-today&amp;slots=${encodeURIComponent(slotsStr)}" timeout="10" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          }
        }

        // ── Sub-step: PUSH TOMORROW SELECT ──
        if (step === "push-tomorrow") {
          const tomorrowSlots = ["morning", "afternoon", "evening", "night"];
          const index = parseInt(rawDigits, 10) - 1;

          if (!isNaN(index) && index >= 0 && index < tomorrowSlots.length) {
            const selectedSlot = tomorrowSlots[index];
            const nextPingAt = getSlotTimestamp(selectedSlot, presets, userTz, true);

            await stub.fetch("http://do/reschedule", {
              method: "POST",
              body: JSON.stringify({ nextPingAt, status: "pushed" })
            });
            await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt });
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(`Pushed to tomorrow ${selectedSlot}. Goodbye.`)}
  <Hangup/>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          } else {
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Invalid selection. Press 1 for morning, 2 for afternoon, 3 for evening, or 4 for night.")}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=push-tomorrow" timeout="10" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          }
        }

        // Fallback for any unexpected step
        const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Returning to reminder menu.")}
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
        return new Response(fallbackTwiml, { headers: { "Content-Type": "text/xml" } });
      }

      // Route: POST /webhook
      if (url.pathname === "/webhook" && request.method === "POST") {
        return new Response("OK", { status: 200 });
      }

      return new Response("Not found", { status: 404, headers: corsHeaders });
    } catch (topLevelError: any) {
      console.error("Top-level Worker error:", topLevelError);
      if (isTwilioRoute) {
        // Always return valid TwiML so Twilio does not play a robotic error sound and hang up
        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Sorry, an error occurred while processing your request. Please try again later.")}
  <Hangup/>
</Response>`;
        return new Response(errorTwiml, { headers: { "Content-Type": "text/xml" } });
      }

      return new Response(JSON.stringify({ error: topLevelError?.message || "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

// ─── Helper Functions for Push Flow ──────────────────────────────────────────

function handlePushTodayRoute(
  url: URL,
  env: Env,
  stub: any,
  reminderId: string,
  presets: any,
  userTz: string
): Response {
  let localMinutes = 0;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: userTz || "America/Toronto",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [localHour, localMin] = formatter.format(new Date()).split(":").map(Number);
    localMinutes = (localHour || 0) * 60 + (localMin || 0);
  } catch {
    const d = new Date();
    localMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  const slotMinutesMap = (timeStr?: string) => {
    if (!timeStr) return 0;
    const [sh, sm] = timeStr.split(":").map(Number);
    return (sh || 0) * 60 + (sm || 0);
  };

  const slotsList = [
    { name: "morning", mins: slotMinutesMap(presets.morning) },
    { name: "afternoon", mins: slotMinutesMap(presets.afternoon) },
    { name: "evening", mins: slotMinutesMap(presets.evening) },
    { name: "night", mins: slotMinutesMap(presets.night) }
  ];

  const available = slotsList.filter(s => s.mins > localMinutes);

  if (available.length === 0) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Today's remaining options have all passed. Showing tomorrow's options.")}
  ${say("Press 1 for morning, 2 for afternoon, 3 for evening, or 4 for night.")}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=push-tomorrow" timeout="10" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
    return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
  } else {
    let optionsText = "";
    available.forEach((s, idx) => {
      optionsText += `Press ${idx + 1} for ${s.name}. `;
    });

    const slotsParam = available.map(a => a.name).join(",");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(optionsText)}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=push-today&amp;slots=${encodeURIComponent(slotsParam)}" timeout="10" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
    return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
  }
}

function handlePushTomorrowPrompt(url: URL, reminderId: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Press 1 for morning, 2 for afternoon, 3 for evening, or 4 for night.")}
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${encodeURIComponent(reminderId)}&amp;step=push-tomorrow" timeout="10" bargeIn="true">
  </Gather>
  <Redirect>${url.origin}/twiml?reminderId=${encodeURIComponent(reminderId)}</Redirect>
</Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

