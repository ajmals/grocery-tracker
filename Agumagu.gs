/**
 * ==============================================================================
 * 🇲🇻 AGUMAGU GOVERNMENT COMMODITY PRICE SCRAPER & PRICE AUDIT
 * ==============================================================================
 * Directly connects to the official Maldivian Ministry of Economic Development & Trade
 * open commodity price API (https://agumagu.trade.gov.mv/api/bootstrap).
 * 
 * Two-Sheet Architecture:
 * 1. "🇲🇻 Gov Price Data": Flat database storing all recent store-level price quotes 
 *    (Date, Commodity, Store, Island, Price, Gov Base, Diff, Stock Level, Brand).
 * 2. "🇲🇻 Gov Price Dashboard": Interactive dashboard with commodity dropdown selector,
 *    KPI metric scorecards (Gov Base, Malé Lowest, National Lowest, Market Avg),
 *    and a dynamic Store-by-Store Price Leaderboard ranked from cheapest to most expensive.
 * 
 * In addition, automatically archives daily CSV snapshots to Google Drive in:
 *    Receipt_Scraper/4_Gov_Price_Archives/agumagu_prices_YYYY-MM-DD.csv
 * ==============================================================================
 */

/**
 * Menu wrapper with alert for Agumagu Price Sync
 */
function syncAgumaguPricesWithAlert() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Fetching surveillance quotes from agumagu.trade.gov.mv...', '🇲🇻 Agumagu Sync', 5);
  try {
    const stats = syncAgumaguPrices(ss);
    SpreadsheetApp.getUi().alert(
      'Gov Market Prices Synced! 🇲🇻',
      'Successfully synced government market surveillance data from the Ministry of Economic Development & Trade:\n\n' +
      '• 🏷️ Verified Store Quotes Logged: ' + stats.quotesCount.toLocaleString() + ' quotes\n' +
      '• 📦 Unique Commodities: ' + stats.itemCount + ' items\n' +
      '• 🏬 Supermarkets & Stalls Monitored: ' + stats.outletCount + ' outlets\n' +
      '• 📁 CSV Snapshot Archived: ' + (stats.archivedFileName ? stats.archivedFileName + ' (in 4_Gov_Price_Archives)' : 'Saved to Drive') + '\n' +
      '• 🕒 Inspection Timestamp: ' + stats.timestamp + '\n\n' +
      'Check the updated tabs at the bottom of your sheet:\n' +
      '1. "' + CONFIG.SHEET_AGUMAGU_DASHBOARD + '" — Interactive commodity inspector & cheapest store leaderboard.\n' +
      '2. "' + CONFIG.SHEET_AGUMAGU_DATA + '" — Full database of all store quotes.\n\n' +
      'You can also click "🔍 Double-Check Receipts vs Gov Benchmarks" to audit your grocery receipts!',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert(
      'Agumagu Sync Failed',
      'Could not sync prices from agumagu.trade.gov.mv:\n' + (err.message || err.toString()),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

/**
 * Core engine: fetches bootstrap JSON, writes raw quotes to Data tab,
 * builds the interactive Dashboard, and archives daily CSV to Google Drive.
 */
function syncAgumaguPrices(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  const response = UrlFetchApp.fetch(CONFIG.AGUMAGU_API_URL, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; ReceiptScraperPriceTracker/1.0)'
    }
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Agumagu server returned HTTP ' + response.getResponseCode());
  }

  const rawText = response.getContentText();
  const data = JSON.parse(rawText);

  if (!data || !data.items || !data.outlets || !data.prices) {
    throw new Error('Invalid or incomplete payload received from Agumagu API.');
  }

  const outletsMap = {};
  (data.outlets || []).forEach(function(o) { outletsMap[o.id] = o; });

  const itemsMap = {};
  (data.items || []).forEach(function(i) { itemsMap[i.id] = i; });

  const brandMap = {};
  (data.items || []).forEach(function(item) {
    (item.brands || []).forEach(function(b) {
      brandMap[b.id] = b.name;
    });
  });

  // Extract all valid positive price quotes
  const positiveQuotes = (data.prices || []).filter(function(p) {
    return p.price && p.price > 0;
  });

  // Sort descending by date (newest records first)
  positiveQuotes.sort(function(a, b) {
    return (b.recorded_at || '').localeCompare(a.recorded_at || '');
  });

  // Prepare Data Tab Rows
  const dataRows = [];
  for (let i = 0; i < positiveQuotes.length; i++) {
    const p = positiveQuotes[i];
    const item = itemsMap[p.item_id];
    const outlet = outletsMap[p.outlet_id];
    const brand = brandMap[p.brand_id] || '-';
    const dateStr = p.recorded_at ? p.recorded_at.split('T')[0] : '-';
    const basePrice = item ? (item.base_price || 0) : 0;
    const diff = Number((p.price - basePrice).toFixed(2));

    dataRows.push([
      i + 1,
      dateStr,
      item ? item.name : 'Unknown',
      item ? (item.name_dhivehi || '-') : '-',
      (item && item.categories && item.categories.length > 0) ? item.categories[0].name : 'General',
      (item && item.unit && item.unit.name) ? item.unit.name : 'Unit',
      basePrice,
      p.price,
      diff,
      outlet ? outlet.name : '-',
      (outlet && outlet.location && (outlet.location.island || outlet.location.name)) ? (outlet.location.island || outlet.location.name) : '-',
      (outlet && outlet.location && outlet.location.atoll && outlet.location.atoll.name) ? outlet.location.atoll.name : '-',
      p.availability || 'NORMAL',
      brand
    ]);
  }

  // 1. POPULATE RAW DATA SHEET ("🇲🇻 Gov Price Data")
  buildGovPriceDataSheet(ss, dataRows);

  // 2. BUILD INTERACTIVE DASHBOARD ("🇲🇻 Gov Price Dashboard")
  buildGovPriceDashboardSheet(ss, data);

  // 3. ARCHIVE TIMESTAMPED CSV TO GOOGLE DRIVE
  const dataHeaders = [
    '#', 'Date', 'Commodity Name (English)', 'Dhivehi Name', 'Category', 'Unit',
    'Gov Base Price', 'Recorded Price', 'Diff vs Gov Base', 'Store / Stall Name',
    'Island', 'Atoll', 'Stock Level', 'Brand Name'
  ];
  const archivedFile = archiveGovPricesToDrive(dataHeaders, dataRows);

  // 4. CLEAN UP LEGACY TAB (if "🇲🇻 Gov Market Prices" exists from previous run)
  const legacyTab = ss.getSheetByName('🇲🇻 Gov Market Prices');
  if (legacyTab) {
    try { ss.deleteSheet(legacyTab); } catch (e) { /* ignore if only sheet */ }
  }

  const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  return {
    success: true,
    quotesCount: dataRows.length,
    itemCount: (data.items || []).length,
    outletCount: (data.outlets || []).length,
    timestamp: nowStr,
    archivedFileName: archivedFile ? archivedFile.getName() : null
  };
}

/**
 * Builds the flat database sheet storing all recent store-level price quotes
 */
function buildGovPriceDataSheet(ss, dataRows) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_AGUMAGU_DATA);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_AGUMAGU_DATA);
  }
  sheet.clear();
  sheet.setTabColor('#0284c7');
  sheet.setHiddenGridlines(false);

  const headers = [
    '#', 'Date', 'Commodity Name (English)', 'Dhivehi Name', 'Category', 'Unit',
    'Gov Base Price', 'Recorded Price', 'Diff vs Gov Base', 'Store / Stall Name',
    'Island', 'Atoll', 'Stock Level', 'Brand Name'
  ];

  // Column widths
  const widths = [50, 95, 210, 160, 180, 85, 105, 110, 115, 200, 120, 110, 95, 200];
  for (let c = 0; c < widths.length; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }

  // Row 1: Header
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setFontSize(9)
    .setFontColor('#ffffff')
    .setBackground('#0f172a')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 28);

  // Write Data Rows
  if (dataRows.length > 0) {
    const range = sheet.getRange(2, 1, dataRows.length, headers.length);
    range.setValues(dataRows)
      .setFontSize(9)
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

    // Number formatting
    sheet.getRange(2, 7, dataRows.length, 3).setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment('right'); // Gov Base, Price, Diff
    sheet.getRange(2, 1, dataRows.length, 1).setHorizontalAlignment('center'); // #
    sheet.getRange(2, 2, dataRows.length, 1).setHorizontalAlignment('center'); // Date
    sheet.getRange(2, 6, dataRows.length, 1).setHorizontalAlignment('center'); // Unit
    sheet.getRange(2, 13, dataRows.length, 1).setHorizontalAlignment('center'); // Stock

    sheet.getRange(2, 3, dataRows.length, 3).setHorizontalAlignment('left'); // Names & Category
    sheet.getRange(2, 10, dataRows.length, 3).setHorizontalAlignment('left'); // Store, Island, Atoll
    sheet.getRange(2, 14, dataRows.length, 1).setHorizontalAlignment('left'); // Brand
  }

  sheet.setFrozenRows(1);
}

/**
 * Builds the interactive Gov Price Dashboard with commodity dropdown,
 * KPI scorecards, and store price leaderboard.
 */
function buildGovPriceDashboardSheet(ss, data) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_AGUMAGU_DASHBOARD);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_AGUMAGU_DASHBOARD, 0); // Put in front
  }
  sheet.clear();
  sheet.setTabColor('#0284c7');
  sheet.setHiddenGridlines(false);

  // Column widths (A to H)
  // A: Date (95), B: Store (210), C: Island (120), D: Atoll (110),
  // E: Price (115), F: Diff vs Gov (120), G: Stock Level (95), H: Brand (200)
  const widths = [95, 210, 120, 110, 115, 120, 95, 200];
  for (let c = 0; c < widths.length; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }

  // Row 1-2: Dark Navy Title Banner
  sheet.getRange('A1:H1').merge()
    .setValue('🇲🇻 MALDIVES GOV MARKET PRICE INTELLIGENCE & STORE LEADERBOARD')
    .setFontWeight('bold')
    .setFontSize(13)
    .setFontColor('#ffffff')
    .setBackground('#0f172a')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 38);

  sheet.getRange('A2:H2').merge()
    .setValue('Official surveillance data from the Ministry of Economic Development (agumagu.trade.gov.mv). Inspect any commodity to spot the cheapest stores across Maldives.')
    .setFontSize(9)
    .setFontStyle('italic')
    .setFontColor('#94a3b8')
    .setBackground('#0f172a')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 22);

  sheet.setRowHeight(3, 10); // spacer

  // Hidden Column Z for Dropdown validation list
  sheet.getRange('Z1').setValue('Unique Commodities');
  sheet.getRange('Z2').setFormula("=IFERROR(SORT(UNIQUE('" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:C)), \"\")");
  sheet.hideColumns(26);

  // Row 4: Commodity Selector Dropdown
  sheet.getRange('A4:B4').merge()
    .setValue('🔎 Select Commodity to Inspect:')
    .setFontWeight('bold')
    .setFontSize(10)
    .setFontColor('#0f172a')
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  const defaultItem = (data.items && data.items.length > 8) ? data.items[8].name : 'Basmati Rice (1 kg)';
  const dropdownCell = sheet.getRange('C4:E4');
  dropdownCell.merge()
    .setValue(defaultItem)
    .setFontWeight('bold')
    .setFontSize(11)
    .setFontColor('#0f172a')
    .setBackground('#f0fdf4')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#16a34a', SpreadsheetApp.BorderStyle.SOLID);

  // Set Data Validation dropdown pointing to Z2:Z150
  const validationRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sheet.getRange('Z2:Z150'))
    .setAllowInvalid(true)
    .build();
  dropdownCell.setDataValidation(validationRule);
  sheet.setRowHeight(4, 30);

  sheet.setRowHeight(5, 10); // spacer

  // Rows 6 to 8: 4 KPI Cards for the Selected Commodity
  const cards = [
    {
      range: 'A6:B8', titleRange: 'A6:B6', valRange: 'A7:B8',
      title: '🏛️ GOV BASELINE PRICE',
      formula: "=IFERROR(VLOOKUP(C4, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:G, 5, FALSE), \"-\")"
    },
    {
      range: 'C6:D8', titleRange: 'C6:D6', valRange: 'C7:D8',
      title: '🥇 LOWEST PRICE (MALÉ AREA)',
      formula: "=IFERROR(MINIFS('" + CONFIG.SHEET_AGUMAGU_DATA + "'!H2:H, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:C, C4, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!K2:K, \"Malé\"), IFERROR(MINIFS('" + CONFIG.SHEET_AGUMAGU_DATA + "'!H2:H, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:C, C4, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!K2:K, \"Hulhumalé\"), MINIFS('" + CONFIG.SHEET_AGUMAGU_DATA + "'!H2:H, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:C, C4)))"
    },
    {
      range: 'E6:F8', titleRange: 'E6:F6', valRange: 'E7:F8',
      title: '🇲🇻 NATIONAL LOWEST PRICE',
      formula: "=IFERROR(MINIFS('" + CONFIG.SHEET_AGUMAGU_DATA + "'!H2:H, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:C, C4), \"-\")"
    },
    {
      range: 'G6:H8', titleRange: 'G6:G6', valRange: 'G7:H8',
      title: '📊 CURRENT MARKET AVERAGE',
      formula: "=IFERROR(AVERAGEIFS('" + CONFIG.SHEET_AGUMAGU_DATA + "'!H2:H, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:C, C4), \"-\")"
    }
  ];

  cards.forEach(function(card) {
    sheet.getRange(card.range)
      .setBackground('#f8fafc')
      .setBorder(true, true, true, true, false, false, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(card.titleRange).merge()
      .setValue(card.title)
      .setFontWeight('bold')
      .setFontSize(8)
      .setFontColor('#64748b')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.getRange(card.valRange).merge()
      .setFormula(card.formula)
      .setFontWeight('bold')
      .setFontSize(13)
      .setFontColor('#0f172a')
      .setNumberFormat(CONFIG.CURRENCY_FORMAT)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  sheet.setRowHeight(6, 18);
  sheet.setRowHeight(7, 18);
  sheet.setRowHeight(8, 18);
  sheet.setRowHeight(9, 12); // spacer

  // Row 10-11: Leaderboard Section Header
  sheet.getRange('A10:H10').merge()
    .setValue('🏬 STORE-BY-STORE PRICE LEADERBOARD (RANKED CHEAPEST TO EXPENSIVE)')
    .setFontWeight('bold')
    .setFontSize(10)
    .setFontColor('#ffffff')
    .setBackground('#1e293b')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(10, 26);

  sheet.getRange('A11:H11').merge()
    .setValue('Showing verified supermarkets and market stalls selling the selected commodity, automatically sorted by price.')
    .setFontSize(9)
    .setFontStyle('italic')
    .setFontColor('#64748b')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(11, 20);

  // Row 12: Leaderboard Table Headers
  const lbHeaders = [
    'Date', 'Supermarket / Market Stall', 'Island', 'Atoll',
    'Recorded Price', 'Diff vs Gov Base', 'Stock Level', 'Brand Variety'
  ];
  sheet.getRange(12, 1, 1, lbHeaders.length).setValues([lbHeaders])
    .setFontWeight('bold')
    .setFontSize(9)
    .setFontColor('#ffffff')
    .setBackground('#334155')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(12, 26);

  // Row 13: Dynamic FILTER & SORT Query Formula
  sheet.getRange('A13').setFormula(
    "=IFERROR(SORT(FILTER({'" + CONFIG.SHEET_AGUMAGU_DATA + "'!B2:B, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!J2:J, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!K2:K, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!L2:L, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!H2:H, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!I2:I, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!M2:M, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!N2:N}, '" + CONFIG.SHEET_AGUMAGU_DATA + "'!C2:C = C4), 5, TRUE), {\"-\", \"No store quotes recorded for this commodity\", \"-\", \"-\", \"-\", \"-\", \"-\", \"-\"})"
  );

  // Format Leaderboard area (Rows 13 to 70)
  sheet.getRange('A13:H70')
    .setFontSize(9)
    .setVerticalAlignment('middle');
  sheet.getRange('A13:A70').setHorizontalAlignment('center'); // Date
  sheet.getRange('B13:D70').setHorizontalAlignment('left');   // Store, Island, Atoll
  sheet.getRange('E13:F70').setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment('right'); // Price, Diff
  sheet.getRange('G13:G70').setHorizontalAlignment('center'); // Stock
  sheet.getRange('H13:H70').setHorizontalAlignment('left');   // Brand

  sheet.setFrozenRows(12);
}

/**
 * Archives current snapshot of commodity benchmarks as a timestamped CSV file in Google Drive.
 * E.g., Receipt_Scraper/4_Gov_Price_Archives/agumagu_prices_2026-09-30.csv
 */
function archiveGovPricesToDrive(headers, tableRows) {
  try {
    const folders = getSystemFolders();
    const archiveFolder = folders.govArchives || getOrCreateSubFolder(folders.root, CONFIG.GOV_ARCHIVES_FOLDER_NAME);
    const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const fileName = 'agumagu_prices_' + dateStr + '.csv';

    // Build CSV content
    const escapeCsv = function(val) {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return '"' + str + '"';
    };

    const csvLines = [];
    csvLines.push(headers.map(escapeCsv).join(','));
    for (let i = 0; i < tableRows.length; i++) {
      csvLines.push(tableRows[i].map(escapeCsv).join(','));
    }
    const csvContent = csvLines.join('\r\n');

    // Check if today's file already exists
    const existing = archiveFolder.getFilesByName(fileName);
    if (existing.hasNext()) {
      const file = existing.next();
      file.setContent(csvContent);
      return file;
    } else {
      return archiveFolder.createFile(fileName, csvContent, MimeType.CSV);
    }
  } catch (err) {
    console.warn('Could not archive Gov prices to Drive: ' + err.message);
    return null;
  }
}

/**
 * Installs daily automated trigger to sync Agumagu prices every morning at 07:00 MVT
 */
function installDailyAgumaguTrigger() {
  removeDailyAgumaguTrigger(true); // Remove previous to prevent duplicates
  ScriptApp.newTrigger('syncAgumaguPrices')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  SpreadsheetApp.getUi().alert(
    'Daily Gov Price Sync Enabled ⏰',
    'The automated daily trigger is now ACTIVE.\n\n' +
    'Google Apps Script will automatically fetch fresh market prices from agumagu.trade.gov.mv every morning between 07:00 and 08:00 AM.\n\n' +
    'Your "' + CONFIG.SHEET_AGUMAGU_DASHBOARD + '" and "' + CONFIG.SHEET_AGUMAGU_DATA + '" tabs will stay continuously up-to-date with official prices.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Removes daily automated Agumagu trigger
 */
function removeDailyAgumaguTrigger(silent) {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncAgumaguPrices') {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  if (!silent) {
    SpreadsheetApp.getUi().alert(
      'Daily Gov Price Sync Disabled',
      'The daily automatic Agumagu sync trigger has been disabled. You can still manually update prices at any time via "🇲🇻 Sync Gov Market Prices (Agumagu)".',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

/**
 * Builds price matcher and audits scanned receipt items against official Agumagu commodities
 */
function showPriceAuditDialog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const itemsSheet = ss.getSheetByName(CONFIG.SHEET_ITEMS);

  if (!itemsSheet || itemsSheet.getLastRow() <= 1) {
    SpreadsheetApp.getUi().alert(
      'No Receipt Items Found',
      'The "' + CONFIG.SHEET_ITEMS + '" tab does not contain any scanned grocery purchases yet.\n\n' +
      'Please process some receipts first, then run this audit to compare your actual purchase prices against official government benchmarks!',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  // Ensure Gov prices data sheet is populated
  let govDataSheet = ss.getSheetByName(CONFIG.SHEET_AGUMAGU_DATA);
  if (!govDataSheet || govDataSheet.getLastRow() <= 1) {
    ss.toast('Fetching government prices first...', 'Agumagu Sync', 5);
    syncAgumaguPrices(ss);
    govDataSheet = ss.getSheetByName(CONFIG.SHEET_AGUMAGU_DATA);
  }

  // Load Gov Data rows
  const govRows = govDataSheet.getRange(2, 1, govDataSheet.getLastRow() - 1, 14).getValues();

  // Aggregate commodities lookup from data
  const govMap = {};
  for (let i = 0; i < govRows.length; i++) {
    const r = govRows[i];
    const name = String(r[2] || '').trim();
    if (!name) continue;
    if (!govMap[name]) {
      govMap[name] = {
        name: name,
        dhivehi: String(r[3] || '').trim(),
        category: String(r[4] || '').trim(),
        unit: String(r[5] || '').trim(),
        basePrice: Number(r[6]) || 0,
        lowestMalePrice: Infinity,
        cheapestMaleStore: '-',
        prices: []
      };
    }
    const entry = govMap[name];
    const price = Number(r[7]) || 0;
    const island = String(r[10] || '').toLowerCase();
    const store = String(r[9] || '');

    if (price > 0) {
      entry.prices.push(price);
      if ((island === 'malé' || island === 'male' || island === 'hulhumalé' || island === 'hulhumale') && price < entry.lowestMalePrice) {
        entry.lowestMalePrice = price;
        entry.cheapestMaleStore = store + ' (' + r[10] + ')';
      }
    }
  }

  const govItems = Object.keys(govMap).map(function(k) { return govMap[k]; });

  // Load User Receipt Items
  const userItemsRange = itemsSheet.getRange(2, 1, itemsSheet.getLastRow() - 1, 13).getValues();
  
  // Stemmer & Matcher
  function stem(w) {
    w = (w || '').toLowerCase().trim();
    if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  const genericStopwords = {
    'pack': true, 'packet': true, 'bags': true, 'bag': true, 
    'can': true, 'tin': true, 'gram': true, 'unit': true, 'item': true, 
    'supermarket': true, 'mart': true, 'store': true, 'brand': true
  };

  const commonAliases = {
    'white sugar': 'Normal Sugar',
    'sugar': 'Normal Sugar',
    'table sugar': 'Normal Sugar',
    'egg': 'Egg (Chicken)',
    'eggs': 'Egg (Chicken)',
    'chicken egg': 'Egg (Chicken)',
    'chicken eggs': 'Egg (Chicken)',
    'whole chicken': 'Frozen Whole Chicken',
    'frozen chicken': 'Frozen Whole Chicken',
    'chicken whole': 'Frozen Whole Chicken',
    'atta': 'Whole Wheat Flour',
    'atta flour': 'Whole Wheat Flour',
    'wheat flour': 'Wheat Flour',
    'flour': 'Wheat Flour',
    'all purpose flour': 'Wheat Flour',
    'canned tuna': 'Canned Fish',
    'tuna can': 'Canned Fish',
    'tuna chunks': 'Canned Fish',
    'milk powder': 'Milk Powder Can (Full Cream)',
    'full cream milk': 'Milk Powder Can (Full Cream)'
  };

  const govTokensMap = govItems.map(function(g) {
    const raw = g.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function(t) { return t.length > 1; });
    const stemmed = raw.map(stem);
    return {
      gov: g,
      rawTokens: raw,
      stemmedTokens: stemmed
    };
  });

  function matchUserItem(receiptName) {
    const clean = (receiptName || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
    if (!clean) return null;

    if (commonAliases[clean]) {
      const aliasName = commonAliases[clean];
      for (let i = 0; i < govItems.length; i++) {
        if (govItems[i].name.toLowerCase() === aliasName.toLowerCase()) {
          return govItems[i];
        }
      }
    }

    const rTokens = clean.split(/\s+/).filter(function(t) { return t.length > 1; });
    const rStemmed = rTokens.map(stem);

    let bestGov = null;
    let highestScore = 0;

    for (let i = 0; i < govTokensMap.length; i++) {
      const entry = govTokensMap[i];
      let score = 0;

      if (clean === entry.gov.name.toLowerCase()) score += 50;
      else if (clean.includes(entry.gov.name.toLowerCase())) score += 30;
      else if (entry.gov.name.toLowerCase().includes(clean)) score += 20;

      let matchedCount = 0;
      for (let k = 0; k < rStemmed.length; k++) {
        const rt = rStemmed[k];
        if (genericStopwords[rt]) continue;
        if (entry.stemmedTokens.indexOf(rt) !== -1) {
          score += 10;
          matchedCount++;
        }
      }

      if (score > highestScore && (matchedCount > 0 || score >= 20)) {
        highestScore = score;
        bestGov = entry.gov;
      }
    }

    return (bestGov && highestScore >= 10) ? bestGov : null;
  }

  // Audit calculations
  let totalAudited = 0;
  let matchedCount = 0;
  let overpaidCount = 0;
  let greatDealCount = 0;
  let fairCount = 0;
  let totalPotentialSavings = 0;
  const auditResults = [];

  for (let i = 0; i < userItemsRange.length; i++) {
    const row = userItemsRange[i];
    const rawDate = row[1];
    const dateStr = rawDate instanceof Date ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(rawDate || '');
    const store = String(row[2] || 'Unknown Store');
    const rawName = String(row[3] || '');
    const stdName = String(row[4] || rawName);
    const unitPrice = Number(row[9]) || 0;
    const qty = Number(row[6]) || 1;

    if (!stdName && !rawName) continue;
    totalAudited++;

    const matchedGov = matchUserItem(stdName) || matchUserItem(rawName);
    if (!matchedGov) continue;

    matchedCount++;
    const govBase = matchedGov.basePrice;
    const maleLow = (matchedGov.lowestMalePrice !== Infinity) ? matchedGov.lowestMalePrice : govBase;
    const diff = unitPrice - govBase;
    const pct = govBase > 0 ? ((diff / govBase) * 100) : 0;

    let status = 'fair';
    let statusLabel = '⚖️ Fair Market';
    let statusClass = 'badge-fair';

    if (unitPrice <= maleLow || (govBase > 0 && unitPrice <= govBase * 0.95)) {
      status = 'deal';
      statusLabel = '🟢 Great Deal';
      statusClass = 'badge-deal';
      greatDealCount++;
    } else if (govBase > 0 && unitPrice > govBase * 1.15) {
      status = 'overpaid';
      statusLabel = '⚠️ Overpaid (+' + Math.round(pct) + '%)';
      statusClass = 'badge-overpaid';
      overpaidCount++;
      totalPotentialSavings += Math.max(0, diff * qty);
    } else {
      fairCount++;
    }

    auditResults.push({
      date: dateStr,
      store: store,
      receiptItem: stdName,
      govCommodity: matchedGov.name,
      govDhivehi: matchedGov.dhivehi,
      unitPrice: unitPrice,
      govBase: govBase,
      maleLow: maleLow,
      maleStore: matchedGov.cheapestMaleStore || '-',
      diff: diff,
      pct: pct,
      status: status,
      statusLabel: statusLabel,
      statusClass: statusClass
    });
  }

  // Generate Interactive HTML Modal
  const htmlContent = buildAuditModalHtml({
    totalAudited: totalAudited,
    matchedCount: matchedCount,
    overpaidCount: overpaidCount,
    greatDealCount: greatDealCount,
    fairCount: fairCount,
    totalPotentialSavings: totalPotentialSavings.toFixed(2),
    currencyCode: CONFIG.CURRENCY_CODE,
    results: auditResults
  });

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(1000)
    .setHeight(680);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '🔍 Receipt Price Audit vs Maldives Gov Benchmarks');
}

/**
 * Builds HTML template for the Price Audit Modal Dialog
 */
function buildAuditModalHtml(data) {
  const jsonResults = JSON.stringify(data.results || []);

  return '<!DOCTYPE html>\n' +
  '<html>\n' +
  '<head>\n' +
  '  <meta charset="utf-8">\n' +
  '  <title>Receipt Price Audit</title>\n' +
  '  <style>\n' +
  '    * { box-sizing: border-box; margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }\n' +
  '    body { background: #0f172a; color: #f8fafc; padding: 20px; font-size: 13px; line-height: 1.4; }\n' +
  '    .header { margin-bottom: 16px; border-bottom: 1px solid #334155; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-start; }\n' +
  '    .title { font-size: 18px; font-weight: 700; color: #ffffff; }\n' +
  '    .subtitle { font-size: 12px; color: #94a3b8; margin-top: 4px; }\n' +
  '    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }\n' +
  '    .kpi-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 12px; text-align: center; }\n' +
  '    .kpi-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }\n' +
  '    .kpi-val { font-size: 18px; font-weight: 800; color: #ffffff; margin-top: 4px; }\n' +
  '    .kpi-card.overpaid .kpi-val { color: #f87171; }\n' +
  '    .kpi-card.deal .kpi-val { color: #4ade80; }\n' +
  '    .controls { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }\n' +
  '    .search-box { flex: 1; min-width: 200px; background: #1e293b; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 12px; outline: none; }\n' +
  '    .search-box:focus { border-color: #38bdf8; }\n' +
  '    .filter-pills { display: flex; gap: 6px; }\n' +
  '    .pill { background: #1e293b; border: 1px solid #334155; color: #94a3b8; padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.2s; }\n' +
  '    .pill:hover, .pill.active { background: #38bdf8; color: #0f172a; border-color: #38bdf8; }\n' +
  '    .table-container { max-height: 400px; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; background: #1e293b; }\n' +
  '    table { width: 100%; border-collapse: collapse; text-align: left; }\n' +
  '    th { position: sticky; top: 0; background: #0f172a; color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #334155; z-index: 2; }\n' +
  '    td { padding: 9px 12px; border-bottom: 1px solid #334155; font-size: 12px; vertical-align: middle; }\n' +
  '    tr:hover { background: #26334d; }\n' +
  '    .badge-deal { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid #22c55e; padding: 3px 8px; border-radius: 12px; font-weight: 600; font-size: 10px; display: inline-block; }\n' +
  '    .badge-overpaid { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid #ef4444; padding: 3px 8px; border-radius: 12px; font-weight: 600; font-size: 10px; display: inline-block; }\n' +
  '    .badge-fair { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid #64748b; padding: 3px 8px; border-radius: 12px; font-weight: 600; font-size: 10px; display: inline-block; }\n' +
  '    .price { font-family: "SF Mono", Monaco, Consolas, monospace; font-weight: 600; }\n' +
  '    .store-tag { font-size: 11px; color: #94a3b8; margin-top: 2px; }\n' +
  '    .footer { margin-top: 14px; display: flex; justify-content: space-between; align-items: center; color: #64748b; font-size: 11px; }\n' +
  '    .btn { background: #38bdf8; color: #0f172a; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; }\n' +
  '    .btn:hover { background: #0284c7; color: #ffffff; }\n' +
  '  </style>\n' +
  '</head>\n' +
  '<body>\n' +
  '  <div class="header">\n' +
  '    <div>\n' +
  '      <div class="title">🔍 Receipt Price Audit vs Maldives Gov Benchmarks</div>\n' +
  '      <div class="subtitle">Auditing your scanned receipt line items against the official Ministry of Economic Development (agumagu.trade.gov.mv) database.</div>\n' +
  '    </div>\n' +
  '  </div>\n' +
  '  <div class="kpi-grid">\n' +
  '    <div class="kpi-card">\n' +
  '      <div class="kpi-label">Receipt Items Audited</div>\n' +
  '      <div class="kpi-val">' + data.totalAudited + ' (' + data.matchedCount + ' matched)</div>\n' +
  '    </div>\n' +
  '    <div class="kpi-card overpaid">\n' +
  '      <div class="kpi-label">⚠️ Overpaid Purchases</div>\n' +
  '      <div class="kpi-val">' + data.overpaidCount + ' items</div>\n' +
  '    </div>\n' +
  '    <div class="kpi-card deal">\n' +
  '      <div class="kpi-label">🟢 Great Deals Found</div>\n' +
  '      <div class="kpi-val">' + data.greatDealCount + ' items</div>\n' +
  '    </div>\n' +
  '    <div class="kpi-card overpaid">\n' +
  '      <div class="kpi-label">Estimated Potential Savings</div>\n' +
  '      <div class="kpi-val">' + data.currencyCode + ' ' + data.totalPotentialSavings + '</div>\n' +
  '    </div>\n' +
  '  </div>\n' +
  '  <div class="controls">\n' +
  '    <input type="text" id="searchInput" class="search-box" placeholder="🔎 Filter by item name, store, or commodity..." oninput="filterTable()">\n' +
  '    <div class="filter-pills">\n' +
  '      <button class="pill active" onclick="setStatusFilter(\'all\', this)">All (' + data.matchedCount + ')</button>\n' +
  '      <button class="pill" onclick="setStatusFilter(\'overpaid\', this)">⚠️ Overpaid (' + data.overpaidCount + ')</button>\n' +
  '      <button class="pill" onclick="setStatusFilter(\'deal\', this)">🟢 Great Deals (' + data.greatDealCount + ')</button>\n' +
  '      <button class="pill" onclick="setStatusFilter(\'fair\', this)">⚖️ Fair (' + data.fairCount + ')</button>\n' +
  '    </div>\n' +
  '  </div>\n' +
  '  <div class="table-container">\n' +
  '    <table>\n' +
  '      <thead>\n' +
  '        <tr>\n' +
  '          <th>Date & Store</th>\n' +
  '          <th>Receipt Item</th>\n' +
  '          <th>Matched Gov Commodity</th>\n' +
  '          <th>You Paid</th>\n' +
  '          <th>Gov Base</th>\n' +
  '          <th>Malé Lowest</th>\n' +
  '          <th>Status & Variance</th>\n' +
  '        </tr>\n' +
  '      </thead>\n' +
  '      <tbody id="tableBody">\n' +
  '      </tbody>\n' +
  '    </table>\n' +
  '  </div>\n' +
  '  <div class="footer">\n' +
  '    <div>Prices based on agumagu.trade.gov.mv daily market surveillance.</div>\n' +
  '    <button class="btn" onclick="google.script.host.close()">Close Window</button>\n' +
  '  </div>\n' +
  '  <script>\n' +
  '    const rawData = ' + jsonResults + ';\n' +
  '    let activeStatus = "all";\n' +
  '    const currency = "' + data.currencyCode + '";\n' +
  '    function renderTable(items) {\n' +
  '      const tbody = document.getElementById("tableBody");\n' +
  '      if (items.length === 0) {\n' +
  '        tbody.innerHTML = "<tr><td colspan=\'7\' style=\'text-align:center; padding:30px; color:#94a3b8;\'>No matching receipt items found.</td></tr>";\n' +
  '        return;\n' +
  '      }\n' +
  '      tbody.innerHTML = items.map(function(item) {\n' +
  '        const diffSign = item.diff > 0 ? "+" : "";\n' +
  '        return "<tr>" +\n' +
  '          "<td><div><strong>" + (item.date || "-") + "</strong></div><div class=\'store-tag\'>" + item.store + "</div></td>" +\n' +
  '          "<td><strong>" + item.receiptItem + "</strong></td>" +\n' +
  '          "<td><div>" + item.govCommodity + "</div><div class=\'store-tag\'>" + (item.govDhivehi || "") + "</div></td>" +\n' +
  '          "<td class=\'price\'>" + currency + " " + item.unitPrice.toFixed(2) + "</td>" +\n' +
  '          "<td class=\'price\'>" + currency + " " + item.govBase.toFixed(2) + "</td>" +\n' +
  '          "<td><div class=\'price\'>" + (item.maleLow > 0 ? currency + " " + item.maleLow.toFixed(2) : "-") + "</div><div class=\'store-tag\'>" + item.maleStore + "</div></td>" +\n' +
  '          "<td><span class=\'" + item.statusClass + "\'>" + item.statusLabel + " (" + diffSign + item.diff.toFixed(2) + ")</span></td>" +\n' +
  '        "</tr>";\n' +
  '      }).join("");\n' +
  '    }\n' +
  '    function filterTable() {\n' +
  '      const query = document.getElementById("searchInput").value.toLowerCase();\n' +
  '      const filtered = rawData.filter(function(item) {\n' +
  '        const matchStatus = (activeStatus === "all" || item.status === activeStatus);\n' +
  '        const matchQuery = !query || (\n' +
  '          item.receiptItem.toLowerCase().indexOf(query) !== -1 ||\n' +
  '          item.govCommodity.toLowerCase().indexOf(query) !== -1 ||\n' +
  '          item.store.toLowerCase().indexOf(query) !== -1 ||\n' +
  '          (item.govDhivehi && item.govDhivehi.indexOf(query) !== -1)\n' +
  '        );\n' +
  '        return matchStatus && matchQuery;\n' +
  '      });\n' +
  '      renderTable(filtered);\n' +
  '    }\n' +
  '    function setStatusFilter(status, btn) {\n' +
  '      activeStatus = status;\n' +
  '      document.querySelectorAll(".pill").forEach(function(p) { p.classList.remove("active"); });\n' +
  '      btn.classList.add("active");\n' +
  '      filterTable();\n' +
  '    }\n' +
  '    renderTable(rawData);\n' +
  '  </script>\n' +
  '</body>\n' +
  '</html>';
}
