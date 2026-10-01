import { wipe, seed } from './server/db.ts';

wipe();
seed();
console.log('seeded clean');
