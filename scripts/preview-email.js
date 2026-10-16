const fs = require('node:fs');
const path = require('node:path');
const { renderEmail } = require('../lib/weekly-email');
const data = require('../test/fixtures');
const dir = path.join(__dirname, '..', 'test-output');
fs.mkdirSync(dir, { recursive: true });
const tx = {
  'lr:0': 'We contacted two families this week.', 'lr:0:0': 'They are settling into their new routine.',
  'note:0': 'We checked in by phone.', 'np:0': 'Please pray for the week ahead.',
  'grace:0': 'We shared the grace we received from reading the Word.', 'request:0': 'Please contact them this week.',
  'care:0:0': 'We checked in and encouraged one another.', 'cp:0:0': 'Please pray that they will live with thankful hearts.',
  'pr:0:0': 'Please pray for the new schedule.', 'pu:0:0': 'Preparations are going peacefully.',
  'newpr:0:0': 'Please pray for the family gathering.', 'rv:0:0': 'I will call again on Friday to see how they are doing.'
};
for (const lang of ['ko', 'en']) fs.writeFileSync(path.join(dir, `weekly-email-${lang}.html`), renderEmail(data, lang, tx).html);
console.log('Created Korean and English previews in test-output (fictional sample records and sample translations).');
