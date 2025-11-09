import TelegramBot from "node-telegram-bot-api";
import { Readable } from "stream";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import LZString from "lz-string";

dotenv.config();

const bot = new TelegramBot(process.env.BOT_KEY, { polling: true });

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

function escapeMarkdownV2(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// Обработка сообщений
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || msg.caption?.trim();
  const photo = msg.photo?.[msg.photo.length - 1];
  
  if (!text && !photo) return;

  const statusMsg = await bot.sendMessage(chatId, "⏳ Запрос отправлен...");
  
  await bot.sendChatAction(chatId, "typing");

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  try {
    let result;
    
    if (photo) {
      const fileLink = await bot.getFileLink(photo.file_id);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      const base64Image = Buffer.from(arrayBuffer).toString('base64');
      
      const mimeType = 'image/jpeg';
      
      const parts = [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType
          }
        }
      ];
      
      if (text) {
        parts.push({ text: text });
      } else {
        parts.push({ text: "Опиши это изображение подробно" });
      }
      
      result = await model.generateContent(parts);
    } else {
      result = await model.generateContent(text);
    }
    
    const answer = result.response.text().trim();

    await bot.deleteMessage(chatId, statusMsg.message_id);

    if (answer.length <= 500) {
      try {
        await bot.sendMessage(chatId, answer, { parse_mode: "Markdown" });
      } catch (parseError) {
        await bot.sendMessage(chatId, answer);
      }
    } 
    else if (answer.length <= 4000) {
      const compressed = LZString.compressToEncodedURIComponent(answer);
      await bot.sendMessage(chatId, "Ответ готов! Нажмите кнопку ниже, чтобы увидеть отформатированный текст:", {
        reply_markup: {
          inline_keyboard: [[
            { text: "📖 Открыть ответ", web_app: { url: `https://doflare123.github.io/GeminiBot/viewer#${compressed}` } }
          ]]
        }
      });
    } 
    else {
      const stream = Readable.from([answer]);
      await bot.sendDocument(chatId, stream, {}, { filename: "gemini_answer.md" });
      await bot.sendMessage(chatId, "📄 Ответ слишком длинный, я отправил его файлом в формате Markdown.");
    }

  } catch (err) {
    console.error("Ошибка при обработке запроса:", err);
    
    try {
      await bot.deleteMessage(chatId, statusMsg.message_id);
    } catch (deleteErr) {
    }
    
    await bot.sendMessage(chatId, "⚠️ Ошибка при запросе к Gemini. Попробуйте еще раз.");
  }
});

console.log("🤖 Бот запущен и готов к работе!");