# تحديث RASD على GitHub Pages إلى 0.15.0

هذه الحزمة مخصصة لمستودع [alimpwse/rasd](https://github.com/alimpwse/rasd) الذي يعمل بالإصدار 0.14.0. فيها الملفات المتغيّرة فقط. من أي جهاز، سجّل الدخول بحساب المستودع أو بحساب لديه صلاحية الكتابة.

1. فك `rasd-github-update-0.15.0.zip` وافتح المجلد الناتج.
2. في المستودع على فرع `main`، اختر **Add file → Upload files**.
3. اسحب محتويات المجلد إلى الصفحة مع المجلدات `dist` و`tests` و`docs`. تأكد أن GitHub يعرض `dist/app.js` و`dist/sw.js` في مساريهما الحاليين.
4. اختر **Commit changes** إلى `main`، ثم افتح [Actions](https://github.com/alimpwse/rasd/actions) وانتظر نجاح **Deploy RASD to GitHub Pages**.
5. افتح رابط Pages المعتاد. اضغط **Update** عند ظهوره وتأكد من رقم الإصدار **0.15.0**.

النشر يستخدم إعداد GitHub Actions الحالي. احتفظ باسم المستودع والرابط حتى يبقى التخزين المحلي على نفس النطاق. ارفع ملفات التطبيق فقط واحفظ نسخ ملاحظاتك الاحتياطية في Files أو iCloud Drive.
