from pathlib import Path
p=Path('README.md');s=p.read_text(encoding='utf-8').replace('# Easy-ts 1.5.0','# Easy-ts 1.5.1')
s=s.replace('تکه‌ها روی timeline چیده و هم‌پوشانی‌ها ترکیب می‌شوند.','دیالوگ‌ها به ترتیب روی timeline بدون هم‌پوشانی چیده می‌شوند؛ همهٔ جمله‌ها حفظ می‌شوند.')
s=s.replace('تکه‌های هم‌پوشانی که سرویس برگرداند هم‌زمان پخش/ترکیب می‌شوند؛','تکه‌های هم‌پوشانی که سرویس برگرداند به ترتیب خوانده می‌شوند؛')
s=s.replace('۲۲ تست موتور شامل','۴۵ تست خودکار شامل').replace('پخش هم‌پوشان،','پخش ترتیبی، حذف تکرار زیرنویس، کنترل پیام‌های background،')
notes='''
## اصلاحات نسخهٔ ۱.۵.۱

دیالوگ‌های دوبله دیگر هم‌زمان خوانده نمی‌شوند. ترتیب زمانی هر جمله و صدای گوینده حفظ می‌شود؛ زیرنویس‌های گردشی YouTube با حذف کلمات تکراری در پنجره‌های هم‌پوشان یک‌بار خوانده می‌شوند. شکستن متن در مرز کلمات انجام می‌شود، نه وسط کلمه. جای کلمات در ترجمهٔ فارسی تابع ساختار طبیعی زبان است؛ زمان‌بندی دقیق تک‌تک کلمات فارسی ادعا نمی‌شود.

در «تنظیمات کامل ← مسیر پردازش»، «انتخاب خودکار صدا برای هر گوینده» را فعال کنید. در بخش سرویس TTS انتخاب‌شده، هر خط فهرست صداها یک Voice ID یا نام صدا برای گویندهٔ بعدی است. خالی‌بودن نگاشت به صدای پیش‌فرض برمی‌گردد. برای تشخیص گوینده در YouTube، «تشخیص گوینده هنگام ضبط YouTube» نیز باید فعال باشد؛ در پردازش فایل کامل، STT دارای تفکیک گوینده انتخاب کنید. این گزینه به‌صورت پیش‌فرض خاموش است؛ ویرایش دستی صدای یک جمله همچنان مستقل است. شناسه‌های واقعی صدا به حساب سرویس شما وابسته‌اند.

برای جلوگیری از قطع جملهٔ طولانی، مدت واقعی صدای تولیدشده اندازه‌گیری می‌شود. دیالوگ‌های هم‌زمان پشت سر هم قرار می‌گیرند؛ در نتیجه ممکن است نسبت به تصویر تأخیر ایجاد شود. WAV و SRT خروجی همین ترتیب را دارند. WebM تا پایان صدا ادامه می‌یابد و در صورت نیاز آخرین تصویر را نگه می‌دارد. پخش در صفحهٔ YouTube هنگام توقف ویدئو متوقف می‌شود؛ برای شنیدن تمام دنبالهٔ جابه‌جا‌شده از خروجی استودیو استفاده کنید. خروجی WAV/WebM پروژه‌های قدیمی را دوباره بسازید.

حلقهٔ بازفرستادن پیام وضعیت به background حذف شده، ساخت هم‌زمان چند offscreen کنترل شده و ارسال به سند تازه فقط در صورت نبود گیرنده دوباره امتحان می‌شود. صرف شمارهٔ خط برای تشخیص قطعی خطای گزارش‌شده کافی نیست؛ اصلاحات بر اساس علت‌های پیدا‌شده در کد هستند.

بعد از جایگزینی فایل‌ها، افزونه را در chrome://extensions با Reload به‌روز و صفحهٔ YouTube را نیز Reload کنید. برای اعمال پاک‌سازی زیرنویس روی پروژهٔ قبلی، ترجمهٔ آن را دوباره آماده کنید.

'''
s=s.replace('## سرویس‌ها و تنظیمات کامل',notes+'## سرویس‌ها و تنظیمات کامل');p.write_text(s,encoding='utf-8')
p=Path('TECHNICAL_NOTES.md');s=p.read_text(encoding='utf-8');p.write_text('''# 1.5.1 regression verification

- 45 Node tests pass, including sequential playback, pause/seek, cancellation, rolling caption deduplication, speaker mapping opt-in, offscreen creation coalescing and status routing recursion.
- Browser settings checks pass, including saving two ElevenLabs voice IDs and the opt-in switch.
- Real browser WAV/WebM export with overlapping input turns and a four-second background track passes. The three-second source video keeps its last image through the four-second audio tail. Cancellation publishes no stale video.
- Stored audio duration reserves enough timeline space at the configured speed limit. Source timings remain intact in the editor. Serialized timelines can lag the source. YouTube pause/end still pauses dubbing; studio exports preserve the complete tail.
- Old mixed exports require rebuilding (timelineVersion 2). Cloud calls use mocks; real paid provider accounts were not tested.

Previous release notes follow.

'''+s,encoding='utf-8')
p=Path('offscreen.js');s=p.read_text(encoding='utf-8').replace('v: 5','v: 6');p.write_text(s,encoding='utf-8')
