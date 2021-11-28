#!/usr/bin/env node
const puppeteer = require('puppeteer');
const {TimeoutError} = require('puppeteer/Errors');

const username = process.env.ENBRIDGE_USERNAME,
      password = process.env.ENBRIDGE_PASSWORD,
      screenshots = process.env.ENBRIDGE_SAVE_SCREENSHOTS === 'true';

function logfmt(data) {
  return Object.entries(data).map(([key, rawValue]) => {
    const isNull = rawValue == null;
    let value = rawValue == null ? '' : rawValue.toString();

    // Quote if there's a space or an equals sign in the value
    const needsQuoting  = value.indexOf(' ') > -1 || value.indexOf('=') > -1;

    // Escape if there's a backslash or quote in the value.
    const needsEscaping = value.indexOf('"') > -1 || value.indexOf("\\") > -1;

    if (needsEscaping) value = value.replace(/["\\]/g, '\\$&');
    if (needsQuoting) value = '"' + value + '"';

    // Empty values that aren't null should be the quoted empty string
    if (value === '' && !isNull) value = '""';

    return key + '=' + value;
  }).join(' ');
}

function parseCSVExport(data) {
  const split = data.trim().split('\n').map(line => {
    return line.split(',').map(x => x.trim());
  });

  const [header, ...rest] = split;
  //console.log(header);

  const offsets = {};
  header.forEach((hdr, i) => {
    offsets[hdr] = i;
  });

  const mapping = {
    account_id:             'Account ID',
    name:                   'Name',
    invoice_date:           'Invoice Date',
    invoice_number:         'Invoice Number',
    billing_period_from:    'Billing Period From',
    billing_period_to:      'Billing Period To',
    consumption:            'Consumption',
    gas_charge:             'Gas Charge',
    gas_charge_hst:         'Gas Charge HST',
    invoice_amount:         'Invoice Amount',
  };

  const parseNumber = s => Number(s);
  const parseCurrency = s => Number(s.replace(/^\$/, ''));
  const parseDateMMDDYYYY = s => {
    const [month, day, year] = s.split('/').map(x => Number(x));
    return new Date(year, month - 1, day);
  };

  const transforms = {
    account_id: x => x.replace(/'$/, ''),

    consumption: parseNumber,

    invoice_date:        parseDateMMDDYYYY,
    billing_period_from: parseDateMMDDYYYY,
    billing_period_to:   parseDateMMDDYYYY,

    gas_charge:     parseCurrency,
    gas_charge_hst: parseCurrency,
    invoice_amount: parseCurrency,
  };

  const entries = rest.map(arr => {
    const ret = {};
    for (const [outKey, inKey] of Object.entries(mapping)) {
      let val = arr[offsets[inKey]];
      if (transforms[outKey]) {
        val = transforms[outKey](val);
      }
      ret[outKey] = val
    }
    return ret;
  });

  return entries;
}

const log = {
  log: function(level, msg, data) {
    process.stderr.write(logfmt({
      level,
      msg,
      ...data,
    }) + '\n');
  },

  debug: function(msg, data) { this.log('debug', msg, data); },
  info:  function(msg, data) { this.log('info', msg, data); },
  warn:  function(msg, data) { this.log('warn', msg, data); },
  error: function(msg, data) { this.log('error', msg, data); },
};

(async () => {
  const browser = await puppeteer.launch({
    defaultViewport: {
      width: 1920,
      height: 1080,
    },
  });
  const page = await browser.newPage();
  log.info('navigating to enbridge');
  await page.goto('https://myaccount.enbridgegas.com/');

  log.info('logging in', {username});
  await page.focus('#signin-username');
  await page.keyboard.type(username);

  await page.focus('#signin-password');
  await page.keyboard.type(password);

  await page.click('#signin-box button');

  try {
    log.info('dismissing notification');
    const cancelButton = await page.waitForSelector('#cancelNotification', {timeout: 5000});
    await cancelButton.click('#cancelNotification');
  } catch (e) {
    if (e instanceof TimeoutError) {
      log.warn('no notification found; trying to continue');
    } else {
      throw e;
    }
  }

  const loginWait = 5;
  log.info('waiting for page load', {time_s: loginWait});
  await new Promise(r => setTimeout(r, loginWait * 1000));

  if (screenshots) {
    const mainScreenshotPath = 'after-notification.png';
    await page.screenshot({path: mainScreenshotPath});
    log.info('saved main page screenshot', {path: mainScreenshotPath});
  }

  log.info('navigating to the gas use tab');
  const gasUse = await page.waitForSelector('#myTab a[href="/en/My-Account/My-Gas-Use"]', {visible: true});
  await gasUse.click();

  log.info('selecting 6 months of history');
  await page.waitForSelector('#gas-history-filter');
  await page.select('#gas-history-filter', '6');
  await page.click('#lba-filter-btn');

  const filterWait = 2;
  log.info('waiting for filter', {time_s: filterWait});
  await new Promise(r => setTimeout(r, filterWait * 1000));

  // Get the UUID we need for the download
  log.info('getting item ID');
  const itemID = await page.evaluate(() => document.getElementById('GasUsageHistoryItemId').value);
  log.debug('got item ID', {item_id: itemID});

  log.info('downloading history CSV');
  const url = 'https://myaccount.enbridgegas.com/api/GasUse/GasUsageHistoryExport?type=CSV&filter=6&itemId=' + itemID;
  const res = await page.evaluate((url) => {
    return fetch(url, {
      method: 'GET',
      credentials: 'include'
    }).then(r => r.text());
  }, url);

  log.info('parsing downloaded CSV');
  const parsed = parseCSVExport(res);

  process.stdout.write(JSON.stringify(parsed) + '\n');

  log.info('finished');
  await browser.close();
})();
