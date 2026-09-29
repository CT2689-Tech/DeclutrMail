import { dbConnect } from './db';
import { applyJourneySeed } from './seed-journeys';

const sql = dbConnect();
try {
  await applyJourneySeed(sql);
  console.log('Isolated synthetic journey fixtures ready. No worker or provider was contacted.');
} finally {
  await sql.end();
}
