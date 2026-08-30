const store = require('./db');
const config = require('./config');

// Админ-панель работает на русском (для тебя как оператора).
// Если в будущем администратором станет сам мастер — тексты стоит перевести.

function formatDateHuman(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm} (${days[d.getDay()]})`;
}

function isValidTime(str) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
}

function getAvailableDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < config.daysAheadToShow + 5 && dates.length < config.daysAheadToShow; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const ADMIN_MENU =
  `🔧 *Панель администратора*\n\n` +
  `1️⃣ Расписание (все записи)\n` +
  `2️⃣ Заблокировать время\n` +
  `3️⃣ Разблокировать время\n` +
  `4️⃣ Услуги и цены\n` +
  `5️⃣ Добавить запись вручную\n\n` +
  `_Отправьте цифру. "admin" — вернуться сюда, "menu" — выйти из панели_`;

function isAdminTrigger(text) {
  return /^(admin|panel|панель|админ)$/i.test(text.trim());
}

function isAdminActive(phone) {
  const { step } = store.getState(phone);
  return step && step.startsWith('admin_');
}

function handleAdminMessage(phone, text) {
  const trimmed = text.trim();

  if (isAdminTrigger(trimmed)) {
    store.setState(phone, 'admin_menu', {});
    return ADMIN_MENU;
  }

  const { step, data } = store.getState(phone);

  switch (step) {
    case 'admin_menu': return handleAdminMenu(phone, trimmed);

    case 'admin_block_date': return handleBlockDate(phone, trimmed, data);
    case 'admin_block_start': return handleBlockStart(phone, trimmed, data);
    case 'admin_block_end': return handleBlockEnd(phone, trimmed, data);
    case 'admin_block_reason': return handleBlockReason(phone, trimmed, data);

    case 'admin_unblock_list': return handleUnblockList(phone, trimmed, data);

    case 'admin_services_menu': return handleServicesMenu(phone, trimmed, data);
    case 'admin_service_selected': return handleServiceSelected(phone, trimmed, data);
    case 'admin_service_edit_price': return handleServiceEditPrice(phone, trimmed, data);
    case 'admin_service_edit_duration': return handleServiceEditDuration(phone, trimmed, data);
    case 'admin_service_new_name': return handleServiceNewName(phone, trimmed, data);
    case 'admin_service_new_price': return handleServiceNewPrice(phone, trimmed, data);
    case 'admin_service_new_duration': return handleServiceNewDuration(phone, trimmed, data);

    case 'admin_manual_choose_service': return handleManualChooseService(phone, trimmed, data);
    case 'admin_manual_choose_date': return handleManualChooseDate(phone, trimmed, data);
    case 'admin_manual_choose_time': return handleManualChooseTime(phone, trimmed, data);
    case 'admin_manual_ask_name': return handleManualAskName(phone, trimmed, data);

    default:
      store.setState(phone, 'admin_menu', {});
      return ADMIN_MENU;
  }
}

// ---------- Главное меню ----------

function handleAdminMenu(phone, text) {
  if (text === '1') {
    const bookings = store.getAllUpcomingBookings();
    if (bookings.length === 0) {
      return `📅 Записей пока нет.\n\n` + ADMIN_MENU;
    }
    let msg = `📅 *Ближайшие записи:*\n\n`;
    let lastDate = null;
    bookings.forEach(b => {
      if (b.date !== lastDate) { msg += `\n*${formatDateHuman(b.date)}*\n`; lastDate = b.date; }
      const service = store.getServiceById(b.service_id);
      msg += `  ${b.time} — ${b.client_name || 'без имени'} (${service ? service.name : ''})\n`;
    });
    return msg.trim() + `\n\n` + ADMIN_MENU;
  }

  if (text === '2') {
    const dates = getAvailableDates();
    let msg = `📆 *На какую дату заблокировать время?*\n\n`;
    dates.forEach((d, i) => { msg += `${i + 1}️⃣ ${formatDateHuman(d)}\n`; });
    msg += `\n_Отправьте номер даты_`;
    store.setState(phone, 'admin_block_date', { dates });
    return msg;
  }

  if (text === '3') {
    const blocks = store.getUpcomingBlockedSlots();
    if (blocks.length === 0) {
      return `🔓 Заблокированных промежутков нет.\n\n` + ADMIN_MENU;
    }
    let msg = `🔓 *Какую блокировку снять?*\n\n`;
    blocks.forEach((b, i) => {
      msg += `${i + 1}️⃣ ${formatDateHuman(b.date)} ${b.start_time}–${b.end_time}${b.reason ? ' (' + b.reason + ')' : ''}\n`;
    });
    msg += `\n_Отправьте номер_`;
    store.setState(phone, 'admin_unblock_list', { blockIds: blocks.map(b => b.id) });
    return msg;
  }

  if (text === '4') {
    return servicesMenuText();
  }

  if (text === '5') {
    const services = store.getServices();
    if (services.length === 0) return `Нет активных услуг.\n\n` + ADMIN_MENU;
    let msg = `💈 *Выберите услугу для записи:*\n\n`;
    services.forEach((s, i) => { msg += `${i + 1}️⃣ ${s.name} — ${s.duration_min} мин, ${s.price}\n`; });
    msg += `\n_Отправьте номер_`;
    store.setState(phone, 'admin_manual_choose_service', { services: services.map(s => s.id) });
    return msg;
  }

  return ADMIN_MENU;
}

// ---------- Блокировка времени ----------

function handleBlockDate(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.dates.length) return `Отправьте номер даты из списка.`;
  const date = data.dates[idx];
  store.setState(phone, 'admin_block_start', { date });
  return `Со скольки заблокировать? Формат ЧЧ:ММ, например 14:00`;
}

function handleBlockStart(phone, text, data) {
  if (!isValidTime(text)) return `Неверный формат. Пример: 14:00`;
  store.setState(phone, 'admin_block_end', { date: data.date, start: text });
  return `До скольки? Формат ЧЧ:ММ, например 16:00`;
}

function handleBlockEnd(phone, text, data) {
  if (!isValidTime(text)) return `Неверный формат. Пример: 16:00`;
  if (text <= data.start) return `Время окончания должно быть позже начала.`;
  store.setState(phone, 'admin_block_reason', { date: data.date, start: data.start, end: text });
  return `Причина (необязательно)? Напишите текст или "-", чтобы пропустить`;
}

function handleBlockReason(phone, text, data) {
  const reason = text === '-' ? null : text;
  store.addBlockedSlot(data.date, data.start, data.end, reason);
  store.setState(phone, 'admin_menu', {});
  return (
    `✅ Заблокировано: ${formatDateHuman(data.date)} ${data.start}–${data.end}` +
    (reason ? ` (${reason})` : '') + `\n\n` + ADMIN_MENU
  );
}

// ---------- Разблокировка ----------

function handleUnblockList(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.blockIds.length) return `Отправьте номер из списка.`;
  store.removeBlockedSlot(data.blockIds[idx]);
  store.setState(phone, 'admin_menu', {});
  return `✅ Блокировка снята.\n\n` + ADMIN_MENU;
}

// ---------- Услуги и цены ----------

function servicesMenuText() {
  const services = store.getAllServicesForAdmin();
  let msg = `💈 *Услуги:*\n\n`;
  services.forEach((s, i) => {
    const status = s.active ? '' : ' (выключена)';
    msg += `${i + 1}️⃣ ${s.name} — ${s.duration_min} мин, ${s.price}${status}\n`;
  });
  msg += `\n_Отправьте номер услуги, чтобы изменить, или "новая" — добавить услугу_`;
  return msg;
}

function handleServicesMenu(phone, text) {
  if (/^нов[а-я]*$/i.test(text)) {
    store.setState(phone, 'admin_service_new_name', {});
    return `Название новой услуги?`;
  }
  const services = store.getAllServicesForAdmin();
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= services.length) {
    return servicesMenuText();
  }
  const service = services[idx];
  store.setState(phone, 'admin_service_selected', { serviceId: service.id });
  return (
    `${service.name} — ${service.duration_min} мин, ${service.price}${service.active ? '' : ' (выключена)'}\n\n` +
    `1️⃣ Изменить цену\n2️⃣ Изменить длительность\n3️⃣ ${service.active ? 'Выключить' : 'Включить'} услугу\n\n_Отправьте цифру_`
  );
}

function handleServiceSelected(phone, text, data) {
  const service = store.getServiceById(data.serviceId);
  if (!service) { store.setState(phone, 'admin_services_menu', {}); return servicesMenuText(); }

  if (text === '1') {
    store.setState(phone, 'admin_service_edit_price', { serviceId: service.id });
    return `Новая цена? (например "90 zł")`;
  }
  if (text === '2') {
    store.setState(phone, 'admin_service_edit_duration', { serviceId: service.id });
    return `Новая длительность в минутах? (например 60)`;
  }
  if (text === '3') {
    store.setServiceActive(service.id, !service.active);
    store.setState(phone, 'admin_services_menu', {});
    return `✅ Готово.\n\n` + servicesMenuText();
  }
  return `Отправьте 1, 2 или 3.`;
}

function handleServiceEditPrice(phone, text, data) {
  store.updateServicePrice(data.serviceId, text);
  store.setState(phone, 'admin_services_menu', {});
  return `✅ Цена обновлена.\n\n` + servicesMenuText();
}

function handleServiceEditDuration(phone, text, data) {
  const min = parseInt(text, 10);
  if (isNaN(min) || min <= 0) return `Введите число минут, например 60`;
  store.updateServiceDuration(data.serviceId, min);
  store.setState(phone, 'admin_services_menu', {});
  return `✅ Длительность обновлена.\n\n` + servicesMenuText();
}

function handleServiceNewName(phone, text) {
  if (!text || text.length < 2) return `Введите название услуги`;
  store.setState(phone, 'admin_service_new_price', { name: text });
  return `Цена? (например "90 zł")`;
}

function handleServiceNewPrice(phone, text, data) {
  store.setState(phone, 'admin_service_new_duration', { name: data.name, price: text });
  return `Длительность в минутах?`;
}

function handleServiceNewDuration(phone, text, data) {
  const min = parseInt(text, 10);
  if (isNaN(min) || min <= 0) return `Введите число минут, например 60`;
  store.addService(data.name, min, data.price);
  store.setState(phone, 'admin_services_menu', {});
  return `✅ Услуга добавлена.\n\n` + servicesMenuText();
}

// ---------- Ручное создание записи ----------

function toMinutes(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function toHHMM(t) { const h = Math.floor(t / 60), m = t % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

function generateSlotsForDate(dateStr, durationMin) {
  const weekday = new Date(dateStr + 'T00:00:00').getDay();
  const hours = config.workingHours[weekday];
  if (!hours) return [];
  const startMin = toMinutes(hours.start), endMin = toMinutes(hours.end);

  const bookingIntervals = store.getBookingsForDate(dateStr).map(b => {
    const svc = store.getServiceById(b.service_id);
    const dur = svc ? svc.duration_min : config.slotStepMinutes;
    const s = toMinutes(b.time);
    return [s, s + dur];
  });
  const blockedIntervals = store.getBlockedSlotsForDate(dateStr).map(bl => [toMinutes(bl.start_time), toMinutes(bl.end_time)]);
  const occupied = bookingIntervals.concat(blockedIntervals);

  const slots = [];
  for (let t = startMin; t + durationMin <= endMin; t += config.slotStepMinutes) {
    const slotEnd = t + durationMin;
    const overlaps = occupied.some(([os, oe]) => t < oe && slotEnd > os);
    if (!overlaps) slots.push(toHHMM(t));
  }
  return slots;
}

function handleManualChooseService(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.services.length) return `Отправьте номер услуги.`;
  const serviceId = data.services[idx];
  const dates = getAvailableDates();
  let msg = `📆 *Дата записи:*\n\n`;
  dates.forEach((d, i) => { msg += `${i + 1}️⃣ ${formatDateHuman(d)}\n`; });
  msg += `\n_Отправьте номер_`;
  store.setState(phone, 'admin_manual_choose_date', { serviceId, dates });
  return msg;
}

function handleManualChooseDate(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.dates.length) return `Отправьте номер даты.`;
  const date = data.dates[idx];
  const service = store.getServiceById(data.serviceId);
  const duration = service ? service.duration_min : config.slotStepMinutes;
  const slots = generateSlotsForDate(date, duration);
  if (slots.length === 0) return `Нет свободных окон на ${formatDateHuman(date)}. Выберите другую дату (номер из списка выше).`;
  let msg = `🕐 *Свободное время:*\n\n`;
  slots.forEach((s, i) => { msg += `${i + 1}️⃣ ${s}\n`; });
  msg += `\n_Отправьте номер_`;
  store.setState(phone, 'admin_manual_choose_time', { serviceId: data.serviceId, date, slots });
  return msg;
}

function handleManualChooseTime(phone, text, data) {
  const idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.slots.length) return `Отправьте номер времени.`;
  const time = data.slots[idx];
  store.setState(phone, 'admin_manual_ask_name', { serviceId: data.serviceId, date: data.date, time });
  return `Имя клиента?`;
}

function handleManualAskName(phone, text, data) {
  if (!text || text.length < 2) return `Введите имя (минимум 2 символа)`;
  const service = store.getServiceById(data.serviceId);
  const placeholderPhone = `manual-${Date.now()}@c.us`;
  store.createBooking({
    phone: placeholderPhone, client_name: text, service_id: data.serviceId, date: data.date, time: data.time
  });
  store.setState(phone, 'admin_menu', {});
  return (
    `✅ Запись создана: ${text}, ${service ? service.name : ''}, ` +
    `${formatDateHuman(data.date)} в ${data.time}\n\n` + ADMIN_MENU
  );
}

module.exports = { handleAdminMessage, isAdminTrigger, isAdminActive };
