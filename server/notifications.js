import { pool } from "./db.js";

const graphUrl = () => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v22.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

function render(text, payload) {
  return text.replace(/{{\s*([\w.]+)\s*}}/g, (_match, key) => String(payload[key] ?? ""));
}

export async function queueWhatsAppEvent({ studentId, event, payload, idempotencyKey }) {
  const template = await pool.query("select id, message from whatsapp_templates where event=$1 and active=true order by created_at desc limit 1", [event]);
  if (!template.rows[0]) throw Object.assign(new Error(`No active WhatsApp template configured for ${event}.`), { status: 422 });
  const message = render(template.rows[0].message, payload);
  await pool.query("insert into notifications (student_id, event, channel, template_id, message, status, idempotency_key, payload) values ($1,$2,'WHATSAPP',$3,$4,'PENDING',$5,$6) on conflict (idempotency_key) do nothing", [studentId, event, template.rows[0].id, message, idempotencyKey, payload]);
}

export async function dispatchPendingWhatsApp(limit = 50) {
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) throw new Error("WhatsApp Cloud API credentials are not configured.");
  const result = await pool.query(`select n.*, u.phone, t.provider_template_id, t.name as template_name, t.language, t.variables
    from notifications n join users u on u.id=n.student_id join whatsapp_templates t on t.id=n.template_id
    where n.channel='WHATSAPP' and n.status='PENDING' and n.retry_count < 3 order by n.id limit $1`, [limit]);
  const outcomes = [];
  for (const notification of result.rows) {
    const parameters = (notification.variables || []).map((name) => ({ type: "text", text: String(notification.payload?.[name] ?? "") }));
    const body = { messaging_product: "whatsapp", to: notification.phone.replace(/\D/g, ""), type: "template", template: { name: notification.provider_template_id || notification.template_name, language: { code: notification.language }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) } };
    try {
      const response = await fetch(graphUrl(), { method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "WhatsApp provider rejected the message.");
      await pool.query("update notifications set status='SENT', provider_reference=$2, provider_response=$3, sent_at=now() where id=$1", [notification.id, data.messages?.[0]?.id ?? null, data]);
      outcomes.push({ id: notification.id, status: "SENT" });
    } catch (error) {
      await pool.query("update notifications set retry_count=retry_count+1, status=case when retry_count+1 >= 3 then 'FAILED' else 'PENDING' end, failure_reason=$2 where id=$1", [notification.id, error instanceof Error ? error.message : "WhatsApp send failed"]);
      outcomes.push({ id: notification.id, status: "RETRY" });
    }
  }
  return outcomes;
}
