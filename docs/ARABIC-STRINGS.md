# Arabic strings for review

> **Status, 16 October 2026.** The personal page is now the studio from SPC's design. The page strings below (section "Personal page") are no longer shown. The studio's Arabic text — card labels, the six headline presets, the captions in three tones — comes from the design itself (design/source/*/logic.js) and still needs the same native-reader sign-off. The server-rendered card strings and the default caption below are only used by the admin's server render.

Drafted by Claude on 15 October 2026. None has been reviewed by a native
reader. The user signs these off. Edit the Arabic column, or the source file
named in each section, and say which changed.

Brand names (LinkedIn, X, Facebook, WhatsApp, Instagram) stay in Latin in
both languages. Second person is singular throughout. Dates and licence
numbers use Latin digits in both languages.

## On the card image (src/render/template.ts)

| Where | Arabic | English |
|---|---|---|
| Headline | مرخّصون رسمياً في المنطقة الحرة لمدينة الشارقة للنشر | We're officially licensed at SPC Free Zone |
| Tagline under the wordmark | المنطقة الحرة لمدينة الشارقة للنشر | Sharjah Publishing City Free Zone |
| Label | رقم الرخصة | Licence number |
| Label | تاريخ الإصدار | Issued |

## Default caption (migrations/0001_init.sql, editable later in Admin, Settings)

| Arabic | English |
|---|---|
| أصبحت {company} مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر! #SPCFreeZone #الشارقة {link} | We're officially licensed at SPC Free Zone! {company} is now a licensed business in Sharjah. #SPCFreeZone #Sharjah #BusinessSetup {link} |

## Personal page (src/page/strings.ts)

| Key | Arabic | English |
|---|---|---|
| otherLangLabel (toggle shown in the English UI) | العربية | — |
| switchLanguage | تغيير اللغة | Switch language |
| siteName | المنطقة الحرة لمدينة الشارقة للنشر | SPC Free Zone |
| ogTitle | {company} مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر | {company} is officially licensed at SPC Free Zone |
| ogDescription | بطاقة الترخيص الرسمية لشركة {company}، الصادرة عن المنطقة الحرة لمدينة الشارقة للنشر. | Official licence card for {company}, issued by SPC Free Zone, Sharjah. |
| headline | نحن مرخّصون رسمياً في المنطقة الحرة لمدينة الشارقة للنشر | We're officially licensed at SPC Free Zone |
| intro | تهانينا! بطاقة رخصة {company} جاهزة للتحميل والمشاركة. | Congratulations, {company}. Your licence card is ready to download and share. |
| licenceNumber | رقم الرخصة | Licence number |
| licenceType | نوع الرخصة | Licence type |
| issuedOn | تاريخ الإصدار | Issued |
| activity | النشاط | Activity |
| imageAlt | بطاقة رخصة {company} | Licence card for {company} |
| chooseSize | اختر المقاس | Choose a size |
| sizes.square | مربّع | Square |
| sizes.portrait | طولي | Portrait |
| sizes.story | ستوري | Story |
| sizes.landscape | أفقي | Landscape |
| sizeHints.square | المنشورات | Feed posts |
| sizeHints.portrait | منشورات إنستغرام | Instagram feed |
| sizeHints.story | الستوري والحالة | Stories and status |
| sizeHints.landscape | منشورات الروابط | Link posts |
| download | تحميل الصورة | Download image |
| shareHeading | شارك الخبر | Share the news |
| shareHint | كل زر يشارك صفحتك الشخصية. | Each button shares your personal page. |
| instagramHint | لا يتيح إنستغرام المشاركة عبر الويب. حمّل الصورة المربّعة أو صورة الستوري والصق النص المرافق. | Instagram has no web share. Download the square or story image and paste the caption. |
| captionHeading | النص المرافق | Caption |
| copyCaption | نسخ النص | Copy caption |
| copied | تم النسخ | Copied |
| copyFailed | حدّد النص وانسخه | Select the text and copy it |
| preparingTitle | نُجهّز بطاقتك | Preparing your card |
| preparingBody | يتم الآن إنشاء بطاقة رخصتك. تتحدّث هذه الصفحة تلقائياً، وعادةً لا يستغرق ذلك أكثر من دقيقة. | Your licence card is being created. This page refreshes itself; it usually takes under a minute. |
| takingLonger | هل يستغرق الأمر وقتاً أطول من المعتاد؟ | Taking longer than usual? |
| whatsappUs | تواصل معنا عبر واتساب | WhatsApp us |
| expiredTitle | انتهت صلاحية هذه الرخصة | This licence has expired |
| expiredBody | لم يعد بالإمكان مشاركة بطاقتها. جدّد الرخصة عبر بوابة العملاء وستعود البطاقة على الرابط نفسه. | Its card can no longer be shared. Renew the licence in the customer portal and the card comes back at this same link. |
| expiredOn | انتهت صلاحية الرخصة {licence} في {date}. | Licence {licence} expired on {date}. |
| renewCta | التجديد عبر بوابة العملاء | Renew in the customer portal |
| notFoundTitle | هذا الرابط غير صالح | This link is not valid |
| notFoundBody | تحقّق من الرابط في رسالة الرخصة، أو تواصل مع المنطقة الحرة لمدينة الشارقة للنشر. | Check the link in your licence email, or contact SPC Free Zone. |
| contactUs | تواصل معنا | Contact us |
| testRibbon | تجريبي | TEST |
| testNote | هذه بطاقة تجريبية وليست رخصة فعلية. | This is a test card, not a real licence. |
| footerLine | المنطقة الحرة لمدينة الشارقة للنشر | SPC Free Zone · Sharjah Publishing City |

## Open wording questions

1. The official Arabic name of SPC Free Zone as used on the live site should
   replace "المنطقة الحرة لمدينة الشارقة للنشر" everywhere if it differs.
2. "بطاقة رخصة" (licence card) is used on the page even though the product
   is a social creative; say if "بطاقة" should be something else.
3. The caption hashtags are a marketing choice.
