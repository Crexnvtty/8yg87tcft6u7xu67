const store = require('./db');
const config = require('./config');
const { sendMessage } = require('./greenApi');

// ---------- Вспомогательные функции ----------

function formatDateHuman(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
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
      const iso = d.toISOString().slice(0, 10);
      dates.push(iso);
    }
  }
  return dates;
}

function generateSlotsForDate(dateStr) {
  const weekday = new Date(dateStr + 'T00:00:00').getDay();
  const hours = config.workingHours[weekday];
  if (!hours) return [];

  const slots = [];
  let [h, m] = hours.start.split(':').map(Number);
  const [endH, endM] = hours.end.split(':').map(Number);

  while (h < endH || (h === endH && m < endM)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += config.slotStepMinutes;
    if (m >= 60) { m -= 60; h += 1; }
  }

  const booked = store.getBookingsForDate(dateStr).map(b => b.time);
  return slots.filter(s => !booked.includes(s));
}

function buildScheduleText() {
  const bookings = store.getAllUpcomingBookings();
  if (bookings.length === 0) {
    return `📅 Записей пока нет.`;
  }
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

function mainMenuText() {
  return (
    `👋 *${config.businessName}*\n\n` +
    `Чем помочь?\n\n` +
    `1️⃣ Записаться на услугу\n` +
    `2️⃣ Мои записи\n` +
    `3️⃣ Отменить запись\n\n` +
    `_Просто отправьте цифру_`
  );
}

// ---------- Основной обработчик входящего сообщения ----------

function handleMessage(phone, rawText) {
  const text = (rawText || '').trim();
  const { step, data } = store.getState(phone);

  // Глобальная команда "меню" — всегда сбрасывает диалог
  if (/^(меню|menu|start|начать)$/i.test(text)) {
    store.resetState(phone);
    return mainMenuText();
  }

  // Админ-команда для мастера — доступна только с его номера
  if (/^(расписание|график|записи)$/i.test(text) && phone === config.masterChatId) {
    return buildScheduleText();
  }

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

    case 'cancel_choose':
      return handleCancelChoose(phone, text, data);

    default:
      store.resetState(phone);
      return mainMenuText();
  }
}

function handleMenu(phone, text) {
  if (text === '1') {
    const services = store.getServices();
    let msg = `💈 *Выберите услугу:*\n\n`;
    services.forEach((s, i) => {
      msg += `${i + 1}️⃣ ${s.name} — ${s.duration_min} мин, ${s.price}\n`;
    });
    msg += `\n_Отправьте номер услуги_`;
    store.setState(phone, 'choose_service', { services: services.map(s => s.id) });
    return msg;
  }

  if (text === '2') {
    const bookings = store.getUpcomingBookingsByPhone(phone);
    if (bookings.length === 0) return `У вас пока нет активных записей.\n\n` + mainMenuText();
    let msg = `📅 *Ваши записи:*\n\n`;
    bookings.forEach(b => {
      const service = store.getServiceById(b.service_id);
      msg += `• ${formatDateHuman(b.date)} в ${b.time} — ${service ? service.name : ''}\n`;
    });
    store.resetState(phone);
    return msg + `\n` + mainMenuText();
  }

  if (text === '3') {
    const bookings = store.getUpcomingBookingsByPhone(phone);
    if (bookings.length === 0) {
      store.resetState(phone);
      return `У вас нет активных записей для отмены.\n\n` + mainMenuText();
    }
    let msg = `❌ *Какую запись отменить?*\n\n`;
    bookings.forEach((b, i) => {
      const service = store.getServiceById(b.service_id);
      msg += `${i + 1}️⃣ ${formatDateHuman(b.date)} в ${b.time} — ${service ? service.name : ''}\n`;
    });
    store.setState(phone, 'cancel_choose', { bookingIds: bookings.map(b => b.id) });
    return msg + `\n_Отправьте номер записи_`;
  }

  return `Не поняла 🙂\n\n` + mainMenuText();
}

function handleChooseService(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.services.length) {
    return `Пожалуйста, отправьте номер услуги из списка выше.`;
  }
  const serviceId = data.services[idx];
  const dates = getAvailableDates();
  let msg = `📆 *Выберите дату:*\n\n`;
  dates.forEach((d, i) => {
    msg += `${i + 1}️⃣ ${formatDateHuman(d)}\n`;
  });
  msg += `\n_Отправьте номер даты_`;
  store.setState(phone, 'choose_date', { serviceId, dates });
  return msg;
}

function handleChooseDate(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.dates.length) {
    return `Пожалуйста, отправьте номер даты из списка выше.`;
  }
  const date = data.dates[idx];
  const slots = generateSlotsForDate(date);
  if (slots.length === 0) {
    return `К сожалению, на ${formatDateHuman(date)} свободных окон нет 😔\nВыберите другую дату (номер из списка выше).`;
  }
  let msg = `🕐 *Свободное время на ${formatDateHuman(date)}:*\n\n`;
  slots.forEach((s, i) => {
    msg += `${i + 1}️⃣ ${s}\n`;
  });
  msg += `\n_Отправьте номер времени_`;
  store.setState(phone, 'choose_time', { serviceId: data.serviceId, date, slots });
  return msg;
}

function handleChooseTime(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.slots.length) {
    return `Пожалуйста, отправьте номер времени из списка выше.`;
  }
  const time = data.slots[idx];
  store.setState(phone, 'ask_name', { serviceId: data.serviceId, date: data.date, time });
  return `Как вас записать? Напишите, пожалуйста, ваше имя.`;
}

function handleAskName(phone, text, data) {
  if (!text || text.length < 2) {
    return `Напишите, пожалуйста, имя (минимум 2 символа).`;
  }
  const service = store.getServiceById(data.serviceId);
  store.createBooking({
    phone,
    client_name: text,
    service_id: data.serviceId,
    date: data.date,
    time: data.time
  });
  store.resetState(phone);

  // Уведомляем мастера о новой записи (не блокируем ответ клиенту, если не получится)
  if (config.masterChatId && config.masterChatId !== phone) {
    const notifyText =
      `🔔 *Новая запись!*\n\n` +
      `${text}\n` +
      `${service ? service.name : ''}\n` +
      `${formatDateHuman(data.date)} в ${data.time}\n\n` +
      `_Напишите "расписание", чтобы увидеть все записи_`;
    sendMessage(config.masterChatId, notifyText).catch(() => {});
  }

  return (
    `✅ *Запись подтверждена!*\n\n` +
    `${service ? service.name : ''}\n` +
    `${formatDateHuman(data.date)} в ${data.time}\n\n` +
    `Мы пришлём напоминание накануне. До встречи, ${text}! 💈\n\n` +
    `_Напишите "меню" в любой момент, чтобы вернуться в начало_`
  );
}

function handleCancelChoose(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.bookingIds.length) {
    return `Пожалуйста, отправьте номер записи из списка выше.`;
  }
  store.cancelBooking(data.bookingIds[idx]);
  store.resetState(phone);
  return `Запись отменена ✅\n\n` + mainMenuText();
}

module.exports = { handleMessage, mainMenuText, formatDateHuman, buildScheduleText };
