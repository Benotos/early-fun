import { ShareCard } from '../../shared/types';
import { renderCard, renderOg } from '../lib/card';
import { HttpError, route } from '../lib/http';
import { getStore } from '../lib/store';

export default route(async ({ q }) => {
  if (q.get('kind') === 'og') {
    return { raw: await renderOg(), contentType: 'image/png', cache: 'public, max-age=3600, s-maxage=86400' };
  }
  const id = (q.get('id') || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) throw new HttpError(400, 'bad_id', 'Bad card id');
  const raw = await getStore().get(`share:${id}`);
  if (!raw) throw new HttpError(404, 'card_not_found', 'Card not found or expired');
  const png = await renderCard(JSON.parse(raw) as ShareCard);
  return { raw: png, contentType: 'image/png', cache: 'public, max-age=31536000, s-maxage=31536000, immutable' };
});
