import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Lock, LoaderCircle } from 'lucide-react';
import { t } from '../i18n';

type Plan = 'monthly' | 'yearly';
type PaymentState = 'confirmed' | 'processing' | 'canceled' | 'failed';
type Configuration = { available: boolean; portalUrl: string | null };
const api = '/api/billing';

async function readJson(url: string, options: RequestInit = {}) {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  if (!response.ok) throw new Error('Billing request failed');
  return response.json();
}

export function SubscriptionCheckout() {
  const [plan, setPlan] = useState<Plan>('monthly');
  const [email, setEmail] = useState('');
  const [config, setConfig] = useState<Configuration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<PaymentState | null>(null);
  const [verifyError, setVerifyError] = useState(false);
  const [configRevision, reloadConfig] = useState(0);
  const [verifyRevision, retryVerification] = useState(0);
  const submitting = useRef(false);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const [returnInfo] = useState(() => {
    const params = new URLSearchParams(location.search);
    return { checkout: params.get('checkout'), session: params.get('session_id') };
  });

  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    readJson(`${api}/config`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setConfig({ available: data.available === true, portalUrl: typeof data.portalUrl === 'string' && /^https:\/\/billing\.stripe\.com\/p\/login\//.test(data.portalUrl) ? data.portalUrl : null });
    }).catch(() => { if (!controller.signal.aborted) setConfig({ available: false, portalUrl: null }); }).finally(() => clearTimeout(timeout));
    const timeout = window.setTimeout(() => { setConfig({ available: false, portalUrl: null }); controller.abort(); }, 15000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [configRevision]);

  useEffect(() => {
    if (!returnInfo.checkout) return;
    const cleaned = new URL(location.href);
    cleaned.searchParams.delete('checkout'); cleaned.searchParams.delete('session_id');
    history.replaceState(null, '', `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
    if (returnInfo.checkout === 'canceled') { setStatus('canceled'); return; }
    if (returnInfo.checkout !== 'success' || !returnInfo.session) { setVerifyError(true); return; }
    const controller = new AbortController(); let timer: number | undefined; let polls = 0;
    setVerifyError(false); setStatus('processing');
    const verify = async () => {
      try {
        const data = await readJson(`${api}/status?session_id=${encodeURIComponent(returnInfo.session!)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!['confirmed', 'processing', 'canceled', 'failed'].includes(data.status)) throw new Error('Invalid status');
        setStatus(data.status);
        if (data.status === 'processing' && ++polls < 6) timer = window.setTimeout(verify, 3000);
      } catch { if (!controller.signal.aborted) setVerifyError(true); }
    };
    void verify();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [returnInfo, verifyRevision]);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !config?.available || status === 'confirmed' || status === 'processing' || status === 'failed') return;
    submitting.current = true; setBusy(true); setError('');
    const payload = JSON.stringify([plan, email.trim()]);
    if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
    try {
      const data = await readJson(`${api}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, email: email.trim(), attemptId: attempt.current.id }) });
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Invalid checkout destination');
      location.assign(url.href);
    } catch { setError(t('subscription.checkoutError')); } finally { submitting.current = false; setBusy(false); }
  }

  return (
    <section id="subscribe" aria-labelledby="subscription-title" className="scroll-mt-20 border-y border-wm-border bg-[#090d0b] px-6 py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1fr_1.1fr] md:gap-20">
        <div>
          <p className="mb-6 font-mono text-xs uppercase tracking-[0.22em] text-wm-green">World Monitor / Pro</p>
          <h2 id="subscription-title" className="max-w-md font-display text-4xl font-bold leading-tight md:text-5xl">{t('subscription.title')}</h2>
          <p className="mt-6 max-w-md leading-relaxed text-wm-muted">{t('subscription.description')}</p>
          <div className="mt-10 space-y-4 border-t border-wm-border pt-6 text-sm text-wm-muted">
            {[t('subscription.emailBased'), t('subscription.manageFeature'), t('subscription.secureFeature')].map(copy => <p key={copy} className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-wm-green" aria-hidden="true" />{copy}</p>)}
          </div>
          <p className="mt-8 max-w-md text-xs leading-relaxed text-wm-muted">{t('subscription.accessNote')}</p>
        </div>
        <div className="min-w-0 border border-wm-border bg-wm-bg p-5 sm:p-8">
          <form onSubmit={checkout}>
            <fieldset disabled={busy}>
              <legend className="mb-4 font-mono text-xs uppercase tracking-widest text-wm-muted">{t('subscription.billingCycle')}</legend>
              <div className="grid grid-cols-2 gap-3">
                {(['monthly', 'yearly'] as const).map(choice => <label key={choice} className={`relative cursor-pointer border p-4 transition-colors ${plan === choice ? 'border-wm-green bg-wm-green/5' : 'border-wm-border hover:border-wm-muted'}`}>
                  <input type="radio" name="billing-cycle" value={choice} checked={plan === choice} onChange={() => { setPlan(choice); setError(''); }} className="mb-4 accent-green-400" />
                  <span className="block text-sm font-medium">{t(`subscription.${choice}`)}</span>
                  <span className="mt-3 block font-mono text-xl font-bold sm:text-2xl">{choice === 'monthly' ? '10 USD' : '100 USD'}</span>
                  <span className="mt-1 block text-xs text-wm-muted">{t(`subscription.${choice}Charge`)}</span>
                </label>)}
              </div>
            </fieldset>
            {plan === 'yearly' ? <p className="mt-3 font-mono text-xs text-wm-green">{t('subscription.yearlySaving')}</p> : <p className="mt-3 font-mono text-xs text-wm-muted">{t('subscription.monthlyFlexibility')}</p>}
            <label htmlFor="billing-email" className="mb-2 mt-8 block text-sm">{t('subscription.email')}</label>
            <input id="billing-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => { setEmail(event.target.value); setError(''); }} aria-describedby="billing-email-help" className="w-full rounded-none border border-wm-border bg-wm-card px-4 py-3 font-mono text-sm outline-none focus:border-wm-green focus:ring-1 focus:ring-wm-green" />
            <p id="billing-email-help" className="mt-2 text-xs leading-relaxed text-wm-muted">{t('subscription.emailHelp')}</p>
            <p className="mt-6 text-xs leading-relaxed text-wm-muted">{t(plan === 'monthly' ? 'subscription.monthlyRenewal' : 'subscription.yearlyRenewal')}</p>
            <button type="submit" disabled={!config?.available || busy || status === 'confirmed' || status === 'processing' || status === 'failed'} className="mt-5 flex w-full items-center justify-between gap-3 bg-wm-green px-5 py-4 text-sm font-bold text-wm-bg transition-colors hover:bg-green-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-wm-green disabled:cursor-not-allowed disabled:opacity-40">
              {t(busy ? 'subscription.redirecting' : 'subscription.continue')}{busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
            </button>
            {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
          </form>
          {!config ? <p className="mt-4 text-xs text-wm-muted">{t('subscription.loading')}</p> : !config.available ? <div className="mt-4 text-xs text-wm-muted"><p>{t('subscription.unavailable')}</p><button type="button" onClick={() => reloadConfig(value => value + 1)} className="mt-2 underline underline-offset-4">{t('subscription.retry')}</button></div> : null}
          {status ? <div role="status" className="mt-5 border-l-2 border-wm-green bg-wm-green/5 p-4 text-sm"><p className="font-medium">{t(`subscription.${status}`)}</p><p className="mt-1 text-xs leading-relaxed text-wm-muted">{t(`subscription.${status}Help`)}</p></div> : null}
          {verifyError || status === 'processing' || status === 'failed' ? <div className="mt-3 text-xs text-wm-muted">{verifyError ? <p>{t('subscription.verifyError')}</p> : null}<button type="button" onClick={() => retryVerification(value => value + 1)} className="mt-2 underline underline-offset-4">{t('subscription.recheck')}</button></div> : null}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-wm-border pt-5 text-xs text-wm-muted">
            <span className="inline-flex items-center gap-2"><Lock size={12} aria-hidden="true" />{t('subscription.secured')}</span>
            {config?.portalUrl ? <a href={config.portalUrl} target="_blank" rel="noopener noreferrer" className="text-wm-green underline-offset-4 hover:underline">{t('subscription.manage')}</a> : <span>{t('subscription.portalUnavailable')}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
