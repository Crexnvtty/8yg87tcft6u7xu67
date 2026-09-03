module.exports = {
  businessName: 'Manicure — TWOJE IMIĘ', // ЗАМЕНИ на реальное название/имя

  masterChatId: '48796180937@c.us', // ЗАМЕНИ на второй номер администратора
  contactPhoneDisplay: '+48 000 000 000', // ЗАМЕНИ на номер мастера для связи

  // Рабочие часы по дням недели (0 = воскресенье ... 6 = суббота) — ЗАМЕНИ под реальный график
  workingHours: {
    1: { start: '10:00', end: '18:00' },
    2: { start: '10:00', end: '18:00' },
    3: { start: '10:00', end: '18:00' },
    4: { start: '10:00', end: '18:00' },
    5: { start: '10:00', end: '18:00' },
    6: { start: '10:00', end: '15:00' },
    0: null
  },

  slotStepMinutes: 30,
  daysAheadToShow: 7, // используется в админ-панели (блокировка/ручная запись)
  maxMonthsAhead: 6,  // на сколько месяцев вперёд клиент может записаться
  reminderHourBefore: 24,

  adminQuietHours: { start: '21:00', end: '09:00' }
};
