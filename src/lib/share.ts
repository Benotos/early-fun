export function isMobile(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

export type ShareResult = 'shared' | 'copied' | 'opened' | 'cancelled';

/**
 * Phones: native share sheet with the card image attached.
 * Desktop: open the X composer and put the image on the clipboard, user pastes it.
 */
export async function postOnX(opts: { text: string; url: string; image: string }): Promise<ShareResult> {
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(opts.text)}&url=${encodeURIComponent(opts.url)}`;
  const blobPromise = fetch(opts.image).then((r) => {
    if (!r.ok) throw new Error('card image failed to load');
    return r.blob();
  });

  if (isMobile() && typeof navigator.canShare === 'function') {
    try {
      const blob = await blobPromise;
      const file = new File([blob], 'early-card.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: `${opts.text} ${opts.url}` });
        return 'shared';
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
    window.open(intent, '_blank', 'noopener');
    return 'opened';
  }

  window.open(intent, '_blank', 'noopener');
  try {
    if (navigator.clipboard && 'ClipboardItem' in window) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      return 'copied';
    }
  } catch {
    /* clipboard blocked */
  }
  return 'opened';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

export function downloadUrl(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
