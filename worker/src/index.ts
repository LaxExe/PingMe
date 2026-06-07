export interface Env {
  PINGME_SETTINGS: KVNamespace;
  REMINDER_SCHEDULER: DurableObjectNamespace;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  PINGME_SECRET: string;
}

// Helper to push actions to the sync queue in KV
async function pushSyncAction(env: Env, action: any) {
  const raw = await env.PINGME_SETTINGS.get("sync_queue");
  const queue = raw ? JSON.parse(raw) : [];
  queue.push(action);
  await env.PINGME_SETTINGS.put("sync_queue", JSON.stringify(queue));
}

// Time calculation helpers in user timezone
function getSlotTimestamp(slotName: string, presets: any, userTz: string, isTomorrow: boolean): number {
  const [h, m] = presets[slotName].split(":").map(Number);
  const now = new Date();
  
  // Format current date in user's timezone to get YYYY-MM-DD
  const dateStr = new Intl.DateTimeFormat("en-CA", { 
    timeZone: userTz, 
    year: "numeric", 
    month: "2-digit", 
    day: "2-digit" 
  }).format(now);
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  
  // Format offset in user's timezone to construct ISO string
  const tzOffsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: userTz,
    timeZoneName: "longOffset"
  });
  const offsetPart = tzOffsetFormatter.format(now).split(" ").pop() || "GMT";
  const offsetClean = offsetPart.replace("GMT", ""); // e.g. "-04:00" or "+05:30"
  
  let targetDate = new Date(`${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${offsetClean || 'Z'}`);
  
  if (isTomorrow) {
    targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  }
  
  return targetDate.getTime();
}

function calculateNextPingAt(currentPingAt: number, recurrence: 'none' | 'daily' | 'weekly' | number): number | null {
  if (!recurrence || recurrence === 'none') return null;
  const now = Date.now();
  let next = currentPingAt;
  let interval = 0;
  
  if (recurrence === 'daily') {
    interval = 24 * 60 * 60 * 1000;
  } else if (recurrence === 'weekly') {
    interval = 7 * 24 * 60 * 60 * 1000;
  } else if (typeof recurrence === 'number') {
    interval = recurrence * 60 * 1000;
  }
  
  if (interval <= 0) return null;
  while (next <= now) {
    next += interval;
  }
  return next;
}

// ─── Durable Object: ReminderScheduler ───────────────────────────────────────

export class ReminderScheduler {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/schedule" && request.method === "POST") {
      const data: any = await request.json();
      await this.state.storage.put("reminderId", data.reminderId);
      await this.state.storage.put("reminderText", data.reminderText);
      await this.state.storage.put("nextPingAt", data.nextPingAt);
      await this.state.storage.put("recurrence", data.recurrence || "none");
      await this.state.storage.put("workerUrl", data.workerUrl);
      await this.state.storage.put("attemptCount", 0);
      await this.state.storage.put("status", "pending");

      await this.state.storage.setAlarm(data.nextPingAt);
      return new Response("Scheduled");
    }

    if (url.pathname === "/schedule" && request.method === "DELETE") {
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      return new Response("Canceled");
    }

    if (url.pathname === "/info" && request.method === "GET") {
      const reminderText = await this.state.storage.get("reminderText");
      const recurrence = await this.state.storage.get("recurrence");
      return new Response(JSON.stringify({ reminderText, recurrence }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/reschedule" && request.method === "POST") {
      const data: any = await request.json();
      await this.state.storage.put("nextPingAt", data.nextPingAt);
      await this.state.storage.put("status", data.status);
      await this.state.storage.put("attemptCount", 0);
      await this.state.storage.setAlarm(data.nextPingAt);
      return new Response("Rescheduled");
    }

    if (url.pathname === "/done" && request.method === "POST") {
      const recurrence: any = await this.state.storage.get("recurrence") || "none";
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
  }

  async alarm() {
    const reminderId = await this.state.storage.get("reminderId") as string;
    const reminderText = await this.state.storage.get("reminderText") as string;
    const workerUrl = await this.state.storage.get("workerUrl") as string;
    let attemptCount = (await this.state.storage.get("attemptCount") as number) || 0;

    // Load settings to fetch phoneNumber and reping interval
    const rawSettings = await this.env.PINGME_SETTINGS.get("settings");
    const settings = rawSettings ? JSON.parse(rawSettings) : null;
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
      params.append("Url", `${workerUrl}/twiml?reminderId=${reminderId}`);
      params.append("StatusCallback", `${workerUrl}/webhook?reminderId=${reminderId}`);
      params.append("StatusCallbackEvent", "completed");

      const response = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error(`Twilio API returned error (status ${response.status}): ${errText}`);
      } else {
        console.log(`Successfully triggered Twilio call. Status: ${response.status}`);
      }
    } catch (e) {
      console.error("Failed to trigger Twilio outbound call due to network/fetch error:", e);
    }

    attemptCount++;
    await this.state.storage.put("attemptCount", attemptCount);
    await pushSyncAction(this.env, { type: "attemptIncremented", reminderId, attemptCount });

    // Fallback re-ping interval (in minutes)
    const repingInterval = settings.repingIntervalMinutes || 10;
    const nextPingAt = Date.now() + repingInterval * 60 * 1000;
    await this.state.storage.put("nextPingAt", nextPingAt);
    await this.state.storage.setAlarm(nextPingAt);
  }
}

// ─── Worker Routing & Logic ──────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Dynamic CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-PingMe-Secret"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Determine if request is from Twilio or is a test call
    const isTestCallRoute = url.pathname === "/test-call";
    const isTwilioRoute = url.pathname.startsWith("/twiml") || url.pathname === "/webhook" || isTestCallRoute;

    if (!isTwilioRoute) {
      // Frontend Authenticated requests
      const secret = request.headers.get("X-PingMe-Secret");
      if (secret !== env.PINGME_SECRET) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }
    }

    // Route: POST /schedule
    if (url.pathname === "/schedule" && request.method === "POST") {
      const data: any = await request.json();
      const id = env.REMINDER_SCHEDULER.idFromName(data.reminderId);
      const stub = env.REMINDER_SCHEDULER.get(id);

      // Pass the request along with the worker origin to the DO
      const payload = {
        ...data,
        workerUrl: url.origin
      };

      await stub.fetch("http://do/schedule", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      return new Response("Scheduled", { headers: corsHeaders });
    }

    // Route: DELETE /schedule/:id
    if (url.pathname.startsWith("/schedule/") && request.method === "DELETE") {
      const parts = url.pathname.split("/");
      const reminderId = parts[parts.length - 1];
      const id = env.REMINDER_SCHEDULER.idFromName(reminderId);
      const stub = env.REMINDER_SCHEDULER.get(id);

      await stub.fetch("http://do/schedule", { method: "DELETE" });
      return new Response("Canceled", { headers: corsHeaders });
    }

    // Route: GET /test-call
    if (url.pathname === "/test-call" && request.method === "GET") {
      const secret = url.searchParams.get("secret") || request.headers.get("X-PingMe-Secret");
      if (secret !== env.PINGME_SECRET) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

      const rawSettings = await env.PINGME_SETTINGS.get("settings");
      const settings = rawSettings ? JSON.parse(rawSettings) : null;
      if (!settings || !settings.phoneNumber) {
        return new Response("Missing phone number in settings", { status: 400, headers: corsHeaders });
      }

      try {
        const basicAuth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`;

        const params = new URLSearchParams();
        params.append("To", settings.phoneNumber);
        params.append("From", env.TWILIO_PHONE_NUMBER);
        params.append("Url", "http://demo.twilio.com/docs/voice.xml");

        const response = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params.toString()
        });

        const status = response.status;
        const text = await response.text();

        return new Response(JSON.stringify({ success: response.ok, status, response: text }), {
          status: response.ok ? 200 : 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // Route: GET /sync
    if (url.pathname === "/sync" && request.method === "GET") {
      const raw = await env.PINGME_SETTINGS.get("sync_queue");
      const actions = raw ? JSON.parse(raw) : [];
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
      return new Response("Saved", { headers: corsHeaders });
    }

    // Route: POST /settings
    if (url.pathname === "/settings" && request.method === "POST") {
      const settings = await request.json();
      await env.PINGME_SETTINGS.put("settings", JSON.stringify(settings));
      return new Response("Saved", { headers: corsHeaders });
    }

    // ─── Twilio Call Flow endpoints ──────────────────────────────────────────

    // Route: POST /twiml
    if (url.pathname === "/twiml" && request.method === "POST") {
      const reminderId = url.searchParams.get("reminderId") || "";
      const id = env.REMINDER_SCHEDULER.idFromName(reminderId);
      const stub = env.REMINDER_SCHEDULER.get(id);

      const infoRes = await stub.fetch("http://do/info");
      const { reminderText } = await infoRes.json() as any;

      const rawSettings = await env.PINGME_SETTINGS.get("settings");
      const settings = rawSettings ? JSON.parse(rawSettings) : null;
      const name = settings?.name || "friend";

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hi ${name}, you have a reminder: ${reminderText || "PingMe scheduled task"}.</Say>
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=main" timeout="15">
    <Say>Press 1 to snooze, press 2 to push to later, press 0 to mark as done.</Say>
  </Gather>
  <Say>Sorry, I didn't catch that.</Say>
  <Redirect>${url.origin}/twiml?reminderId=${reminderId}</Redirect>
</Response>`;

      return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
    }

    // Route: POST /twiml/gather
    if (url.pathname === "/twiml/gather" && request.method === "POST") {
      const reminderId = url.searchParams.get("reminderId") || "";
      const step = url.searchParams.get("step") || "main";
      
      const formData = await request.formData();
      const digits = formData.get("Digits")?.toString() || "";

      const id = env.REMINDER_SCHEDULER.idFromName(reminderId);
      const stub = env.REMINDER_SCHEDULER.get(id);

      const rawSettings = await env.PINGME_SETTINGS.get("settings");
      const settings = rawSettings ? JSON.parse(rawSettings) : null;
      const presets = settings?.presets || { morning: "08:00", afternoon: "13:00", evening: "18:00", night: "21:00" };
      const userTz = settings?.timezone || "America/Toronto";

      // Sub-step: main menu
      if (step === "main") {
        if (digits === "0") {
          // Done
          const res = await stub.fetch("http://do/done", { method: "POST" });
          const status = await res.json() as any;
          
          if (status.rescheduled) {
            await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt: status.nextPingAt });
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Done. Next occurrence scheduled. Goodbye.</Say>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          } else {
            await pushSyncAction(env, { type: "done", reminderId });
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Done. Reminder deleted. Goodbye.</Say>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          }
        }

        if (digits === "1") {
          // Snooze
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>How many minutes? Enter 1 to 3 digits then press hash.</Say>
  <Gather finishOnKey="#" action="${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=snooze" timeout="15">
  </Gather>
  <Say>Sorry, didn't catch that.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=main&amp;Digits=1</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }

        if (digits === "2") {
          // Push later
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Press 1 for today, press 2 for tomorrow.</Say>
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-day" timeout="15">
  </Gather>
  <Say>Sorry, didn't catch that.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=main&amp;Digits=2</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }
      }

      // Sub-step: Custom snooze minutes
      if (step === "snooze") {
        const minutes = parseInt(digits);
        if (!isNaN(minutes) && minutes > 0) {
          const nextPingAt = Date.now() + minutes * 60 * 1000;
          await stub.fetch("http://do/reschedule", {
            method: "POST",
            body: JSON.stringify({ nextPingAt, status: "snoozed" })
          });
          await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt });
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Snoozed for ${minutes} minutes. Goodbye.</Say>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        } else {
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Invalid minutes.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=main&amp;Digits=1</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }
      }

      // Sub-step: Choose Today vs Tomorrow
      if (step === "push-day") {
        if (digits === "1") {
          // Today options (time-aware)
          const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: userTz,
            hour12: false,
            hour: "2-digit",
            minute: "2-digit"
          });
          const [localHour, localMin] = formatter.format(new Date()).split(":").map(Number);
          const localMinutes = localHour * 60 + localMin;

          const slotMinutesMap = (timeStr: string) => {
            const [sh, sm] = timeStr.split(":").map(Number);
            return sh * 60 + sm;
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
  <Say>Tonight's options have all passed. Showing tomorrow's options.</Say>
  <Say>Press 1 morning, 2 afternoon, 3 evening, 4 night.</Say>
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-tomorrow" timeout="15">
  </Gather>
  <Say>Sorry, didn't catch that.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-day&amp;Digits=2</Redirect>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          } else {
            let optionsText = "";
            available.forEach((s, idx) => {
              optionsText += `Press ${idx + 1} for ${s.name}. `;
            });

            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${optionsText}</Say>
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-today&amp;slots=${available.map(a => a.name).join(",")}" timeout="15">
  </Gather>
  <Say>Sorry, didn't catch that.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-day&amp;Digits=1</Redirect>
</Response>`;
            return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
          }
        }

        if (digits === "2") {
          // Tomorrow options (always all 4)
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Press 1 morning, 2 afternoon, 3 evening, 4 night.</Say>
  <Gather numDigits="1" action="${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-tomorrow" timeout="15">
  </Gather>
  <Say>Sorry, didn't catch that.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-day&amp;Digits=2</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }
      }

      // Sub-step: push today select
      if (step === "push-today") {
        const slotsStr = url.searchParams.get("slots") || "";
        const availableSlots = slotsStr.split(",");
        const index = parseInt(digits) - 1;

        if (index >= 0 && index < availableSlots.length) {
          const selectedSlot = availableSlots[index];
          const nextPingAt = getSlotTimestamp(selectedSlot, presets, userTz, false);
          
          await stub.fetch("http://do/reschedule", {
            method: "POST",
            body: JSON.stringify({ nextPingAt, status: "pushed" })
          });
          await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt });
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Pushed to today ${selectedSlot}. Goodbye.</Say>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        } else {
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Invalid option.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-day&amp;Digits=1</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }
      }

      // Sub-step: push tomorrow select
      if (step === "push-tomorrow") {
        const tomorrowSlots = ["morning", "afternoon", "evening", "night"];
        const index = parseInt(digits) - 1;

        if (index >= 0 && index < tomorrowSlots.length) {
          const selectedSlot = tomorrowSlots[index];
          const nextPingAt = getSlotTimestamp(selectedSlot, presets, userTz, true);
          
          await stub.fetch("http://do/reschedule", {
            method: "POST",
            body: JSON.stringify({ nextPingAt, status: "pushed" })
          });
          await pushSyncAction(env, { type: "rescheduled", reminderId, nextPingAt });
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Pushed to tomorrow ${selectedSlot}. Goodbye.</Say>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        } else {
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Invalid option.</Say>
  <Redirect>${url.origin}/twiml/gather?reminderId=${reminderId}&amp;step=push-day&amp;Digits=2</Redirect>
</Response>`;
          return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
        }
      }
    }

    // Route: POST /webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      // Twilio Call Status callback — simply log and return OK
      return new Response("OK", { status: 200 });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  }
};
