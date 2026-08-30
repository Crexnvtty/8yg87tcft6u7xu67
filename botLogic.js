const store = require('./db');
const config = require('./config');
const { sendMessage } = require('./greenApi');
const adminLogic = require('./adminLogic');

// ---------- Тексты (только польский, для клиента) ----------

const T = {
  welcome: (name) =>
    `👋 Dzień dobry! Pomogę Ci umówić wizytę w *${name}* — szybko, bez dzwonienia.\n\n` +
    `1️⃣ Umów wizytę\n` +
    `2️⃣ Moje wizyty\n` +
    `3️⃣ Anuluj wizytę\n\n` +
    `_Wyślij cyfrę. Napisz "menu", aby tu wrócić._\n\n` +
    `📞 W sprawach niestandardowych: ${config.contactPhoneDisplay}`,
  chooseService: '💈 *Wybierz usługę:*',
  sendNumber: '_Wyślij numer z listy_',
  notUnderstood: 'Nie zrozumiałam 🙂',
  invalidNumber: 'Proszę wysłać numer z listy powyżej.',
  chooseDate: '📆 *Wybierz datę:*',
  noSlots: (d) => `Niestety, na ${d} nie ma wolnych terminów 😔\nWybierz inną datę (numer z listy powyżej).`,
  chooseTime: (d) => `🕐 *Wolne godziny na ${d}:*`,
  askName: 'Jak mam Cię zapisać? Proszę podać imię.',
  nameTooShort: 'Proszę podać imię (minimum 2 znaki).',
  bookingConfirmed: (service, d, time, name) =>
    `✅ *Wizyta potwierdzona!*\n\n${service}\n${d} o ${time}\n\n` +
    `Wyślemy przypomnienie dzień wcześniej. Do zobaczenia, ${name}! 💈\n\n` +
    `_Napisz "menu" w dowolnym momencie, aby wrócić na początek_`,
  myBookingsHeader: '📅 *Twoje wizyty:*',
  noBookings: 'Nie masz jeszcze żadnych aktywnych wizyt.',
  chooseBookingAction: '_Wyślij numer wizyty, aby ją zmienić lub anulować_',
  bookingActionMenu: (service, d, time) =>
    `Wizyta: ${service}\n${d} o ${time}\n\n1️⃣ Zmień termin\n2️⃣ Anuluj wizytę\n\n_Wyślij cyfrę_`,
  cancelled: 'Wizyta anulowana ✅',
  rescheduleChooseDate: '📆 *Wybierz nową datę:*',
  rescheduleChooseTime: (d) => `🕐 *Wolne godziny na ${d}:*`,
  rescheduled: (service, d, time) =>
    `✅ *Termin zmieniony!*\n\n${service}\n${d} o ${time}\n\n_Napisz "menu", aby wrócić na początek_`,
  pastBookingNoAction: 'Ta wizyta już minęła i nie można jej zmienić ani anulować.'
};

// ---------- Вспомогательные функции ----------

function formatDateHuman(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['nie', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm} (${days[d.getDay()]})`;
}

function getAvailableDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < config.daysAheadToShow + 5 && dates.length < config.daysAheadToShow; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const weekday = d.getDay();
    if (config.workingHours[weekday]) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateSlotsForDate(dateStr, durationMin, excludeBookingId = null) {
  const weekday = new Date(dateStr + 'T00:00:00').getDay();
  const hours = config.workingHours[weekday];
  if (!hours) return [];

  const startMin = toMinutes(hours.start);
  const endMin = toMinutes(hours.end);

  // Занятые интервалы — записи (с учётом длительности услуги) + ручные блокировки мастера
  const bookingIntervals = store.getBookingsForDate(dateStr)
    .filter(b => b.id !== excludeBookingId)
    .map(b => {
      const svc = store.getServiceById(b.service_id);
      const dur = svc ? svc.duration_min : config.slotStepMinutes;
      const s = toMinutes(b.time);
      return [s, s + dur];
    });

  const blockedIntervals = store.getBlockedSlotsForDate(dateStr)
    .map(bl => [toMinutes(bl.start_time), toMinutes(bl.end_time)]);

  const occupied = bookingIntervals.concat(blockedIntervals);

  const slots = [];
  for (let t = startMin; t + durationMin <= endMin; t += config.slotStepMinutes) {
    const slotEnd = t + durationMin;
    const overlaps = occupied.some(([os, oe]) => t < oe && slotEnd > os);
    if (!overlaps) slots.push(toHHMM(t));
  }
  return slots;
}

function buildScheduleText() {
  const bookings = store.getAllUpcomingBookings();
  if (bookings.length === 0) return `📅 Записей пока нет.`;
  let msg = `📅 *Ближайшие записи:*\n\n`;
  let lastDate = null;
  bookings.forEach(b => {
    if (b.date !== lastDate) {
      msg += `\n*${formatDateHuman(b.date)}*\n`;
      lastDate = b.date;
    }
    const service = store.getServiceById(b.service_id);
    msg += `  ${b.time} — ${b.client_name || 'без имени'} (${service ? service.name : ''})\n`;
  });
  return msg.trim();
}

function isPast(dateStr, timeStr) {
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return dt.getTime() < Date.now();
}

function isQuietHours() {
  const { start, end } = config.adminQuietHours;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin > endMin) {
    // Интервал через полночь, например 21:00–09:00
    return nowMin >= startMin || nowMin < endMin;
  }
  return nowMin >= startMin && nowMin < endMin;
}

function notifyAdmin(text) {
  if (!config.masterChatId) return;
  if (isQuietHours()) {
    store.addPendingNotification(text);
  } else {
    sendMessage(config.masterChatId, text).catch(() => {});
  }
}

// ---------- Основной обработчик входящего сообщения ----------

function handleMessage(phone, rawText) {
  const text = (rawText || '').trim();

  // Глобальная команда "меню" — работает всегда, включая выход из админ-панели
  if (/^(меню|menu|start|начать)$/i.test(text)) {
    store.resetState(phone);
    if (phone === config.masterChatId) {
      return `Вышли из панели администратора. Напишите "admin", чтобы вернуться.`;
    }
    return T.welcome(config.businessName);
  }

  // Админ-панель — доступна только с номера мастера, полностью отдельная логика
  if (phone === config.masterChatId) {
    if (adminLogic.isAdminTrigger(text) || adminLogic.isAdminActive(phone)) {
      return adminLogic.handleAdminMessage(phone, text);
    }
  }

  // Админ-команда "расписание" — короткий алиас, доступна только с номера мастера
  if (/^(расписание|график|записи|schedule)$/i.test(text) && phone === config.masterChatId) {
    return buildScheduleText();
  }

  const { step, data } = store.getState(phone);

  switch (step) {
    case 'menu':
      return handleMenu(phone, text);
    case 'choose_service':
      return handleChooseService(phone, text, data);
    case 'choose_date':
      return handleChooseDate(phone, text, data);
    case 'choose_time':
      return handleChooseTime(phone, text, data);
    case 'ask_name':
      return handleAskName(phone, text, data);
    case 'my_bookings_select':
      return handleMyBookingsSelect(phone, text, data);
    case 'quick_cancel_select':
      return handleQuickCancel(phone, text, data);
    case 'booking_action':
      return handleBookingAction(phone, text, data);
    case 'reschedule_choose_date':
      return handleRescheduleChooseDate(phone, text, data);
    case 'reschedule_choose_time':
      return handleRescheduleChooseTime(phone, text, data);
    default:
      store.resetState(phone);
      return T.welcome(config.businessName);
  }
}

function handleMenu(phone, text) {
  if (text === '1') {
    const services = store.getServices();
    let msg = `${T.chooseService}\n\n`;
    services.forEach((s, i) => {
      msg += `${i + 1}️⃣ ${s.name} — ${s.duration_min} min, ${s.price}\n`;
    });
    msg += `\n${T.sendNumber}`;
    store.setState(phone, 'choose_service', { services: services.map(s => s.id) });
    return msg;
  }

  if (text === '2') {
    const bookings = store.getUpcomingBookingsByPhone(phone);
    if (bookings.length === 0) {
      store.resetState(phone);
      return `${T.noBookings}\n\n` + T.welcome(config.businessName);
    }
    let msg = `${T.myBookingsHeader}\n\n`;
    bookings.forEach((b, i) => {
      const service = store.getServiceById(b.service_id);
      msg += `${i + 1}️⃣ ${formatDateHuman(b.date)} — ${b.time} — ${service ? service.name : ''}\n`;
    });
    msg += `\n${T.chooseBookingAction}`;
    store.setState(phone, 'my_bookings_select', { bookingIds: bookings.map(b => b.id) });
    return msg;
  }

  if (text === '3') {
    const bookings = store.getUpcomingBookingsByPhone(phone);
    if (bookings.length === 0) {
      store.resetState(phone);
      return `${T.noBookings}\n\n` + T.welcome(config.businessName);
    }
    let msg = `❌ *Którą wizytę anulować?*\n\n`;
    bookings.forEach((b, i) => {
      const service = store.getServiceById(b.service_id);
      msg += `${i + 1}️⃣ ${formatDateHuman(b.date)} — ${b.time} — ${service ? service.name : ''}\n`;
    });
    msg += `\n${T.sendNumber}`;
    store.setState(phone, 'quick_cancel_select', { bookingIds: bookings.map(b => b.id) });
    return msg;
  }

  return T.welcome(config.businessName);
}

function handleQuickCancel(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.bookingIds.length) return T.invalidNumber;
  const booking = store.getBookingById(data.bookingIds[idx]);
  if (!booking) {
    store.resetState(phone);
    return T.welcome(config.businessName);
  }
  const service = store.getServiceById(booking.service_id);
  store.cancelBooking(booking.id);
  store.resetState(phone);

  notifyAdmin(
    `⚠️ *Отмена записи*\n\n` +
    `${booking.client_name || 'Клиент'}\n${service ? service.name : ''}\n` +
    `${formatDateHuman(booking.date)} в ${booking.time}`
  );

  return `${T.cancelled}\n\n` + T.welcome(config.businessName);
}

function handleChooseService(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.services.length) return T.invalidNumber;
  const serviceId = data.services[idx];
  const dates = getAvailableDates();
  let msg = `${T.chooseDate}\n\n`;
  dates.forEach((d, i) => { msg += `${i + 1}️⃣ ${formatDateHuman(d)}\n`; });
  msg += `\n${T.sendNumber}`;
  store.setState(phone, 'choose_date', { serviceId, dates });
  return msg;
}

function handleChooseDate(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.dates.length) return T.invalidNumber;
  const date = data.dates[idx];
  const service = store.getServiceById(data.serviceId);
  const duration = service ? service.duration_min : config.slotStepMinutes;
  const slots = generateSlotsForDate(date, duration);
  if (slots.length === 0) return T.noSlots(formatDateHuman(date));
  let msg = `${T.chooseTime(formatDateHuman(date))}\n\n`;
  slots.forEach((s, i) => { msg += `${i + 1}️⃣ ${s}\n`; });
  msg += `\n${T.sendNumber}`;
  store.setState(phone, 'choose_time', { serviceId: data.serviceId, date, slots });
  return msg;
}

function handleChooseTime(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.slots.length) return T.invalidNumber;
  const time = data.slots[idx];
  store.setState(phone, 'ask_name', { serviceId: data.serviceId, date: data.date, time });
  return T.askName;
}

function handleAskName(phone, text, data) {
  if (!text || text.length < 2) return T.nameTooShort;
  const service = store.getServiceById(data.serviceId);
  store.createBooking({
    phone, client_name: text, service_id: data.serviceId, date: data.date, time: data.time
  });
  store.resetState(phone);

  notifyAdmin(
    `🔔 *Новая запись!*\n\n` +
    `${text}\n${service ? service.name : ''}\n` +
    `${formatDateHuman(data.date)} в ${data.time}\n\n` +
    `_Напишите "расписание" — все записи_`
  );

  return T.bookingConfirmed(service ? service.name : '', formatDateHuman(data.date), data.time, text);
}

function handleMyBookingsSelect(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.bookingIds.length) return T.invalidNumber;
  const bookingId = data.bookingIds[idx];
  const booking = store.getBookingById(bookingId);

  if (!booking || isPast(booking.date, booking.time)) {
    store.resetState(phone);
    return `${T.pastBookingNoAction}\n\n` + T.welcome(config.businessName);
  }

  const service = store.getServiceById(booking.service_id);
  store.setState(phone, 'booking_action', { bookingId });
  return T.bookingActionMenu(service ? service.name : '', formatDateHuman(booking.date), booking.time);
}

function handleBookingAction(phone, text, data) {
  const booking = store.getBookingById(data.bookingId);
  if (!booking) {
    store.resetState(phone);
    return T.welcome(config.businessName);
  }

  if (text === '1') {
    // Перенос — выбираем новую дату
    const dates = getAvailableDates();
    let msg = `${T.rescheduleChooseDate}\n\n`;
    dates.forEach((d, i) => { msg += `${i + 1}️⃣ ${formatDateHuman(d)}\n`; });
    msg += `\n${T.sendNumber}`;
    store.setState(phone, 'reschedule_choose_date', { bookingId: data.bookingId, dates });
    return msg;
  }

  if (text === '2') {
    const service = store.getServiceById(booking.service_id);
    store.cancelBooking(booking.id);
    store.resetState(phone);

    notifyAdmin(
      `⚠️ *Отмена записи*\n\n` +
      `${booking.client_name || 'Клиент'}\n${service ? service.name : ''}\n` +
      `${formatDateHuman(booking.date)} в ${booking.time}`
    );

    return `${T.cancelled}\n\n` + T.welcome(config.businessName);
  }

  return T.invalidNumber;
}

function handleRescheduleChooseDate(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.dates.length) return T.invalidNumber;
  const date = data.dates[idx];
  const booking = store.getBookingById(data.bookingId);
  const service = booking ? store.getServiceById(booking.service_id) : null;
  const duration = service ? service.duration_min : config.slotStepMinutes;
  const slots = generateSlotsForDate(date, duration, data.bookingId);
  if (slots.length === 0) return T.noSlots(formatDateHuman(date));
  let msg = `${T.rescheduleChooseTime(formatDateHuman(date))}\n\n`;
  slots.forEach((s, i) => { msg += `${i + 1}️⃣ ${s}\n`; });
  msg += `\n${T.sendNumber}`;
  store.setState(phone, 'reschedule_choose_time', { bookingId: data.bookingId, date, slots });
  return msg;
}

function handleRescheduleChooseTime(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.slots.length) return T.invalidNumber;
  const newTime = data.slots[idx];

  const booking = store.getBookingById(data.bookingId);
  const oldDate = booking.date;
  const oldTime = booking.time;
  const service = store.getServiceById(booking.service_id);

  store.updateBookingDateTime(data.bookingId, data.date, newTime);
  store.resetState(phone);

  notifyAdmin(
    `🔄 *Перенос записи*\n\n` +
    `${booking.client_name || 'Клиент'}\n${service ? service.name : ''}\n` +
    `Было: ${formatDateHuman(oldDate)} в ${oldTime}\n` +
    `Стало: ${formatDateHuman(data.date)} в ${newTime}`
  );

  return T.rescheduled(service ? service.name : '', formatDateHuman(data.date), newTime);
}

module.exports = { handleMessage, formatDateHuman, buildScheduleText };
