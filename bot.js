import TelegramBot from "node-telegram-bot-api";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const bot = new TelegramBot(process.env.BOT_KEY, { polling: true });

// Ротация API ключей Gemini
const keys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
].filter(Boolean);

let keyIndex = 0;
function getGenAI() {
  const key = keys[keyIndex];
  keyIndex = (keyIndex + 1) % keys.length;
  return new GoogleGenerativeAI(key);
}

// обработка сообщений
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return;

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    const result = await model.generateContent(text);
    const answer = result.response.text().trim();

    if (answer.length <= 500) {
      await bot.sendMessage(chatId, answer, { parse_mode: "Markdown" });
    } else {
      const encoded = btoa(encodeURIComponent(answer));
      await bot.sendMessage(chatId, "Открыть длинный ответ:", {
        reply_markup: {
          inline_keyboard: [[
            { text: "📖 Посмотреть", web_app: { url: `https://doflare123.github.io/GeminiBot/viewer#${encoded}` } }
          ]]
        }
      });
    }

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "⚠️ Ошибка при запросе к Gemini.");
  }
});
