import { writeFileSync } from 'node:fs';
import { renderOg } from '../server/lib/card';

renderOg().then((png) => {
  writeFileSync('public/og.png', png);
  console.log('public/og.png written', png.length, 'bytes');
});
