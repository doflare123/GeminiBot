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

// Определение MIME-типа по расширению файла
function getMimeType(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const mimeTypes = {
    // Документы
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'rtf': 'application/rtf',
    // Изображения
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    // Аудио
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'm4a': 'audio/mp4',
    // Видео
    'mp4': 'video/mp4',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    // Другое
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Проверка, поддерживает ли Gemini данный тип файла
function isSupportedFileType(mimeType) {
  const supportedTypes = [
    // Документы
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/rtf',
    // Изображения
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    // Аудио
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    // Видео
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm',
    // Другое
    'application/json',
    'application/xml',
    'text/html'
  ];
  return supportedTypes.includes(mimeType);
}

// Обработка сообщений
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || msg.caption?.trim();
  const photo = msg.photo?.[msg.photo.length - 1];
  const document = msg.document;
  const audio = msg.audio;
  const voice = msg.voice;
  const video = msg.video;
  
  if (!text && !photo && !document && !audio && !voice && !video) return;

  const statusMsg = await bot.sendMessage(chatId, "⏳ Запрос отправлен...");
  
  await bot.sendChatAction(chatId, "typing");

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  try {
    let result;
    let fileData = null;
    let mimeType = null;
    
    // Обработка фото
    if (photo) {
      const fileLink = await bot.getFileLink(photo.file_id);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      fileData = Buffer.from(arrayBuffer).toString('base64');
      mimeType = 'image/jpeg';
    }
    // Обработка документов
    else if (document) {
      const fileName = document.file_name;
      mimeType = getMimeType(fileName);
      
      if (!isSupportedFileType(mimeType)) {
        await bot.deleteMessage(chatId, statusMsg.message_id);
        await bot.sendMessage(chatId, `⚠️ Формат файла "${fileName}" не поддерживается. Попробуйте PDF, Word, Excel, PowerPoint, изображения или текстовые файлы.`);
        return;
      }
      
      const fileLink = await bot.getFileLink(document.file_id);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      fileData = Buffer.from(arrayBuffer).toString('base64');
    }
    // Обработка аудио
    else if (audio || voice) {
      const audioFile = audio || voice;
      const fileLink = await bot.getFileLink(audioFile.file_id);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      fileData = Buffer.from(arrayBuffer).toString('base64');
      mimeType = audio ? 'audio/mpeg' : 'audio/ogg';
    }
    // Обработка видео
    else if (video) {
      const fileLink = await bot.getFileLink(video.file_id);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      fileData = Buffer.from(arrayBuffer).toString('base64');
      mimeType = 'video/mp4';
    }
    
    // Формирование запроса
    if (fileData) {
      const parts = [
        {
          inlineData: {
            data: fileData,
            mimeType: mimeType
          }
        }
      ];
      
      if (text) {
        parts.push({ text: text });
      } else {
        // Разные промпты в зависимости от типа файла
        if (mimeType.startsWith('image/')) {
          parts.push({ text: "Опиши это изображение подробно" });
        } else if (mimeType.startsWith('audio/')) {
          parts.push({ text: "Расшифруй и проанализируй это аудио" });
        } else if (mimeType.startsWith('video/')) {
          parts.push({ text: "Опиши содержание этого видео" });
        } else if (mimeType === 'application/pdf' || mimeType.includes('document')) {
          parts.push({ text: "Проанализируй содержание этого документа и дай краткое резюме" });
        } else if (mimeType.includes('spreadsheet') || mimeType === 'text/csv') {
          parts.push({ text: "Проанализируй данные в этой таблице" });
        } else if (mimeType.includes('presentation')) {
          parts.push({ text: "Опиши содержание этой презентации" });
        } else {
          parts.push({ text: "Проанализируй содержание этого файла" });
        }
      }
      
      result = await model.generateContent(parts);
    } else if (text) {
      result = await model.generateContent(text);
    } else {
      await bot.deleteMessage(chatId, statusMsg.message_id);
      return;
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