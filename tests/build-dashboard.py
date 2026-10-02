from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request

icons=['layout-dashboard','headphones','microphone','adjustments','sun','moon','wave-sine','arrow-up-right','folder','brand-youtube']
Path('icons/ui').mkdir(exist_ok=True)
def download(name):
    path=Path('icons/ui')/(name+'.svg')
    if not path.exists():
        url=f'https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/{name}.svg'
        with urllib.request.urlopen(url,timeout=25) as response: path.write_bytes(response.read())
with ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(download,icons))

for name,page in [('studio.html','studio'),('settings.html','settings'),('live.html','live')]:
    p=Path(name);s=p.read_text(encoding='utf-8')
    s=s.replace('</head>','<link rel="stylesheet" href="workspace.css"></head>')
    s=s.replace('<body>',f'<body class="workspace-page" data-page="{page}">')
    s=s.replace('</body>','<script src="workspace.js"></script></body>')
    if page=='studio':
        s=s.replace('هر جمله، با صدای خودش.','استودیوی دوبله').replace('STUDIO <b>1.5</b>','<b>ویرایش و خروجی</b>')
    if page=='settings':
        s=s.replace('سرویس‌ها را خودت انتخاب کن.','تنظیمات فضای کار')
    if page=='live':
        s=s.replace('گفتار را بشنو، ترجمه را دریافت کن.','ترجمهٔ زنده')
    p.write_text(s,encoding='utf-8')

p=Path('popup.html');s=p.read_text(encoding='utf-8');original=s
s=s.replace('</head>','<link rel="stylesheet" href="workspace.css"></head>').replace('<body>','<body class="popup-page">')
s=s.replace('<nav class="nav-tabs"','<a class="dashboard-launch" href="dashboard.html" target="_blank"><strong>بازکردن داشبورد</strong><span>فضای کامل ترجمه و دوبله ↗</span></a><nav class="nav-tabs"')
p.write_text(s,encoding='utf-8')

dashboard=original.replace('<title>Easy-ts</title>','<title>Easy-ts · داشبورد</title>').replace('</head>','<link rel="icon" href="icons/icon32.png"><link rel="stylesheet" href="workspace.css"></head>').replace('<body>','<body class="workspace-page dashboard-page" data-page="dashboard">')
dashboard=dashboard.replace('<strong>Easy-ts</strong>','<strong>فضای کار / داشبورد</strong>')
heading='''<div class="dashboard-heading"><div><h1>فضای ترجمهٔ تو.</h1><p>از اولین جمله تا آخرین ثانیهٔ دوبله، همه‌چیز اینجاست.</p></div><a class="new-project" href="studio.html"><img class="ui-icon" src="icons/ui/arrow-up-right.svg" alt="">پروژهٔ جدید</a></div>
<section class="dashboard-stats" aria-label="خلاصهٔ فضای کار"><article class="dashboard-stat"><span>پروژه‌های ذخیره‌شده</span><strong id="dashProjectCount">…</strong><small>در این مرورگر</small></article><article class="dashboard-stat"><span>جمله‌های آماده</span><strong id="dashSentenceCount">…</strong><small>صداهای ساخته‌شده</small></article><article class="dashboard-stat"><span>حجم کش صوتی</span><strong id="dashCacheSize">…</strong><small>ذخیره‌سازی محلی</small></article><article class="dashboard-stat"><span>سرویس تولید صدا</span><strong id="dashProvider">…</strong><small id="dashVoiceMode">دریافت تنظیمات</small></article></section>'''
dashboard=dashboard.replace('<nav class="nav-tabs"',heading+'<nav class="nav-tabs"')
dashboard=dashboard.replace('<span class="kicker">ویدیوی فعلی</span>','<span class="kicker">دوبلهٔ YouTube</span><select id="dashboardVideoTab" class="video-tab-picker" aria-label="انتخاب ویدیوی YouTube"><option value="">در حال دریافت تب‌ها…</option></select>')
projects='''<div class="provider-strip"><span>گفتار به متن<strong id="dashStt">…</strong></span><span>ترجمه<strong id="dashTranslation">…</strong></span><a href="settings.html">تنظیم مسیر پردازش ↗</a></div><section class="dashboard-projects"><header><h2>پروژه‌های اخیر</h2><a href="studio.html">همهٔ پروژه‌ها ↗</a></header><div id="recentProjects"><p class="project-list-empty">در حال دریافت پروژه‌ها…</p></div></section>'''
dashboard=dashboard.replace('</main>',projects+'</main>')
dashboard=dashboard.replace('<script src="popup.js">','<script src="workspace.js"></script><script src="studio-db.js"></script><script src="dashboard.js"></script><script src="popup.js">')
Path('dashboard.html').write_text(dashboard,encoding='utf-8')
print('Dashboard and shared navigation created; local icons downloaded.')
