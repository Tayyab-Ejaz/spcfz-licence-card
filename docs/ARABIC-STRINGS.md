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
| footerLine | المنطقة الحرة لمدينة الشارقة للنشر · الشارقة، الإمارات | SPC Free Zone · Sharjah, UAE |
| unsubTitle | إلغاء الاشتراك في هذه الرسائل؟ | Unsubscribe from these emails? |
| unsubBody | سنتوقف عن إرسال الرسائل الخاصة بإعلان رخصتك إلى {email}. | We will stop sending emails about your licence announcement to {email}. |
| unsubButton | إلغاء الاشتراك | Unsubscribe |
| unsubDoneTitle | تم إلغاء اشتراكك | You are unsubscribed |
| unsubDoneBody | لن نرسل إلى {email} أي رسائل أخرى بخصوص إعلان رخصتك. لا تزال بطاقتك متاحة على الرابط نفسه. | We will not email {email} about your licence announcement again. Your card still works at the same link. |
| unsubNoEmail | لا يوجد بريد إلكتروني مسجّل لهذه البطاقة، لذلك لا يوجد ما يُلغى. | There is no email address on this card, so there is nothing to unsubscribe. |
| openCard | افتح بطاقتي | Open my card |

Added 27 October 2026, drafted by Claude, not yet reviewed: the welcome email, the Post to LinkedIn pages and
the LinkedIn caption. Generated from the source; `{company}` and `{first name}` are filled in per card.

## Welcome email (src/mail/welcome.ts, COPY; English is SPC's copy of 27 October 2026, verbatim)

| Key | Arabic | English |
|---|---|---|
| subject | أعمالك أصبحت رسمية. شارك الخبر مع العالم! | Your Business Is Official. Let the World Know! |
| preheader | إنجاز يستحق الاحتفال، وقصة تستحق المشاركة. | A milestone worth celebrating. A story worth sharing. |
| h1 | أعمالك أصبحت رسمية. شارك الخبر مع العالم! | Your Business Is Official. Let the World Know! |
| sub | إنجاز يستحق الاحتفال، وقصة تستحق المشاركة. | A milestone worth celebrating. A story worth sharing. |
| hello | مرحباً {first name}، | Hi {first name}, |
| congrats | تهانينا على حصولك على رخصتك التجارية من | Congratulations on receiving your business license with |
| congratsBold | المنطقة الحرة لمدينة الشارقة للنشر! | SPC Free Zone! |
| milestone | إنها محطة مميزة في رحلتك الريادية، ونؤمن أنها تستحق المشاركة. | This is an exciting milestone in your entrepreneurial journey, and we believe it's worth sharing. |
| prepared | جهّزنا لك صورة إعلان خاصة لتحتفل بهذا الإنجاز مع شبكة معارفك. | We've prepared a special announcement image to help you celebrate this achievement with your network. |
| cardAlt | إعلان الرخصة التجارية لشركة {company} | Business license announcement for {company} |
| draftBar | بطاقة إعلانك | Your announcement card |
| draft | مسودة | Draft |
| customise | خصّصها ← | Customise → |
| makeYours | قبل النشر، اجعلها بطابعك: | Before you post, make it yours: |
| chips | + أضف صورتك / غيّر العنوان / جرّب تصميماً آخر | + Add your photo / Change the headline / Try another style |
| readyTitle | إعلانك جاهز للمشاركة! | Your announcement is ready to share! |
| readyBody | ما عليك سوى تنزيل صورتك وإضافة لمستك الخاصة، ثم مشاركتها على لينكدإن أو منصتك المفضلة. | Simply download your image, add your personal touch, and share it on LinkedIn or your favourite social media platform. |
| make | شارك إنجازك | Share Your Milestone |
| linkedin | انشرها على لينكدإن | Post on LinkedIn |
| network | أخبر شبكتك عن مشروعك الجديد. قد يكون عميلك القادم أو شريكك التجاري أو فرصتك المقبلة على بُعد منشور واحد! | Let your network know about your new venture. Your next customer, business partner, or opportunity could be just one post away! |
| cheers | نتمنى لك بدايات جديدة وفرصاً أكبر. | Here's to new beginnings and bigger opportunities ahead. |
| welcome | أهلاً بك في مجتمع الأعمال في المنطقة الحرة لمدينة الشارقة للنشر! | Welcome to the SPC Free Zone business community! |
| regards | مع أطيب التحيات، | Best regards, |
| team | فريق المنطقة الحرة لمدينة الشارقة للنشر | Team SPC Free Zone |
| tollFree | الرقم المجاني | Toll Free Number |
| emailLabel | البريد الإلكتروني | Email |
| copyright | © {company} المنطقة الحرة لمدينة الشارقة للنشر | © {company} Sharjah Publishing City (SPC) Free Zone |
| location | الشارقة، الإمارات العربية المتحدة. | Sharjah, United Arab Emirates. |
| unsubscribe | إلغاء الاشتراك | Unsubscribe |

## Post to LinkedIn pages (src/linkedin/view.ts, LI_STRINGS)

| Key | Arabic | English |
|---|---|---|
| pill | النشر على لينكدإن | Post to LinkedIn |
| stepSignIn | تسجيل الدخول | Sign in |
| stepReview | المراجعة | Review |
| stepPosted | تم النشر | Posted |
| reviewTitle | راجع منشورك | Review your post |
| reviewLead | هكذا سيظهر منشورك على لينكدإن. عدّل النص إن أردت، ثم انشره. | This is how it will appear on your LinkedIn. Edit the text if you like, then post. |
| audience | أي شخص على لينكدإن أو خارجه | Anyone on or off LinkedIn |
| captionLabel | نص المنشور | Post text |
| linksNote | يصبح ‎@SPC Free Zone‎ والوسوم روابط على لينكدإن. | @SPC Free Zone and the hashtags become links on LinkedIn. |
| imageAlt | {company} مرخّصة رسمياً في المنطقة الحرة لمدينة الشارقة للنشر | {company} is officially licensed with SPC Free Zone |
| postNow | انشر الآن | Post now |
| posting | جارٍ النشر… | Posting… |
| backToCard | العودة إلى بطاقتي | Back to my card |
| fine | لا يُنشر شيء قبل أن تضغط «انشر الآن»، ويُنشر مرة واحدة فقط. لا تحتفظ المنطقة الحرة بأي صلاحية على حسابك في لينكدإن. | Nothing is posted until you press Post now, and it is posted once. SPC Free Zone does not keep access to your LinkedIn account. |
| tooLong | يسمح لينكدإن بـ 3,000 حرف كحد أقصى. يرجى اختصار النص. | LinkedIn allows up to 3,000 characters. Please shorten the text. |
| postedTitle | إعلانك منشور الآن | Your announcement is live |
| postedLead | {company} الآن على صفحتك في لينكدإن. | {company} is now on your LinkedIn feed. |
| viewPost | شاهد منشورك على لينكدإن | View your post on LinkedIn |
| postedTip | نصيحة: أشِر إلى شركائك وفريقك في تعليق، ليصل المنشور إلى شبكاتهم أيضاً. | Tip: tag your co-founders and team in a comment, so it reaches their networks too. |
| problemTitle | لم يُنشر منشورك | Your post was not published |
| tryAgain | حاول مرة أخرى | Try again |
| signInAgain | سجّل الدخول إلى لينكدإن مجدداً | Sign in to LinkedIn again |
| expiredTitle | انتهت مهلة هذا المنشور | This post has timed out |
| expiredBody | حفاظاً على أمانك، ينتظر المنشور 15 دقيقة فقط. ابدأ من جديد من بطاقتك؛ لن يستغرق ذلك سوى لحظة. | For your security, a post waits 15 minutes. Start again from your card; it takes a moment. |
| openCard | افتح بطاقتي | Open my card |
| portal | انتقل إلى بوابة العملاء | Go to the customer portal |
| cancelledTitle | لم يُنشر شيء | Nothing was posted |
| cancelledBody | لم تربط حساب لينكدإن، لذلك لم يُشارك شيء. لا يزال بإمكانك تنزيل بطاقتك ونشرها بنفسك. | You did not connect LinkedIn, so nothing was shared. You can still download your card and post it yourself. |
| errAuth | انتهت صلاحية تسجيل دخولك إلى لينكدإن. سجّل الدخول مجدداً للنشر. | Your LinkedIn sign-in has expired. Sign in again to post. |
| errDenied | لم يسمح لينكدإن بهذا المنشور من حسابك. نزّل بطاقتك وانشرها من لينكدإن مباشرة. | LinkedIn did not allow this post from your account. Download your card and post it from LinkedIn instead. |
| errRate | لينكدإن مشغول حالياً. انتظر دقيقة ثم حاول مرة أخرى. | LinkedIn is busy right now. Wait a minute and try again. |
| errRejected | لم يقبل لينكدإن المنشور. اختصر النص أو غيّره، ثم حاول مرة أخرى. | LinkedIn did not accept the post. Shorten or change the text, then try again. |
| errUpstream | تعذّر الوصول إلى لينكدإن. حاول مرة أخرى بعد قليل. | We could not reach LinkedIn. Try again in a moment. |
| errImage | تعذّر تجهيز صورة بطاقتك. عد إلى بطاقتك وحاول مرة أخرى. | Your card picture could not be prepared. Go back to your card and try again. |
| title | النشر على لينكدإن · المنطقة الحرة لمدينة الشارقة للنشر | Post to LinkedIn · SPC Free Zone |

## Default LinkedIn caption (src/linkedin/caption.ts; the studio's "Warm" caption)

| | Arabic | English |
|---|---|---|
| With a founder | خبر سعيد: أصبحت {company} شركة مرخّصة رسمياً.<br><br>سنركّز على {activity}، وأشكر كل من ساعدنا على الوصول إلى اليوم الأول.<br><br>بترخيص من @SPC Free Zone في الشارقة.<br><br>#مشروع_جديد #SPCFreeZone | Some personal news: {company} is now officially licensed.<br><br>We'll be focusing on {activity}, and I'm grateful to everyone who helped us reach day one.<br><br>Licensed with @SPC Free Zone, Sharjah.<br><br>#NewBusiness #SPCFreeZone |
| Without a founder | أصبحنا شركة مرخّصة رسمياً. {company} تفتح أبوابها للأعمال، مع التركيز على {activity}.<br><br>شكراً لكل من ساعدنا على الوصول إلى اليوم الأول.<br><br>بترخيص من @SPC Free Zone في الشارقة.<br><br>#مشروع_جديد #SPCFreeZone | We're now officially licensed. {company} is open for business, focusing on {activity}.<br><br>Thank you to everyone who helped us reach day one.<br><br>Licensed with @SPC Free Zone, Sharjah.<br><br>#NewBusiness #SPCFreeZone |

## Open wording questions

1. The official Arabic name of SPC Free Zone as used on the live site should
   replace "المنطقة الحرة لمدينة الشارقة للنشر" everywhere if it differs.
2. "بطاقة رخصة" (licence card) is used on the page even though the product
   is a social creative; say if "بطاقة" should be something else.
3. The caption hashtags are a marketing choice.
4. LinkedIn is written لينكدإن in the Arabic email and pages (the caption keeps the hashtag #SPCFreeZone and the
   mention "@SPC Free Zone" in Latin letters, since LinkedIn links them). Say if it should stay "LinkedIn".
5. The welcome email says "صورة إعلان" (announcement image), following SPC's English copy, where the page says "بطاقة رخصة".
