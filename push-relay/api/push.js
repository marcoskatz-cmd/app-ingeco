/**
 * Relay de Web Push para el backend de la app INGECO.
 * Apps Script no puede firmar VAPID (ECDSA P-256) ni cifrar el payload, así que lo hace esta función.
 *
 * Variables de entorno en Vercel:
 *   RELAY_SECRET       — mismo valor que PUSH_RELAY_SECRET en el Apps Script
 *   VAPID_PUBLIC_KEY   — generar con: npx web-push generate-vapid-keys
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT      — mailto:marcoskatz@grupoingeco.com.ar
 *
 * Body: { suscripcion: {endpoint, keys:{p256dh, auth}}, mensaje: {id, titulo, cuerpo, url, modulo, prioridad} }
 * Respuesta: { ok:true } | { ok:false, status, error }  (status 404/410 = suscripción caída)
 */
import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:marcoskatz@grupoingeco.com.ar',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!process.env.RELAY_SECRET || req.headers['x-relay-secret'] !== process.env.RELAY_SECRET) {
    return res.status(401).json({ ok: false, error: 'secreto inválido' });
  }
  const { suscripcion, mensaje } = req.body || {};
  if (!suscripcion?.endpoint || !suscripcion?.keys?.p256dh || !suscripcion?.keys?.auth) {
    return res.status(400).json({ ok: false, error: 'suscripción incompleta' });
  }
  try {
    await webpush.sendNotification(suscripcion, JSON.stringify(mensaje || {}), {
      TTL: 60 * 60 * 24,
      urgency: mensaje?.prioridad === 'critica' ? 'high' : 'normal'
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, status: e.statusCode || 0, error: String(e.body || e.message || e) });
  }
}
