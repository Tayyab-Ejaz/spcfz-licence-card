class Component extends DCLogic {
  stageRef = React.createRef();
  cardRef = React.createRef();
  fileRef = React.createRef();
  state = { ...this.fresh(), stageW: 600 };

  fresh() {
    const pre = this.props.prefillFromLicense ?? true;
    const sample = this.props.samplePhoto ?? false;
    return {
      step: 0, view: 'card', tpl: ['dayone', 'daylight', 'pass'].includes(this.props.startTemplate) ? this.props.startTemplate : 'dayone', format: 'square',
      name: pre ? 'Mariam Fawzy' : '', role: pre ? 'Founder' : '',
      company: 'Lumen & Ledger FZ-LLC',
      activity: pre ? 'Financial advisory for small businesses' : '',
      hIdx: 0, customHead: '',
      photo: sample ? ((window.__resources && window.__resources.who3) || 'assets/who-3.jpg') : null, photoPos: '36% 26%', photoPosWide: '36% 24%', photoNote: 'From your portal profile',
      focus: 'both', imgMode: 'photo', logo: null, logoNote: '',
      caption: null, toast: '', busy: false, drag: false, sub: 0, subDone: [],
      lang: 'en', tone: 'warm', photoZoom: 1,
      ar: { company: 'لومن آند ليدجر ش.ذ.م.م - منطقة حرة', name: pre ? 'مريم فوزي' : '', role: pre ? 'المؤسِّسة' : '', activity: pre ? 'استشارات مالية للشركات الصغيرة' : '' }
    };
  }

  onWin = () => this.setState({ vh: window.innerHeight, vw: window.innerWidth });
  componentDidMount() {
    let cs = false;
    try { cs = !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/png' })], 'card.png', { type: 'image/png' })] })); } catch (e) {}
    this.setState({ canShare: cs });
    this.onWin(); window.addEventListener('resize', this.onWin);
    const el = this.stageRef.current;
    if (el && window.ResizeObserver) {
      this.ro = new ResizeObserver(([e]) => {
        const w = Math.round(e.contentRect.width);
        if (w !== this.state.stageW) this.setState({ stageW: w });
      });
      this.ro.observe(el);
    }
  }
  componentWillUnmount() { clearTimeout(this.subT); clearTimeout(this.preT); window.removeEventListener('resize', this.onWin); this.ro && this.ro.disconnect(); clearTimeout(this.tt); }
  componentDidUpdate(pp) {
    const p = this.props;
    if (pp.prefillFromLicense !== p.prefillFromLicense || pp.samplePhoto !== p.samplePhoto || pp.startTemplate !== p.startTemplate) this.setState(this.fresh());
  }

  showToast(msg) {
    clearTimeout(this.tt);
    this.setState({ toast: msg });
    this.tt = setTimeout(() => this.setState({ toast: '' }), 3400);
  }
  goStep = (i) => {
    if (i === 2 && this.state.step < 2) {
      const e = this.cardIssues();
      const bad = e.headline ? 3 : (e.name || e.role || e.activity) ? 2 : -1;
      if (bad >= 0) { this.setState({ step: 1, view: 'card', sub: bad }); this.showToast('Please fix the highlighted text first.'); return; }
    }
    this.setState({ step: i, view: i === 2 ? 'feed' : 'card' });
    if (i === 2 && this.state.canShare) { clearTimeout(this.preT); this.preT = setTimeout(() => this.prerender(), 600); }
  };
  brandIssue(t) {
    const x = (t || '').toLowerCase();
    if (!x.trim()) return '';
    if (/\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|asshole\w*|dick|piss\w*|crap|wtf)\b/.test(x)) return 'Please remove inappropriate language.';
    if (/(government|govt|sharjah|spc|free zone)[\s-]*(approved|endorsed|backed|certified)|(approved|endorsed|backed|certified) by|official (partner|government|spc)|partnership with spc|معتمد|شريك رسمي|بدعم من الحكومة/.test(x)) return "Cards can't suggest an endorsement by SPC or the Government of Sharjah. Please rephrase.";
    if (/\b(best|cheapest|fastest|no\.?\s?1|number one|guaranteed?)\b|#1|الأفضل|الأرخص|مضمون/.test(x)) return 'Claims like "best", "#1" or "guaranteed" can\'t appear next to the SPC logo.';
    return '';
  }
  cardIssues() {
    const s = this.state, T = s.lang === 'ar' ? { ...s, ...s.ar } : s, person = s.focus !== 'company';
    return { headline: s.hIdx === 6 ? this.brandIssue(s.customHead) : '', name: person ? this.brandIssue(T.name) : '', role: person ? this.brandIssue(T.role) : '', activity: this.brandIssue(T.activity) };
  }
  preflight() {
    const st = this.state;
    const e = this.cardIssues();
    const bad = e.headline ? 3 : (e.name || e.role || e.activity) ? 2 : -1;
    if (bad >= 0) { this.setState({ step: 1, view: 'card', sub: bad }); this.showToast('Please fix the highlighted text first.'); return false; }
    if ((st.imgMode === 'photo' && !st.photo) || (st.imgMode === 'logo' && !st.logo)) {
      this.setState({ step: 1, view: 'card', sub: 1 });
      this.showToast(st.imgMode === 'logo' ? 'Add your logo first, or choose Initials.' : 'Add your photo first, or choose Logo or Initials.');
      return false;
    }
    return true;
  }
  fileName() {
    const slug = (this.state.company.trim() || 'my-company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug}-announcement${this.state.lang === 'ar' ? '-ar' : ''}.png`;
  }
  stateKey() {
    const s = this.state;
    return JSON.stringify([s.tpl, s.format, s.lang, s.focus, s.imgMode, s.photoPos, s.photoZoom, s.hIdx, s.customHead, s.name, s.role, s.activity, s.ar, (s.photo || '').length, (s.logo || '').length]);
  }
  async renderCard(asBlob) {
    const node = this.cardRef.current, lib = window.htmlToImage;
    if (!node || !lib) throw new Error('unavailable');
    const st = this.state, isLs = st.format === 'landscape';
    const opts = { width: isLs ? 1200 : 1080, height: isLs ? 627 : st.format === 'portrait' ? 1350 : 1080, pixelRatio: 2, cacheBust: true, style: { transform: 'none' } };
    const fn = asBlob ? lib.toBlob : lib.toPng;
    try { return await fn(node, opts); } catch (e) { return await fn(node, { ...opts, skipFonts: true }); }
  }
  prerender = async () => {
    if (!this.state.canShare || this.state.step !== 2) return;
    const key = this.stateKey();
    if (this.cached && this.cached.key === key) return;
    try { const blob = await this.renderCard(true); if (blob) this.cached = { key, file: new File([blob], this.fileName(), { type: 'image/png' }) }; } catch (e) {}
  };
  shareCard = async () => {
    if (this.state.busy || !this.preflight()) return;
    const caption = this.state.caption ?? this.autoCaption();
    this.copyText(caption);
    const key = this.stateKey();
    let file = this.cached && this.cached.key === key ? this.cached.file : null;
    try {
      if (!file) {
        this.setState({ busy: true });
        const blob = await this.renderCard(true);
        file = new File([blob], this.fileName(), { type: 'image/png' });
        this.cached = { key, file };
        this.setState({ busy: false });
      }
      await navigator.share({ files: [file], text: caption });
    } catch (e) {
      this.setState({ busy: false });
      if (e && e.name === 'AbortError') return;
      if (e && e.name === 'NotAllowedError') { this.showToast('Your card is ready. Tap Share again.'); return; }
      this.showToast('Sharing didn\'t work here. Download the card instead.');
    }
  };
  field = (k, max) => (e) => this.setState({ [k]: e.target.value.slice(0, max) });
  lfield = (k, max) => (e) => { const val = e.target.value.slice(0, max); this.setState(s => s.lang === 'ar' ? { ar: { ...s.ar, [k]: val } } : { [k]: val }); };
  adjDown = (e) => {
    if (!this.state.photo) return;
    const el = e.currentTarget; try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const [x, y] = this.state.photoPos.split(' ').map(parseFloat);
    this.drag0 = { px: e.clientX, py: e.clientY, x: isNaN(x) ? 50 : x, y: isNaN(y) ? 35 : y, size: el.clientWidth || 112 };
  };
  adjMove = (e) => {
    const d = this.drag0; if (!d) return;
    const k = 100 / (d.size * (this.state.photoZoom || 1));
    const nx = Math.max(0, Math.min(100, d.x - (e.clientX - d.px) * k));
    const ny = Math.max(0, Math.min(100, d.y - (e.clientY - d.py) * k));
    this.setState({ photoPos: nx.toFixed(1) + '% ' + ny.toFixed(1) + '%' });
  };
  adjUp = () => { this.drag0 = null; };

  readFile = (f, target) => {
    if (!f || !/^image\//.test(f.type)) return;
    const r = new FileReader();
    r.onload = () => this.setState(target === 'logo'
      ? { logo: r.result, logoNote: f.name, imgMode: 'logo' }
      : { photo: r.result, photoPos: '50% 35%', photoPosWide: '50% 30%', photoZoom: 1, photoNote: f.name, imgMode: 'photo' }, () => { if (target === 'logo' && this.state.sub === 1) this.answerSub(1, 0); });
    r.readAsDataURL(f);
  };
  answerSub = (i, delay = 280) => {
    clearTimeout(this.subT);
    const run = () => this.setState(s => {
      const done = Array.from(new Set([...s.subDone, i]));
      let nx = [0, 1, 2, 3].find(j => j > i && !done.includes(j));
      if (nx === undefined) nx = [0, 1, 2, 3].find(j => !done.includes(j));
      return { subDone: done, sub: nx === undefined ? null : nx };
    });
    delay ? (this.subT = setTimeout(run, delay)) : run();
  };
  pickPhoto = () => { this.target = 'photo'; this.fileRef.current && this.fileRef.current.click(); };
  pickLogo = () => { this.target = 'logo'; this.fileRef.current && this.fileRef.current.click(); };
  onFile = (e) => { this.readFile(e.target.files && e.target.files[0], this.target); e.target.value = ''; };
  onDropPhoto = (e) => { e.preventDefault(); this.setState({ drag: false }); this.readFile(e.dataTransfer.files && e.dataTransfer.files[0], 'photo'); };
  onDropLogo = (e) => { e.preventDefault(); this.setState({ drag: false }); this.readFile(e.dataTransfer.files && e.dataTransfer.files[0], 'logo'); };
  setFocus = (focus) => this.setState(s => {
    let imgMode = s.imgMode;
    if (focus === 'company' && imgMode === 'photo') imgMode = s.logo ? 'logo' : 'initials';
    return { focus, imgMode };
  });
  onDragOver = (e) => { e.preventDefault(); if (!this.state.drag) this.setState({ drag: true }); };
  onDragLeave = () => this.setState({ drag: false });

  async copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove(); return ok;
    }
  }

  autoCaption() {
    const s = this.state, ar = s.lang === 'ar';
    const T = ar ? { ...s, ...s.ar } : s;
    const co = T.company.trim() || (ar ? 'شركتي' : 'my company');
    const act = T.activity.trim();
    const a = ar ? act : (act ? act.charAt(0).toLowerCase() + act.slice(1) : '');
    const exp = s.hIdx === 4 || s.hIdx === 5, f = s.focus, me = f === 'personal';
    const key = exp ? 'exp' : f, tone = s.tone || 'warm';
    if (!ar) {
      const we = me ? 'I' : 'We', our = me ? 'my' : 'our', subj = me ? 'My business' : co;
      const C = {
        warm: {
          both: `Some personal news: ${co} is now officially licensed.\n\n${a ? `We'll be focusing on ${a}, and I'm grateful to everyone who helped us reach day one.` : "I'm grateful to everyone who helped us reach day one."}`,
          company: `We're now officially licensed. ${co} is open for business${a ? `, focusing on ${a}` : ''}.\n\nThank you to everyone who helped us reach day one.`,
          personal: `Some personal news: I've officially started my own business${a ? `, focusing on ${a}` : ''}.\n\nI'm grateful to everyone who helped me reach day one.`,
          exp: `${me ? "I've" : "We've"} expanded to the UAE. ${subj} is now licensed and operating from Sharjah${a ? `, focusing on ${a}` : ''}.\n\nThank you to everyone who helped ${me ? 'me' : 'us'} open this new chapter.`
        },
        pro: {
          both: `I'm pleased to announce that ${co} is now licensed in the UAE.${a ? ` Our focus is ${a}.` : ''}\n\nIf you're looking for support in this area, I'd be glad to connect.`,
          company: `${co} is now licensed in the UAE.${a ? ` Our focus is ${a}.` : ''}\n\nWe welcome conversations with clients and partners.`,
          personal: `I'm pleased to announce that I've launched my own business in the UAE.${a ? ` My focus is ${a}.` : ''}\n\nIf you're looking for support in this area, I'd be glad to connect.`,
          exp: `${subj} is now licensed in the UAE${a ? `, bringing ${our} work in ${a} to clients in the region` : ''}.\n\n${we} welcome conversations with clients and partners here.`
        },
        short: {
          both: `${co} is officially licensed. Day one starts now.`,
          company: `${co} is officially licensed. Day one starts now.`,
          personal: "I've officially started my own business. Day one starts now.",
          exp: `${me ? "I've" : co + ' has'} expanded to the UAE. A new chapter starts here.`
        }
      };
      const tags = (exp ? '#UAE #Expansion' : '#NewBusiness') + (me ? ' #Founder' : '') + ' #SPCFreeZone';
      return C[tone][key] + (tone === 'short' ? `\n\n@SPC Free Zone ${exp ? '#UAE' : '#NewBusiness'}` : `\n\nLicensed with @SPC Free Zone, Sharjah.\n\n${tags}`);
    }
    const C = {
      warm: {
        both: `خبر سعيد: أصبحت ${co} شركة مرخّصة رسمياً.\n\n${a ? `سنركّز على ${a}، وأشكر كل من ساعدنا على الوصول إلى اليوم الأول.` : 'أشكر كل من ساعدنا على الوصول إلى اليوم الأول.'}`,
        company: `أصبحنا شركة مرخّصة رسمياً. ${co} تفتح أبوابها للأعمال${a ? `، مع التركيز على ${a}` : ''}.\n\nشكراً لكل من ساعدنا على الوصول إلى اليوم الأول.`,
        personal: `خبر سعيد: بدأت مشروعي الخاص رسمياً${a ? `، مع التركيز على ${a}` : ''}.\n\nأشكر كل من ساعدني على الوصول إلى اليوم الأول.`,
        exp: me ? `توسّعت بأعمالي إلى دولة الإمارات، وأصبح مشروعي مرخّصاً ويعمل من الشارقة${a ? `، مع التركيز على ${a}` : ''}.\n\nشكراً لكل من ساعدني على بدء هذا الفصل الجديد.`
                : `توسّعنا إلى دولة الإمارات. أصبحت ${co} مرخّصة وتعمل من الشارقة${a ? `، مع التركيز على ${a}` : ''}.\n\nشكراً لكل من ساعدنا على بدء هذا الفصل الجديد.`
      },
      pro: {
        both: `يسعدني أن أعلن أن ${co} أصبحت مرخّصة في دولة الإمارات.${a ? ` مجال تركيزنا: ${a}.` : ''}\n\nإذا كنت تبحث عن دعم في هذا المجال، يسعدني التواصل معك.`,
        company: `أصبحت ${co} مرخّصة في دولة الإمارات.${a ? ` مجال تركيزنا: ${a}.` : ''}\n\nنرحّب بالتواصل مع العملاء والشركاء.`,
        personal: `يسعدني أن أعلن عن إطلاق مشروعي الخاص في دولة الإمارات.${a ? ` مجال تركيزي: ${a}.` : ''}\n\nإذا كنت تبحث عن دعم في هذا المجال، يسعدني التواصل معك.`,
        exp: me ? `أصبح مشروعي مرخّصاً في دولة الإمارات${a ? `، لأقدّم خدماتي في مجال ${a} للعملاء في المنطقة` : ''}.\n\nأرحّب بالتواصل مع العملاء والشركاء هنا.`
                : `أصبحت ${co} مرخّصة في دولة الإمارات${a ? `، لنقدّم خدماتنا في مجال ${a} للعملاء في المنطقة` : ''}.\n\nنرحّب بالتواصل مع العملاء والشركاء هنا.`
      },
      short: {
        both: `أصبحت ${co} مرخّصة رسمياً. اليوم الأول يبدأ الآن.`,
        company: `أصبحت ${co} مرخّصة رسمياً. اليوم الأول يبدأ الآن.`,
        personal: 'بدأت مشروعي الخاص رسمياً. اليوم الأول يبدأ الآن.',
        exp: me ? 'توسّعت بأعمالي إلى دولة الإمارات. فصل جديد يبدأ هنا.' : `${co} الآن في دولة الإمارات. فصل جديد يبدأ هنا.`
      }
    };
    const tags = (exp ? '#الإمارات #توسع' : '#مشروع_جديد') + ' #SPCFreeZone';
    return C[tone][key] + (tone === 'short' ? `\n\n@SPC Free Zone ${exp ? '#الإمارات' : '#مشروع_جديد'}` : `\n\nبترخيص من @SPC Free Zone في الشارقة.\n\n${tags}`);
  }

  download = async () => {
    if (this.state.busy || !this.preflight()) return;
    if (!this.cardRef.current || !window.htmlToImage) { this.showToast('Download isn\'t available in this preview.'); return; }
    this.setState({ busy: true });
    try {
      const url = await this.renderCard(false);
      const a = document.createElement('a');
      a.href = url; a.download = this.fileName();
      document.body.appendChild(a); a.click(); a.remove();
      this.showToast('Card downloaded at 2× resolution. It\'s ready to post.');
    } catch (e) {
      this.showToast('We couldn\'t create the image. Please try again.');
    }
    this.setState({ busy: false });
  };

  renderVals() {
    const s = this.state;
    const ar = s.lang === 'ar';
    const T = ar ? { ...s, ...s.ar } : s;
    const fz = (n) => ar ? Math.round(n * .8) : n;
    const presets = ar ? ['بدأنا العمل رسمياً.', 'اليوم الأول.', 'أصبح الأمر رسمياً.', 'أبوابنا مفتوحة الآن.', 'الآن في الإمارات.', 'افتتحنا فرعنا في الإمارات.'] : ['Officially in business.', 'Day one.', "It's official.", 'Now open for business.', 'Now in the UAE.', 'Our UAE branch is open.'];
    const headline = s.hIdx === 6 ? (s.customHead.trim() || (ar ? 'عنوانك هنا' : 'Your headline')) : presets[s.hIdx];
    const kicker = ar ? ((s.hIdx === 4 || s.hIdx === 5) ? 'انطلاقة في الإمارات · أكتوبر 2026' : 'مشروع جديد · أكتوبر 2026') : ((s.hIdx === 4 || s.hIdx === 5) ? 'UAE launch · October 2026' : 'New business · October 2026');
    const companyText = T.company.trim() || 'Your Company';
    const nameText = T.name.trim() || (ar ? 'اسمك' : 'Your Name');
    const words = (s.name.trim() || s.company.trim()).split(/\s+/).filter(Boolean);
    const initials = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() : '+';
    const role = T.role.trim();
    const activity = T.activity.trim();

    const isSq = s.format === 'square', isLand = s.format === 'landscape';
    const nativeW = isLand ? 1200 : 1080;
    const cardH = isLand ? 627 : isSq ? 1080 : 1350;
    const feed = s.view === 'feed';
    const avail = Math.max(240, s.stageW || 600);
    const side = (s.vw || 1280) >= 1000;
    const mobile = (s.vw || 1280) < 760;
    const mStick = mobile && s.step < 2;
    const budget = side ? (s.vh || 900) - 32 - 2 * Math.min(40, Math.max(16, (s.vw || 1280) * .035)) - 60 - (feed ? 200 : 0) : mStick ? Math.min((s.vh || 800) * .34, 300) : 9999;
    const fitW = Math.max(mStick ? 150 : 260, budget * nativeW / cardH);
    const dispW = Math.floor(Math.min(fitW, feed ? Math.min(avail, isLand ? 560 : 520) : Math.min(avail, isLand ? 680 : isSq ? 600 : 540)));
    const scale = dispW / nativeW;
    const dispH = Math.round(cardH * scale);

    const pick = (len, steps) => (steps.find(([m]) => len <= m) || steps[steps.length - 1])[1];
    const cl = companyText.length, hl = headline.length;

    const caption = s.caption ?? this.autoCaption();
    const on = { bg: '#fff', fg: 'var(--spc-ink)', shadow: '0 1px 3px rgba(7,19,41,.14)' };
    const off = { bg: 'transparent', fg: 'var(--spc-muted)', shadow: 'none' };

    const ring = {}, sel = {};
    ['dayone', 'daylight', 'pass'].forEach(t => {
      sel[t] = s.tpl === t;
      ring[t] = sel[t] ? '0 0 0 2px var(--spc-blue), 0 10px 24px rgba(0,77,255,.12)' : '0 0 0 1px var(--spc-border)';
    });

    const steps = ['Style', 'Details', 'Share'].map((label, i) => ({
      num: i + 1, label, done: i < s.step, notDone: i >= s.step, notLast: i < 2, flex: i < 2 ? '1 1 auto' : '0 0 auto',
      circleBg: i === s.step ? 'var(--spc-blue)' : i < s.step ? 'var(--success-100)' : 'var(--spc-soft)',
      circleFg: i === s.step ? '#fff' : i < s.step ? 'var(--success-500)' : 'var(--spc-muted)',
      labelColor: i === s.step ? 'var(--spc-ink)' : 'var(--spc-muted)',
      lineBg: i < s.step ? 'var(--success-500)' : 'var(--spc-border)',
      onClick: () => this.goStep(i)
    }));

    const chips = [...presets, 'Write your own'].map((label, i) => {
      const a = s.hIdx === i;
      return { label, bg: a ? 'var(--spc-ink)' : '#fff', fg: a ? '#fff' : 'var(--spc-ink)', border: a ? 'var(--spc-ink)' : 'var(--spc-border)', onClick: () => { this.setState({ hIdx: i }); if (i < 6) this.answerSub(3); } };
    });

    const first = T.name.trim().split(/\s+/)[0];
    const ini = (ws) => ws.length ? (ws[0][0] + (ws.length > 1 ? ws[ws.length - 1][0] : '')).toUpperCase() : '';
    const nameIni = ini(s.name.trim().split(/\s+/).filter(Boolean));
    const coIni = ini(s.company.replace(/\b(FZ-?LLC|FZE|FZCO|LLC)\b/gi, '').split(/[\s&]+/).filter(x => /^[A-Za-z0-9]/.test(x)));
    const showPerson = s.focus !== 'company', showCompany = s.focus !== 'personal';
    const kind = s.imgMode === 'photo' ? (s.photo ? 'photo' : 'placeholder') : s.imgMode === 'logo' ? (s.logo ? 'logo' : 'placeholder') : 'initials';
    const imgIni = (s.focus === 'company' ? (coIni || nameIni) : (nameIni || coIni)) || '+';
    const img = { isPhoto: kind === 'photo', isLogo: kind === 'logo', isInitials: kind === 'initials', isPlaceholder: kind === 'placeholder', icon: s.imgMode === 'logo' ? 'ph-buildings' : 'ph-user', initials: imgIni, radius: s.imgMode === 'logo' && kind !== 'initials' ? '30px' : '50%' };
    const actOrFallback = activity || (ar ? 'مشروعي الخاص' : 'My own business');
    const midTitle = showCompany ? companyText : actOrFallback;
    const dMid = s.focus === 'both' ? companyText : actOrFallback;
    const v = {
      showPerson, showCompany, companyOnly: !showPerson, midTile: !showPerson,
      midTitle, midTitleNB: midTitle.replace(/-/g, '\u2011'), midOpacity: showCompany ? (T.company.trim() ? 1 : .45) : (activity ? 1 : .45),
      hasMidSub: showCompany && !!activity, midSub: activity,
      dTop: showPerson ? nameText : companyText,
      dTopOpacity: showPerson ? (T.name.trim() ? 1 : .45) : (T.company.trim() ? 1 : .45),
      dTopSub: showPerson ? role : activity, hasDTopSub: showPerson ? !!role : !!activity,
      hasDMid: s.focus !== 'company', dMid, dMidOpacity: s.focus === 'both' ? (T.company.trim() ? 1 : .45) : (activity ? 1 : .45),
      hasDMidSub: s.focus === 'both' && !!activity,
      actLabel: ar ? (s.focus === 'personal' ? 'مجال عملي' : 'مجال عملنا') : (s.focus === 'personal' ? 'WHAT I DO' : 'WHAT WE DO'),
      actSpan: s.focus === 'company' ? '1 / -1' : 'auto'
    };
    const rowRing = (a) => a ? '0 0 0 2px var(--spc-blue)' : '0 0 0 1px var(--spc-border)';
    const base = { hasImg: false, isGlyph: false, isText: false, canReplace: false, imgPos: 'center' };
    const aboutOpts = [
      ['both', 'You and your company', 'Your name and role, plus the company name', 'ph-users'],
      ['company', 'The company', 'Company name and activity, without your name', 'ph-buildings'],
      ['personal', 'Just you', 'Your name and role, without the company name', 'ph-user']
    ].map(([k, title, desc, icon]) => ({ ...base, title, desc, icon, isGlyph: true, radius: '14px', tileBg: 'var(--blue-50)', tileFg: 'var(--spc-blue)',
      selected: s.focus === k, bg: s.focus === k ? 'var(--blue-50)' : '#fff', ring: rowRing(s.focus === k), onClick: () => { this.setFocus(k); this.answerSub(0); } }));
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    const imgRows = [
      { k: 'photo', title: s.photo ? 'Your photo' : 'Upload a photo', desc: s.photo ? s.photoNote : 'A headshot, JPG or PNG. Drop it here or click.', has: s.photo, imgBg: s.photo ? `url("${s.photo}")` : 'none', imgSize: 'cover', imgPos: s.photoPos, icon: 'ph-camera', radius: '50%',
        pick: this.pickPhoto, remove: () => this.setState({ photo: null, imgMode: 'initials' }), drop: this.onDropPhoto },
      { k: 'logo', title: s.logo ? 'Company logo' : 'Upload your company logo', desc: s.logo ? s.logoNote : 'PNG with a transparent background works best', has: s.logo, imgBg: s.logo ? `url("${s.logo}")` : 'none', imgSize: 'contain', icon: 'ph-squares-four', radius: '12px',
        pick: this.pickLogo, remove: () => this.setState({ logo: null, imgMode: 'initials' }), drop: this.onDropLogo },
      { k: 'initials', title: 'Use initials', desc: `"${imgIni}" in SPC blue, nothing to upload`, isText: true, text: imgIni, radius: '50%' }
    ].map(o => {
      const selected = s.imgMode === o.k && (o.k === 'initials' || !!o.has);
      return { ...base, ...o, hasImg: !!o.has, isGlyph: o.k !== 'initials' && !o.has,
        tileBg: o.k === 'initials' ? 'var(--spc-blue)' : 'var(--blue-50)', tileFg: o.k === 'initials' ? '#fff' : 'var(--spc-blue)',
        selected, bg: selected ? 'var(--blue-50)' : (s.drag && o.drop ? 'var(--blue-50)' : '#fff'), ring: rowRing(selected),
        canReplace: !!o.has && selected, onReplace: o.pick ? stop(o.pick) : undefined, onRemove: o.remove ? stop(o.remove) : undefined,
        onDragOver: o.drop ? this.onDragOver : undefined, onDragLeave: o.drop ? this.onDragLeave : undefined, onDrop: o.drop,
        onClick: () => {
          if (o.k === 'initials') { this.setState({ imgMode: 'initials' }); return this.answerSub(1); }
          if (o.has) { this.setState({ imgMode: o.k }); return this.answerSub(1); }
          o.pick();
        } };
    });
    const segOf = (val) => (k) => val === k ? on : off;
    const imgSum = s.imgMode === 'photo' ? (s.photo ? 'Your photo' : 'Photo, not added') : s.imgMode === 'logo' ? (s.logo ? 'Company logo' : 'Logo, not added') : `Initials, ${imgIni}`;
    const detSum = s.focus === 'personal' ? [nameText, role].filter(Boolean).join(', ') : [companyText, activity].filter(Boolean).join(' · ');
    const errs = this.cardIssues();
    const sq = {};
    [['about', { both: 'You and your company', company: 'The company', personal: 'Just you' }[s.focus]], ['image', imgSum], ['details', detSum], ['headline', headline]].forEach(([k, value], i) => {
      const open = s.sub === i, done = s.subDone.includes(i);
      sq[k] = { value, open, collapsed: !open && done, upcoming: !open && !done, onOpen: () => this.setState({ sub: i }), onDone: () => { if ((i === 2 && (errs.name || errs.role || errs.activity)) || (i === 3 && errs.headline)) return; this.answerSub(i, 0); } };
    });
    const fs = segOf(s.focus), is = segOf(s.imgMode);

    return {
      stageRef: this.stageRef, cardRef: this.cardRef, fileRef: this.fileRef,
      feed, segCard: feed ? off : on, segFeed: feed ? on : off,
      viewCard: () => this.setState({ view: 'card' }), viewFeed: () => this.setState({ view: 'feed' }),
      sizeLabel: isLand ? '1200 × 627 px' : isSq ? '1080 × 1080 px' : '1080 × 1350 px',
      stageNote: feed ? 'Approximate preview of how your post appears in a feed.' : 'Exports as a PNG, sized for LinkedIn.',
      nativeW,
      lDaylight: isLand && s.tpl === 'daylight', lPass: isLand && s.tpl === 'pass', lDayone: isLand && s.tpl === 'dayone',
      lHead: fz(pick(hl, [[10, 92], [16, 80], [24, 68], [99, 58]])),
      lMid: pick(v.dMid.length, [[22, 40], [32, 34], [99, 30]]),
      lpLHead: fz(pick(hl, [[10, 84], [16, 70], [24, 60], [99, 50]])),
      lpLCo: pick(cl, [[24, 26], [34, 23], [99, 20]]),
      lDyHead: fz(pick(hl, [[10, 84], [16, 74], [24, 62], [99, 54]])),
      lDyCo: pick(midTitle.length, [[18, 38], [26, 34], [36, 29], [99, 25]]),
      segLs: isLand ? on : off, fmtLandscape: () => this.setState({ format: 'landscape' }),
      fmtHelper: isLand ? 'Landscape, 1200 × 627. LinkedIn\'s standard wide image size, good for desktop feeds.' : isSq ? 'Square, 1080 × 1080. Works in any feed.' : 'Portrait, 1080 × 1350. Fills more of the screen on phones.',
      dispW, dispH, cardH, scale, stagePos: side || mStick ? 'sticky' : 'relative', stageTop: side ? '16px' : '0px',
      stageZ: mobile ? 6 : 'auto', stageMargin: mobile ? '0 calc(-1 * clamp(16px,4vw,48px))' : '0', stageRadius: mobile ? '0 0 22px 22px' : '26px',
      stagePad: mobile ? '14px 16px 16px' : 'clamp(16px,3.5vw,40px)', stageGap: mobile ? 10 : 24, sizeRowDisp: mobile ? 'none' : 'flex',
      logoH: mobile ? 38 : 52, headerH: mobile ? 64 : 76, backLabel: mobile ? 'Portal' : 'Back to Customer Portal',
      mainPb: mobile ? 120 : 72, headPad: mobile ? '22px 0 18px' : '40px 0 32px', colGap: mobile ? 18 : 32,
      asideMax: mobile ? 'none' : '460px', asideBorder: mobile ? 'none' : '1px solid var(--spc-border)', asideShadow: mobile ? 'none' : 'var(--spc-shadow-sm)', asidePad: mobile ? '4px 0 0' : '26px 26px 22px',
      navPos: mobile ? 'fixed' : 'static', navZ: mobile ? 20 : 'auto', navPad: mobile ? '12px 16px calc(12px + env(safe-area-inset-bottom))' : '18px 0 0', navShadow: mobile ? '0 -10px 24px rgba(7,19,41,.08)' : 'none',
      toastB: mobile ? 96 : 28, tapH: mobile ? 44 : 0, segH: mobile ? 44 : 38,
      canShare: !!s.canShare, shareCard: this.shareCard, shareLabel: s.busy ? 'Preparing…' : 'Share card', dlVariant: s.canShare ? 'secondary' : 'primary',
      frameRadius: feed ? '12px' : '6px',
      frameShadow: feed ? '0 18px 40px rgba(7,19,41,.10), 0 0 0 1px var(--spc-border)' : '0 34px 70px -24px rgba(7,19,41,.45), 0 0 0 1px rgba(7,19,41,.04)',
      isDayone: s.tpl === 'dayone' && !isLand, isDaylight: s.tpl === 'daylight' && !isLand, isPass: s.tpl === 'pass' && !isLand,
      headline, companyText, nameText, initials, role, activity,
      hasRole: !!role, hasActivity: !!activity,
      roleLine: role || (ar ? 'المؤسس' : 'Founder'),
      feedSub: ar ? (s.focus === 'personal' ? (role || 'المؤسس') : `${role || 'المؤسس'} في ${companyText}`) : (s.focus === 'personal' ? (role || 'Founder') : `${role || 'Founder'} at ${companyText}`),
      v, img, aboutOpts, imgRows, sq, errs,
      logoBg: s.logo ? `url("${s.logo}")` : 'none', hasLogo: !!s.logo, noLogo: !s.logo, logoNote: s.logoNote,
      modePhoto: s.imgMode === 'photo', modeLogo: s.imgMode === 'logo', modeInitials: s.imgMode === 'initials',
      focusSeg: { both: fs('both'), company: fs('company'), personal: fs('personal') },
      imgSeg: { photo: is('photo'), logo: is('logo'), initials: is('initials') },
      focusBoth: () => this.setFocus('both'), focusCompany: () => this.setFocus('company'), focusPersonal: () => this.setFocus('personal'),
      imgPhoto: () => this.setState({ imgMode: 'photo' }), imgLogo: () => this.setState({ imgMode: 'logo' }), imgInitials: () => this.setState({ imgMode: 'initials' }),
      focusHelper: s.focus === 'company' ? 'Company name and activity only. Your name stays off the card.' : s.focus === 'personal' ? 'Your name and role, without the company name.' : 'Your name and your company together.',
      initialsNote: `The card shows "${imgIni}" in SPC blue, taken from your ${s.focus === 'company' ? 'company name' : 'name'}.`,
      actFieldLabel: s.focus === 'personal' ? 'What you do' : 'What your company does',
      pickLogo: this.pickLogo, removeLogo: () => this.setState({ logo: null }),
      onDropPhoto: this.onDropPhoto, onDropLogo: this.onDropLogo,
      coOpacity: T.company.trim() ? 1 : .45, nameOpacity: T.name.trim() ? 1 : .45,
      monthYear: ar ? 'أكتوبر 2026' : 'October 2026', year: '2026', dateFull: ar ? '8 أكتوبر 2026' : '8 October 2026',
      lpHeadSize: Math.round(pick(hl, [[10, 110], [16, 96], [24, 84], [99, 72]]) * (ar ? .62 : 1)),
      lpCoSize: pick(cl, [[24, 36], [34, 31], [99, 27]]),
      photo: s.photo, photoBg: s.photo ? `url("${s.photo}")` : 'none', hasPhoto: !!s.photo, noPhoto: !s.photo, photoPos: s.photoPos, photoPosWide: s.photoPosWide, photoNote: s.photoNote,
      dyHeadSize: fz(pick(hl, [[10, 96], [16, 86], [24, 74], [99, 64]])),
      dyCoSize: pick(midTitle.length, [[18, 44], [26, 40], [36, 34], [99, 30]]),
      calMonth: ar ? 'أكتوبر 2026' : 'OCT 2026', calDay: '8',
      mCoSize: pick(midTitle.length, [[22, 60], [32, 52], [99, 44]]),
      dHeadSize: fz(pick(hl, [[10, 124], [16, 108], [24, 94], [99, 80]])),
      dCoSize: pick(dMid.length, [[22, 60], [32, 52], [99, 44]]),
      pCoSize: pick(cl, [[16, 84], [24, 72], [34, 60], [99, 52]]),
      pPhotoH: isSq ? 600 : 800,
      ring, sel,
      pickDayone: () => this.setState({ tpl: 'dayone' }), pickDaylight: () => this.setState({ tpl: 'daylight' }),
      pickPass: () => this.setState({ tpl: 'pass' }),
      segSq: isSq ? on : off, segPt: s.format === 'portrait' ? on : off,
      fmtSquare: () => this.setState({ format: 'square' }), fmtPortrait: () => this.setState({ format: 'portrait' }),
      steps, isStep0: s.step === 0, isStep1: s.step === 1, isStep2: s.step === 2,
      canBack: s.step > 0, noBack: s.step === 0, canNext: s.step < 2,
      nextLabel: s.step === 0 ? 'Next: Details' : 'Next: Share',
      next: () => this.goStep(Math.min(2, s.step + 1)), back: () => this.goStep(Math.max(0, s.step - 1)),
      name: T.name, company: T.company, isAr: ar, coLockNote: ar ? 'Arabic name as registered on license 4425153.01. It can\'t be changed here.' : 'As registered on license 4425153.01. It can\'t be changed here.', stubNameSq: ar ? 24 : 30, stubNameLs: ar ? 17 : 22, lang: s.lang, dir: ar ? 'rtl' : 'ltr',
      t: ar ? { licensedWith: 'بترخيص من', dayOne: 'اليوم الأول', launchPass: 'تذكرة الانطلاق', estYear: 'تأسست 2026', from: 'من', to: 'إلى', idea: 'فكرة', business: 'مشروع', company: 'الشركة', licensed: 'تاريخ الترخيص', founder: 'المؤسس', licensedSm: 'تاريخ الترخيص' }
            : { licensedWith: 'Licensed with', dayOne: 'Day one', launchPass: 'LAUNCH PASS', estYear: 'EST. 2026', from: 'FROM', to: 'TO', idea: 'Idea', business: 'Business', company: 'COMPANY', licensed: 'LICENSED', founder: 'FOUNDER', licensedSm: 'Licensed' },
      lpA: ar ? 'auto' : '64px', lpB: ar ? '64px' : 'auto', lpC: ar ? '56px' : 'auto', lpD: ar ? 'auto' : '56px',
      segEn: ar ? off : on, segAr: ar ? on : off,
      langEn: () => this.setState({ lang: 'en', caption: null }), langAr: () => this.setState({ lang: 'ar', caption: null }),
      langHelper: ar ? 'The card and suggested caption are in Arabic, using your company\'s registered Arabic name.' : 'Switch to Arabic for an Arabic card and caption.',
      tones: [['warm', 'Warm'], ['pro', 'Professional'], ['short', 'Short']].map(([k, label]) => ({ label, ...((s.tone || 'warm') === k ? on : off), onClick: () => this.setState({ tone: k, caption: null }) })),
      photoZoom: s.photoZoom || 1, showAdjust: s.imgMode === 'photo' && !!s.photo,
      adjDown: this.adjDown, adjMove: this.adjMove, adjUp: this.adjUp,
      onZoom: (e) => this.setState({ photoZoom: parseFloat(e.target.value) || 1 }),
      resetAdjust: () => this.setState({ photoPos: '50% 35%', photoZoom: 1 }), customHead: s.customHead,
      onName: this.lfield('name', 40), onRole: this.lfield('role', 40), onCompany: this.field('company', 48),
      onActivity: this.lfield('activity', 60), onCustomHead: this.field('customHead', 32),
      activityHelper: `Shown on the card · ${T.activity.length}/60`,
      headHelper: `${s.customHead.length}/32 characters`,
      kicker, chips, isCustom: s.hIdx === 6,
      pickPhoto: this.pickPhoto, removePhoto: () => this.setState({ photo: null }), onFile: this.onFile,
      onDragOver: this.onDragOver, onDragLeave: this.onDragLeave,
      dropBorder: s.drag ? 'var(--spc-blue)' : 'var(--gray-300)', dropBg: s.drag ? 'var(--blue-50)' : '#fff',
      caption, captionEdited: s.caption !== null,
      captionHelper: s.caption !== null ? 'Edited by you' : 'Suggested from your details. Edit it however you like.',
      onCaption: (e) => this.setState({ caption: e.target.value }),
      resetCaption: () => this.setState({ caption: null }),
      copyCaption: async () => { const ok = await this.copyText(caption); this.showToast(ok ? 'Caption copied.' : 'Couldn\'t copy. Select the text and copy it manually.'); },
      openLinkedIn: async () => {
        await this.copyText(caption);
        window.open('https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(caption), '_blank', 'noopener');
        this.showToast('Caption copied. Attach your downloaded card in LinkedIn.');
      },
      download: this.download, downloadLabel: s.busy ? 'Preparing…' : 'Download card',
      toast: s.toast, hasToast: !!s.toast
    };
  }
}
