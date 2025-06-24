import logging
import os
import re
from telegram import Update
import io
from PIL import Image
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes, MessageHandler, filters
import google.generativeai as genai
from dotenv import load_dotenv
import time

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

load_dotenv()

bot_token = os.getenv("BOT_KEY")

API_KEYS = [
    os.getenv("GEMINI_API_KEY_1"),
    os.getenv("GEMINI_API_KEY_2"),
    os.getenv("GEMINI_API_KEY_3"),
    os.getenv("GEMINI_API_KEY_4"),
    os.getenv("GEMINI_API_KEY_5"),
    os.getenv("GEMINI_API_KEY_6"),
]

API_KEYS = [key for key in API_KEYS if key is not None]

if not API_KEYS:
    raise ValueError("Не найдено ни одного API ключа!")

class GeminiAPIManager:
    def __init__(self, api_keys):
        self.api_keys = api_keys
        self.current_key_index = 0
        self.key_status = {i: {'active': True, 'last_error_time': 0} for i in range(len(api_keys))}
        self.model = None
        self.setup_current_model()
    
    def setup_current_model(self):
        """Настраивает модель с текущим активным ключом"""
        if self.current_key_index < len(self.api_keys):
            genai.configure(api_key=self.api_keys[self.current_key_index])
            self.model = genai.GenerativeModel('gemini-2.5-flash')
            logging.info(f"Используется API ключ #{self.current_key_index + 1}")
    
    def switch_to_next_key(self):
        """Переключается на следующий доступный ключ"""
        original_index = self.current_key_index
        attempts = 0
        
        while attempts < len(self.api_keys):
            self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
            attempts += 1
            
            key_info = self.key_status[self.current_key_index]
            current_time = time.time()
            
            if not key_info['active'] and (current_time - key_info['last_error_time']) < 3600:
                continue
            
            if not key_info['active'] and (current_time - key_info['last_error_time']) >= 3600:
                key_info['active'] = True
            
            if key_info['active']:
                self.setup_current_model()
                logging.info(f"Переключились на API ключ #{self.current_key_index + 1}")
                return True
        
        logging.error("Все API ключи исчерпаны или заблокированы!")
        return False
    
    def mark_current_key_as_exhausted(self):
        """Помечает текущий ключ как исчерпанный"""
        self.key_status[self.current_key_index]['active'] = False
        self.key_status[self.current_key_index]['last_error_time'] = time.time()
        logging.warning(f"API ключ #{self.current_key_index + 1} помечен как исчерпанный")
    
    def is_quota_error(self, error):
        """Проверяет, является ли ошибка связанной с исчерпанием квоты"""
        error_str = str(error).lower()
        quota_indicators = [
            'quota exceeded',
            'rate limit',
            'too many requests',
            'resource_exhausted',
            'quota_exceeded',
            'limit exceeded'
        ]
        return any(indicator in error_str for indicator in quota_indicators)
    
    async def generate_content_with_rotation(self, content):
        """Генерирует контент с автоматической ротацией ключей при ошибках квоты"""
        max_attempts = len(self.api_keys)
        
        for attempt in range(max_attempts):
            try:
                if self.model is None:
                    raise Exception("Нет доступных API ключей")
                
                response = await self.model.generate_content_async(content)
                return response
                
            except Exception as e:
                logging.error(f"Ошибка с ключом #{self.current_key_index + 1}: {e}")
                
                if self.is_quota_error(e):
                    self.mark_current_key_as_exhausted()
                    
                    if attempt < max_attempts - 1:  # Не последняя попытка
                        if self.switch_to_next_key():
                            logging.info(f"Повторная попытка с новым ключом (попытка {attempt + 2})")
                            continue
                        else:
                            raise Exception("Все API ключи исчерпаны")
                    else:
                        raise Exception("Все API ключи исчерпаны")
                else:
                    raise e
        
        raise Exception("Не удалось выполнить запрос ни с одним ключом")

api_manager = GeminiAPIManager(API_KEYS)

def escape_markdown_v2(text: str) -> str:
    """
    Правильное экранирование для MarkdownV2.
    Экранируем только те символы, которые не должны интерпретироваться как форматирование.
    """
    code_blocks = []
    
    def replace_code_block(match):
        code_blocks.append(match.group(0))
        return f"__CODE_BLOCK_{len(code_blocks)-1}__"
    
    text = re.sub(r'```.*?```', replace_code_block, text, flags=re.DOTALL)
    
    inline_codes = []
    def replace_inline_code(match):
        inline_codes.append(match.group(0))
        return f"__INLINE_CODE_{len(inline_codes)-1}__"
    
    text = re.sub(r'`[^`]+`', replace_inline_code, text)
    
    chars_to_escape = ['\\', '[', ']', '(', ')', '~', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    
    for char in chars_to_escape:
        text = text.replace(char, '\\' + char)
    
    for i, code_block in enumerate(code_blocks):
        text = text.replace(f"__CODE_BLOCK_{i}__", code_block)
    
    for i, inline_code in enumerate(inline_codes):
        text = text.replace(f"__INLINE_CODE_{i}__", inline_code)
    
    return text

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text="Привет! Отправь мне любое сообщение, и я перешлю его нейросети Gemini."
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_message = update.message.text
    chat_id = update.effective_chat.id
    
    messageBot = await context.bot.send_message(chat_id=chat_id, text="Обрабатываю запрос...")
    
    try:
        logging.info(f"Получено сообщение от {chat_id}: {user_message}")
        
        response = await api_manager.generate_content_with_rotation(user_message)
        escaped_text = escape_markdown_v2(response.text)
        
        await context.bot.send_message(chat_id=chat_id, text=escaped_text, parse_mode="MarkdownV2")
        await context.bot.delete_message(chat_id=chat_id, message_id=messageBot.message_id)
        
    except Exception as e:
        logging.error(f"Ошибка при обработке сообщения от {chat_id}: {e}")
        await context.bot.delete_message(chat_id=chat_id, message_id=messageBot.message_id)
        
        if "все api ключи исчерпаны" in str(e).lower():
            await context.bot.send_message(
                chat_id=chat_id, 
                text="⚠️ Временно превышены лимиты всех API ключей. Попробуйте позже через час."
            )
        else:
            await context.bot.send_message(
                chat_id=chat_id, 
                text=f"Произошла ошибка при обращении к Gemini: {e}"
            )
        
async def handle_image(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    prompt = update.message.caption or "Опиши это изображение."
    
    messegaBot = await context.bot.send_message(chat_id=chat_id, text="Получил изображение, анализирую...")

    try:
        photo_file = await update.message.photo[-1].get_file()
        photo_bytes = await photo_file.download_as_bytearray()
        img = Image.open(io.BytesIO(photo_bytes))
        
        response = await api_manager.generate_content_with_rotation([prompt, img])
        escaped_text = escape_markdown_v2(response.text)
        
        await context.bot.send_message(
            chat_id=chat_id,
            text=escaped_text,
            parse_mode="MarkdownV2"
        )
        await context.bot.delete_message(chat_id=chat_id, message_id=messegaBot.message_id)
        
    except Exception as e:
        logging.error(f"Ошибка при обработке изображения от {chat_id}: {e}")
        await context.bot.delete_message(chat_id=chat_id, message_id=messegaBot.message_id)
        
        if "все api ключи исчерпаны" in str(e).lower():
            await context.bot.send_message(
                chat_id=chat_id, 
                text="⚠️ Временно превышены лимиты всех API ключей. Попробуйте позже через час."
            )
        else:
            await context.bot.send_message(chat_id=chat_id, text=f"Произошла ошибка: {e}")


if __name__ == '__main__':
    application = ApplicationBuilder().token(bot_token).build()
    
    start_handler = CommandHandler('start', start)
    application.add_handler(start_handler)
    
    message_handler = MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message)
    application.add_handler(message_handler)
    application.add_handler(MessageHandler(filters.PHOTO, handle_image))
    
    print(f"Бот запущен с {len(API_KEYS)} API ключами...")
    application.run_polling()