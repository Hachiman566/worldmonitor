import { Panel } from './Panel';
import type { PredictionMarket } from '@/services/prediction';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { t, getCurrentLanguage } from '@/services/i18n';
import { translateText } from '@/services/summarization';

export class PredictionPanel extends Panel {
  private translationCache = new Map<string, string>();

  constructor() {
    super({
      id: 'polymarket',
      title: t('panels.polymarket'),
      infoTooltip: t('components.prediction.infoTooltip'),
    });
  }

  private formatVolume(volume?: number): string {
    if (!volume) return '';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
  }

  public renderPredictions(data: PredictionMarket[]): void {
    if (data.length === 0) {
      this.showError(t('common.failedPredictions'));
      return;
    }

    const html = data
      .map((p) => {
        const yesPercent = Math.round(p.yesPrice);
        const noPercent = 100 - yesPercent;
        const volumeStr = this.formatVolume(p.volume);

        const safeUrl = sanitizeUrl(p.url || '');
        const titleHtml = safeUrl
          ? `<a href="${safeUrl}" target="_blank" rel="noopener" class="prediction-question prediction-link">${escapeHtml(p.title)}</a>`
          : `<div class="prediction-question">${escapeHtml(p.title)}</div>`;

        let expiryHtml = '';
        if (p.endDate) {
          const d = new Date(p.endDate);
          if (Number.isFinite(d.getTime())) {
            const formatted = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            expiryHtml = `<span class="prediction-expiry">${t('components.predictions.closes')}: ${formatted}</span>`;
          }
        }

        const metaHtml = (volumeStr || expiryHtml)
          ? `<div class="prediction-meta">${volumeStr ? `<span class="prediction-volume">${t('components.predictions.vol')}: ${volumeStr}</span>` : ''}${expiryHtml}</div>`
          : '';

        return `
      <div class="prediction-item">
        ${titleHtml}
        ${metaHtml}
        <div class="prediction-bar">
          <div class="prediction-yes" style="width: ${yesPercent}%">
            <span class="prediction-label">${t('components.predictions.yes')} ${yesPercent}%</span>
          </div>
          <div class="prediction-no" style="width: ${noPercent}%">
            <span class="prediction-label">${t('components.predictions.no')} ${noPercent}%</span>
          </div>
        </div>
      </div>
    `;
      })
      .join('');

    this.setContent(html);

    const lang = getCurrentLanguage();
    if (lang !== 'en') {
      this.translateTitles(data, lang);
    }
  }

  private async translateTitles(data: PredictionMarket[], lang: string): Promise<void> {
    const untranslated = data.filter((p) => !this.translationCache.has(p.title));

    if (untranslated.length > 0) {
      const batch = untranslated;
      const titles = batch.map((p) => p.title).join('\n');
      try {
        const result = await translateText(titles, lang);
        if (result) {
          const lines = result.split('\n');
          for (let j = 0; j < batch.length && j < lines.length; j++) {
            const translated = lines[j]?.trim();
            const item = batch[j];
            if (translated && item) {
              this.translationCache.set(item.title, translated);
            }
          }
        }
      } catch {
        // ignore translation errors
      }
    }

    const container = this.content;

    const questionEls = container.querySelectorAll('.prediction-question');
    for (let i = 0; i < data.length && i < questionEls.length; i++) {
      const item = data[i];
      const el = questionEls[i];
      if (!item || !el) continue;
      const translated = this.translationCache.get(item.title);
      if (translated) {
        el.textContent = translated;
      }
    }
  }
}
