const axios = require('axios');

const ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE;
const API_TOKEN = process.env.GREEN_API_TOKEN;

const BASE_URL = `https://api.green-api.com/waInstance${ID_INSTANCE}`;

function isConfigured() {
  return Boolean(ID_INSTANCE && API_TOKEN);
}

// phone в формате "48123456789" (без +, без пробелов) -> chatId "48123456789@c.us"
function toChatId(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return `${digits}@c.us`;
}

async function sendMessage(phone, text) {
  if (!isConfigured()) {
    console.error('[green-api] GREEN_API_ID_INSTANCE / GREEN_API_TOKEN не заданы в переменных окружения.');
    return;
  }
  const chatId = phone.includes('@c.us') ? phone : toChatId(phone);
  const url = `${BASE_URL}/sendMessage/${API_TOKEN}`;
  try {
    await axios.post(url, { chatId, message: text });
  } catch (err) {
    console.error('[green-api] Ошибка отправки сообщения:', err.response ? err.response.data : err.message);
  }
}

module.exports = { sendMessage, toChatId, isConfigured };
