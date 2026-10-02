# سرویس‌های صوتی و ترجمه · بررسی ۲۰۲۶-۱۰-۰۱

| مرحله | سرویس‌های قابل انتخاب در Easy-ts |
| --- | --- |
| گفتار به متن فایل / ضبط YouTube | Deepgram، Groq Whisper، ElevenLabs Scribe، Gemini، OpenAI |
| ترجمهٔ متن به فارسی | Groq، Gemini، OpenAI |
| متن به صدا | Fish Audio، ElevenLabs، Gemini، OpenAI |
| جلسهٔ صوتی مستقل | Gemini Live، OpenAI Realtime، GPT-Live |

## ElevenLabs

مسیر STT از `POST /v1/speech-to-text` با Scribe، زمان کلمات و `diarize=true` استفاده می‌کند. کلمات هر نوبت گفتار کنار هم قرار می‌گیرند و شمارهٔ گوینده در همان درخواست ثابت می‌ماند. مسیر TTS از Voice ID و مدل انتخاب‌شده استفاده می‌کند. ثبات، شباهت، شدت سبک، سرعت و تقویت گوینده در تنظیمات هستند؛ سازگاری این پارامترها و فارسی به مدل وابسته است. نگاشت صدای گویندهٔ ElevenLabs مستقل از Fish است.

منابع رسمی: [تبدیل گفتار به متن](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)، [تولید گفتار](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

## Gemini

«ترجمهٔ Gemini» در افزونه یعنی تولید ترجمهٔ فارسی با مدل متنی و خروجی JSON؛ سرویس جداگانه‌ای به نام Gemini Translate API فراخوانی نمی‌شود. تشخیص فایل صوتی از Audio Understanding است: متن، گوینده و زمان‌ها با درخواست ساختاریافته تولید می‌شوند؛ زمان‌ها تخمینی‌اند و باید بازبینی شوند. صوت تا ۱۴ مگابایت inline ارسال می‌شود؛ فایل بزرگ‌تر با Files API آپلود می‌شود و پس از موفقیت یا خطا، حذف فایل درخواست می‌شود.

TTS و Live متفاوت‌اند. TTS 3.8 با generateContent، متن دقیق، speech_metadata و voiceConfig.voice فایل WAV می‌سازد؛ مسیر TTS 2.5 از prebuiltVoiceConfig استفاده می‌کند و PCM پاسخ به WAV تبدیل می‌شود. Live از WebSocket، ورودی PCM تک‌کانالهٔ ۱۶ کیلوهرتز و خروجی صوتی استفاده می‌کند. نام صدا و مدل آن مستقل‌اند. جلسهٔ زنده به پروژهٔ فایل تبدیل نمی‌شود و مدل ممکن است تأخیر، اشتباه یا رفتار گفت‌وگویی داشته باشد.

## مدل محلی و انتخاب خودکار TTS

در تنظیمات، STT یا TTS را روی «مدل محلی» بگذارید. آدرس پایه مثل `http://127.0.0.1:8000/v1` شامل مسیر `/v1` است؛ پورت و مدل دو مرحله مستقل‌اند. افزونه برای TTS به `POST /audio/speech` با JSON شامل model، input، voice و response_format=wav وصل می‌شود. STT به `POST /audio/transcriptions` با فایل multipart، model و verbose_json یا diarized_json وصل می‌شود. پاسخ STT باید `segments` با start و end بر حسب ثانیه و text داشته باشد؛ speaker اختیاری است. کلید محلی اختیاری است و به صورت Bearer ارسال می‌شود. سرور باید روی localhost یا 127.0.0.1 و سازگار با این قرارداد باشد؛ صرف اجرای Ollama یا یک مدل بدون سرور صوتی کافی نیست. ترجمهٔ متن همچنان با سرویس مستقل انتخاب‌شده انجام می‌شود.

اگر انتخاب خودکار TTS روشن باشد، سرویس انتخاب‌شده کلید نداشته باشد و دقیقاً یک سرویس ابری TTS کلید داشته باشد، همان استفاده می‌شود. انتخاب ذخیره‌شده تغییر نمی‌کند. با چند کلید، انتخاب صریح حفظ می‌شود. Voice ID مربوط به سرویس هم باید تنظیم شود؛ Gemini و OpenAI صدای پیش‌فرض دارند. مدل محلی با انتخاب مستقیم استفاده می‌شود.

منابع رسمی: [Audio Understanding](https://ai.google.dev/gemini-api/docs/audio)، [تولید گفتار](https://ai.google.dev/gemini-api/docs/speech-generation)، [پروتکل Live](https://ai.google.dev/api/live)، [مدیریت جلسه](https://ai.google.dev/gemini-api/docs/live-api/session-management).

## OpenAI

ترجمهٔ متن از Chat Completions و JSON Schema استفاده می‌کند. برای خط زمان فایل، مدل `gpt-4o-transcribe-diarize` با `diarized_json` و chunking خودکار یا `whisper-1` با زمان‌بندی قابل انتخاب است. Whisper برچسب گوینده ندارد. این مسیر سقف ورودی ۲۵ مگابایت را پیش از ارسال بررسی می‌کند. TTS از Speech API با صدای انتخاب‌شده، سرعت و دستور لحن در مدل‌های پشتیبان استفاده می‌کند.

**Realtime:** اتصال WebRTC؛ background افزونه client secret موقت می‌سازد و SDP را به `/v1/realtime/calls` می‌فرستد. پایان گفتار، آستانهٔ VAD، سکوت، صدای قبل از شروع و صدا قابل تنظیم‌اند.

**GPT-Live:** API جداگانهٔ `/v1/live/sessions`؛ مدل صوتی و مدل Responses delegation مستقل تنظیم می‌شوند. پس از SDP، شروع با `session.started` تأیید می‌شود. پایان جلسه با `session.close` درخواست می‌شود و تا ۱۵ ثانیه برای `session.closed` و مصرف نهایی انتظار می‌رود. دسترسی حساب لازم است. هزینهٔ صوت و مدل پشتیبان جداست؛ ساخت اتصال WebRTC نیز طبق مستندات هزینهٔ آغاز جلسه دارد.

منابع رسمی: [STT](https://developers.openai.com/api/docs/guides/speech-to-text)، [TTS](https://developers.openai.com/api/docs/guides/text-to-speech)، [Realtime](https://developers.openai.com/api/docs/guides/realtime)، [GPT-Live](https://developers.openai.com/api/docs/guides/live)، [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc)، [بستن جلسه](https://developers.openai.com/api/docs/guides/live-conversations#usage-and-graceful-close).

## نحوهٔ استفاده و حدود اعتبارسنجی

از «تنظیمات کامل» در پنجرهٔ افزونه، استودیو یا صفحهٔ Options مرورگر وارد شوید. سرویس هر مرحله، کلید، مدل و صدای مربوط را انتخاب و ذخیره کنید. «ساخت نمونهٔ صدا» و «تست ترجمه» درخواست واقعی و احتمالاً هزینه‌دار می‌فرستند. کلیدهای سرویس‌های استفاده‌نشده لازم نیستند.

برای پروژهٔ قدیمی، سرویس صدای همان پروژه را انتخاب کنید؛ برای تغییر سرویس، فایل را دوباره پردازش کنید. کلیدها در فایل خروجی تنظیمات قرار نمی‌گیرند و واردکردن فایل کلیدهای فعلی را حفظ می‌کند. کلیدها به‌صورت محلی و بدون رمزگذاری نگهداری می‌شوند. این ساختار برای افزونهٔ شخصی است؛ برای یک برنامهٔ عمومی، طبق مستندات رسمی باید کلیدهای دائمی روی سرور مطمئن نگهداری و احراز هویت/توکن موقت استفاده شوند.

۳۹ تست Node، رابط تنظیمات و چرخهٔ ضبط/توقف Live با پاسخ‌های ساختگی بررسی شدند. خروجی واقعی WAV/WebM با رسانهٔ مصنوعی در مرورگر ساخته و لغو ضبط بررسی شد. هیچ کلید واقعی برای سرویس‌های جدید استفاده نشده؛ کیفیت فارسی، دسترسی حساب، اعتبار مدل‌ها در حساب شما و اجرای کامل offscreen/YouTube نیازمند آزمون واقعی‌اند. تشخیص گوینده به معنی جداسازی چند صدای هم‌زمان نیست.
