require('dotenv').config();
const cron = require('node-cron');
const twilio = require('twilio');
const store = require('./db');
const { formatDateHuman } = require('./botLogic') || {};

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // например "whatsapp:+14155238886"

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function sendReminders() {
  if (!client || !TWILIO_WHATSAPP_FROM) {
    console.log('[reminders] Twilio не настроен, пропускаю рассылку.');
    return;
  }

  const date = tomorrowISO();
  const bookings = store.getBookingsNeedingReminder(date);

  for (const b of bookings) {
    const service = store.getServiceById(b.service_id);
    const text =
      `⏰ Напоминание: завтра у вас запись\n` +
      `${service ? service.name : ''} в ${b.time}\n\n` +
      `Если планы изменились — напишите "меню" → "3" чтобы отменить.`;

    try {
      await client.messages.create({
        from: TWILIO_WHATSAPP_FROM,
        to: b.phone,
        body: text
      });
      store.markReminderSent(b.id);
      console.log(`[reminders] Отправлено напоминание ${b.phone} на ${b.date} ${b.time}`);
    } catch (err) {
      console.error(`[reminders] Ошибка отправки для ${b.phone}:`, err.message);
    }
  }
}

// Каждый день в 09:00 проверяем записи на завтра
cron.schedule('0 9 * * *', sendReminders);

module.exports = { sendReminders };
