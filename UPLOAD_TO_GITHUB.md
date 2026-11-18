# رفع RASD على GitHub Pages من جهاز آخر

الحزمة جاهزة للنشر، ولا تحتاج تثبيت برامج أو مكتبات. يمكنك رفعها من متصفح الكمبيوتر.

## 1. فك الملف

انقل `rasd-github-pages-0.14.0.zip` للجهاز الثاني وفك الضغط. افتح المجلد الناتج.

ستجد `README.md` و`AGENTS.md` و`package.json` ومجلدات `dist` و`tests` و`scripts` و`docs` و`.github`.

**ارفع المحتويات الموجودة داخل المجلد، وليس المجلد الخارجي نفسه ولا ملف ZIP.** يجب أن يكون المسار في GitHub هو `dist/index.html` مباشرة، وليس `rasd-github-pages-0.14.0/dist/index.html`.

مجلد `.github` يبدأ بنقطة وقد يكون مخفياً في مستعرض الملفات. في Finder على Mac اضغط **Command + Shift + .** لإظهاره. وفي Windows فعّل **View → Show → Hidden items** عند الحاجة. تأكد بعد الرفع أن `.github/workflows/pages.yml` موجود.

## 2. أنشئ المستودع واضبط Pages

1. سجّل الدخول إلى GitHub وأنشئ **New repository** باسم مثل `rasd`.
2. اختر **Public** لاستخدام Pages مع خطة GitHub Free. فعّل إنشاء README ليصبح فرع `main` موجوداً.
3. افتح **Settings → Pages**.
4. تحت **Build and deployment → Source** اختر **GitHub Actions**. لا تختَر Deploy from a branch؛ هذه الحزمة تنشر مجلد `dist` بواسطة ملف النشر المرفق.

الإعداد يفترض أن اسم الفرع هو `main`. إذا كان مختلفاً، عدّل `branches: [main]` في `.github/workflows/pages.yml` إلى اسم فرعك.

## 3. ارفع الملفات

1. ارجع إلى **Code → Add file → Upload files**.
2. اسحب محتويات المجلد إلى الصفحة مع الاحتفاظ بالمجلدات الداخلية، ثم اضغط **Commit changes** إلى `main`. وافق على استبدال README الأول بملف الحزمة.
3. إذا حدّد المتصفح عدد الملفات، ارفعها على دفعتين؛ ارفع `.github` في الدفعة الأخيرة كي يبدأ النشر بعد اكتمال الملفات.
4. تحقق من وجود `dist/index.html` و`.github/workflows/pages.yml` في مساريهما الصحيحين.

إذا لم يسمح مستعرض الملفات برفع `.github`، استخدم **Add file → Create new file** في GitHub. اكتب الاسم كاملاً `.github/workflows/pages.yml`، ثم انسخ محتوى ملف `pages.yml` المرفق واحفظه في `main`.

لا ترفع ملفات النسخ الاحتياطية أو صور المواقع الشخصية إلى المستودع العام.

## 4. افتح التطبيق

1. افتح تبويب **Actions** وانتظر نجاح **Deploy RASD to GitHub Pages** باللون الأخضر.
2. خذ الرابط الفعلي من **Settings → Pages → Visit site**. غالباً يكون بالشكل `https://YOUR_USERNAME.github.io/rasd/`.
3. افتحه في Safari على الآيفون، ثم **Share → Add to Home Screen**.
4. اسمح بالكاميرا والموقع عند الطلب، وانتظر **Offline ready** قبل تجربة قطع الإنترنت.

ملف النشر يرفع محتويات `dist` فقط. التطبيق يعمل من رابط المشروع المنتهي بـ `/`؛ لا تضف `/dist/` إلى الرابط المنشور.

## 5. انقل بياناتك الحالية

الرابط الجديد له تخزين مستقل. وجود الكود على GitHub لا ينقل صورك أو إعداداتك تلقائياً.

1. في النسخة القديمة، احفظ أي مسودات تحتاجها.
2. من **Settings → Backup & restore → Back up everything** احفظ ملف النسخة في Files أو iCloud Drive.
3. افتح تطبيق الشاشة الرئيسية الجديد، ثم **Restore backup** واختر الملف.
4. تحقق من الصور والملاحظات والمشاريع والتصنيفات والعبارات والإعدادات قبل إزالة الاختصار القديم. الاستعادة الكاملة تستبدل بيانات النسخة الجديدة بعد التأكيد.

الحد الحالي للنسخة الاحتياطية 64 MiB و500 ملاحظة. إذا تجاوزتها مكتبتك، احتفظ بالنسخة القديمة واستخدم نسخ الملاحظات منفردة؛ لا تضغط الصور أو تمسح البيانات لتجاوز الحد. مسودات غير محفوظة ليست ضمن النسخة الكاملة.

## التحديث لاحقاً

عدّل ملفات `dist` في المستودع، ثم ارفع التعديلات إلى `main`. GitHub Actions يعيد النشر تلقائياً. عند تعديل التطبيق، حدّث رقم cache في `dist/sw.js` ورقم الإصدار كما يوضح `AGENTS.md` حتى يظهر التحديث للمستخدمين الحاليين.

حافظ على نفس اسم المستودع ونفس النطاق لتفادي تغيير رابط التطبيق المثبّت. نقل التطبيق إلى نطاق آخر يتطلب استعادة البيانات هناك مجدداً.

## إذا لم يعمل النشر

- **Actions فشل عند Configure Pages:** تأكد أن Pages مفعّل وأن Source مضبوط على GitHub Actions، ثم اختر **Re-run all jobs** أو **Run workflow**.
- **لا يظهر Workflow:** تأكد من وجود `.github/workflows/pages.yml`، وأن الرفع إلى `main` وأن Actions مسموح في إعدادات المستودع.
- **404:** استخدم الرابط من Settings → Pages بعد نجاح النشر، وتحقق من وجود `dist/index.html` ومن عدم رفع المجلد الخارجي حول الملفات.
- **تظهر النسخة القديمة:** افتح التطبيق متصلاً بالإنترنت واستخدم زر **Update** عندما يظهر؛ لا تمسح بيانات Safari كخطوة تحديث.
- **اختبار الآيفون:** جرّب التصوير والضغط المطول للفيديو والحفظ وإعادة الفتح والرسم بالعربي والمشاركة في واتساب والأوفلاين واسترجاع النسخة. فحص المتصفح على الكمبيوتر لا يثبت سلوك كاميرا iOS أو واتساب.

المراجع الرسمية: [إعداد مصدر النشر](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)، [GitHub Actions مع Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)، [رفع الملفات](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).
