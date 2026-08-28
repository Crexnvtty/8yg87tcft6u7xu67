require('dotenv').config();
const cron = require('node-cron');
const store = require('./db');
const config = require('./config');
const { sendMessage, isConfigured } = require('./greenApi');

function diffMinutes(dateStr, timeStr) {
  const appt = new Date(`${dateStr}T${timeStr}:00`);
  return Math.round((appt.getTime() - Date.now()) / 60000);
}

function formatDateHuman(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['nie', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm} (${days[d.getDay()]})`;
}

async function checkReminders() {
  if (!isConfigured()) {
    console.log('[reminders] Green API не настроен, пропускаю проверку.');
    return;
  }

  const bookings = store.getBookingsForReminderCheck();

  for (const b of bookings) {
    const minutesLeft = diffMinutes(b.date, b.time);
    if (minutesLeft <= 0) continue; // уже прошло или прямо сейчас — не шлём

    const service = store.getServiceById(b.service_id);
    const serviceName = service ? service.name : '';

    // Напоминание за ~24 часа (шлём, если осталось от 60 минут до 24 часов и ещё не отправляли)
    if (!b.reminder_sent && minutesLeft <= 24 * 60 && minutesLeft > 60) {
      const text =
        `⏰ Przypomnienie: masz wizytę *jutro*, ${formatDateHuman(b.date)} o ${b.time}` +
        (serviceName ? ` (${serviceName})` : '') +
        `.\n\n${config.businessName}`;
      try {
        await sendMessage(b.phone, text);
        store.markReminder24hSent(b.id);
        console.log(`[reminders 24h] Отправлено ${b.phone} на ${b.date} ${b.time}`);
      } catch (err) {
        console.error(`[reminders 24h] Ошибка для ${b.phone}:`, err.message);
      }
    }

    // Напоминание за ~2 часа (шлём, если осталось до 2 часов и ещё не отправляли)
    if (!b.reminder_2h_sent && minutesLeft <= 120) {
      const text =
        `⏰ Przypomnienie: wizyta *za około 2 godziny*, dziś o ${b.time}` +
        (serviceName ? ` (${serviceName})` : '') +
        `.\n\nDo zobaczenia! 💈 ${config.businessName}`;
      try {
        await sendMessage(b.phone, text);
        store.markReminder2hSent(b.id);
        console.log(`[reminders 2h] Отправлено ${b.phone} на ${b.date} ${b.time}`);
      } catch (err) {
        console.error(`[reminders 2h] Ошибка для ${b.phone}:`, err.message);
      }
    }
  }
}

async function checkWinback() {
  if (!isConfigured()) return;

  const bookings = store.getBookingsForWinback();

  for (const b of bookings) {
    // Не беспокоим тех, кто уже записался снова
    const upcoming = store.getUpcomingBookingsByPhone(b.phone);
    if (upcoming.length > 0) {
      store.markWinbackSent(b.id);
      continue;
    }

    const text =
      `👋 Cześć! Minął miesiąc od Twojej ostatniej wizyty w *${config.businessName}* 💇\n\n` +
      `Może czas na odświeżenie fryzury? Napisz "menu", żeby się szybko umówić 😊`;

    try {
      await sendMessage(b.phone, text);
      store.markWinbackSent(b.id);
      console.log(`[winback] Отправлено ${b.phone}`);
    } catch (err) {
      console.error(`[winback] Ошибка для ${b.phone}:`, err.message);
    }
  }
}

// Проверяем каждые 15 минут — так оба напоминания (24ч и 2ч) срабатывают
// достаточно точно, без отдельного процесса на каждую запись
cron.schedule('*/15 * * * *', checkReminders);

// Win-back проверяем раз в день — этого достаточно, месяц это не срочный интервал
cron.schedule('0 11 * * *', checkWinback);

module.exports = { checkReminders, checkWinback };
