/**
 * ==============================================================================
 * 🧾 Automated Grocery Receipt Scraper & Price Tracker
 * ==============================================================================
 * Automatically processes grocery receipts, extracts itemized purchase data
 * using Google's Gemini Multimodal AI (Free Tier), and generates interactive
 * spending analytics & cross-store price comparison dashboards in Google Sheets.
 *
 * License: MIT
 * ==============================================================================
 */

// Global Configuration
const CONFIG = {
  // Folder Names in your Google Drive (created automatically upon setup)
  UPLOAD_FOLDER_NAME: 'Receipt_Uploads',
  PROCESSED_FOLDER_NAME: 'Receipt_Processed',

  // Sheet Tab Names
  SHEET_RECEIPTS: 'Receipts',
  SHEET_ITEMS: 'Items',
  SHEET_DASHBOARD: '📊 Dashboard',
  SHEET_PRICE_COMPARE: '🏷️ Price Compare',
  SHEET_PRICE_TRENDS: '📅 Seasonal & Price Trends',
  SHEET_STORE_MATRIX: '🏬 Store Matrix',

  // Currency Settings (Defaults to MVR - Maldivian Rufiyaa, customizable to any currency)
  // Examples:
  // MVR:      CURRENCY_CODE: 'MVR', CURRENCY_FORMAT: '"MVR "#,##0.00'
  // USD ($):  CURRENCY_CODE: 'USD', CURRENCY_FORMAT: '"$"#,##0.00'
  // EUR (€):  CURRENCY_CODE: 'EUR', CURRENCY_FORMAT: '"€"#,##0.00'
  // GBP (£):  CURRENCY_CODE: 'GBP', CURRENCY_FORMAT: '"£"#,##0.00'
  // CAD ($):  CURRENCY_CODE: 'CAD', CURRENCY_FORMAT: '"$"#,##0.00'
  // AUD ($):  CURRENCY_CODE: 'AUD', CURRENCY_FORMAT: '"$"#,##0.00'
  // INR (₹):  CURRENCY_CODE: 'INR', CURRENCY_FORMAT: '"₹"#,##0.00'
  CURRENCY_CODE: 'MVR',
  CURRENCY_FORMAT: '"MVR "#,##0.00',

  // Gemini AI Model (Google AI Studio Free Tier: 1,500 requests/day)
  // Recommended: 'gemini-2.5-flash' or 'gemini-2.0-flash'
  GEMINI_MODEL: 'gemini-2.5-flash',

  // Maximum receipts to process in a single batch (avoids Apps Script 6-min timeout)
  MAX_FILES_PER_RUN: 5
};

/**
 * Creates custom menu when spreadsheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🧾 Receipt Scraper')
    .addItem('▶️ Process Pending Receipts Now', 'processPendingReceiptsWithAlert')
    .addSeparator()
    .addItem('📊 Build / Refresh Dashboards', 'buildDashboardTabsWithAlert')
    .addSeparator()
    .addItem('🔍 Run Diagnostics & Check Status', 'runDiagnostics')
    .addItem('📋 List Available Gemini Models', 'listAvailableModels')
    .addItem('⚙️ Initialize Sheets & Drive Folders', 'setupSheetAndFolders')
    .addSeparator()
    .addItem('⏰ Enable Hourly Auto-Scraper Trigger', 'installHourlyTrigger')
    .addItem('⏹️ Disable Hourly Auto-Scraper Trigger', 'removeHourlyTrigger')
    .addToUi();
}

/**
 * Diagnostic tool: Checks API key, sheets, and inspects the upload folder
 */
function runDiagnostics() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  
  let report = '--- DIAGNOSTICS REPORT ---\n\n';

  // 1. Check API Key
  if (!apiKey) {
    report += '❌ GEMINI_API_KEY: NOT FOUND in Script Properties.\n(Go to Project Settings ⚙️ > Script Properties to add it)\n\n';
  } else {
    report += '✅ GEMINI_API_KEY: Set (' + apiKey.substring(0, 6) + '...' + apiKey.substring(apiKey.length - 4) + ')\n\n';
  }

  // 2. Check Drive Folder
  const uploadFolder = getOrCreateFolder(CONFIG.UPLOAD_FOLDER_NAME);
  report += '📁 Upload Folder: "' + CONFIG.UPLOAD_FOLDER_NAME + '"\n';
  report += '🔗 Folder URL: ' + uploadFolder.getUrl() + '\n\n';
  
  const files = uploadFolder.getFiles();
  let fileList = [];
  while (files.hasNext()) {
    const f = files.next();
    fileList.push(f.getName() + ' (' + f.getMimeType() + ')');
  }

  if (fileList.length === 0) {
    report += '⚠️ Files in Upload Folder: 0 files found.\n(Upload your receipt image/PDF to the folder link above)\n\n';
  } else {
    report += '✅ Files Ready to Process (' + fileList.length + '):\n- ' + fileList.join('\n- ') + '\n\n';
  }

  // 3. Check Sheets
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const receiptsSheet = ss.getSheetByName(CONFIG.SHEET_RECEIPTS);
  const itemsSheet = ss.getSheetByName(CONFIG.SHEET_ITEMS);
  const dashSheet = ss.getSheetByName(CONFIG.SHEET_DASHBOARD);
  const compareSheet = ss.getSheetByName(CONFIG.SHEET_PRICE_COMPARE);
  const trendsSheet = ss.getSheetByName(CONFIG.SHEET_PRICE_TRENDS);
  const matrixSheet = ss.getSheetByName(CONFIG.SHEET_STORE_MATRIX);
  report += '📊 Sheets:\n';
  report += '- Receipts Tab: ' + (receiptsSheet ? '✅ Present' : '❌ Missing (Click Initialize Sheets)') + '\n';
  report += '- Items Tab: ' + (itemsSheet ? '✅ Present' : '❌ Missing (Click Initialize Sheets)') + '\n';
  report += '- Dashboard Tab: ' + (dashSheet ? '✅ Present' : '⚠️ Missing (Click "Build / Refresh Dashboards")') + '\n';
  report += '- Price Compare Tab: ' + (compareSheet ? '✅ Present' : '⚠️ Missing (Click "Build / Refresh Dashboards")') + '\n';
  report += '- Seasonal Trends Tab: ' + (trendsSheet ? '✅ Present' : '⚠️ Missing (Click "Build / Refresh Dashboards")') + '\n';
  report += '- Store Matrix Tab: ' + (matrixSheet ? '✅ Present' : '⚠️ Missing (Click "Build / Refresh Dashboards")') + '\n\n';

  // 4. Check Hourly Automation Trigger
  const triggers = ScriptApp.getProjectTriggers();
  let hasHourlyTrigger = false;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processPendingReceipts') {
      hasHourlyTrigger = true;
      break;
    }
  }
  report += '⏰ Hourly Auto-Scraper Trigger:\n';
  report += hasHourlyTrigger
    ? '✅ ACTIVE: Running automatically every hour until pending receipts succeed.'
    : '⚠️ NOT ACTIVE: Receipts won\'t scrape in background. Click "Create 1-Hour Scheduled Trigger" from the menu to activate.';

  ui.alert('Receipt Scraper Diagnostics', report, ui.ButtonSet.OK);
}

/**
 * Lists all active models supported by your Gemini API Key
 */
function listAvailableModels() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    ui.alert('API Key Missing', 'Please add GEMINI_API_KEY in Project Settings > Script Properties first.', ui.ButtonSet.OK);
    return;
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code !== 200) {
      ui.alert('Error Listing Models (' + code + ')', text, ui.ButtonSet.OK);
      return;
    }

    const data = JSON.parse(text);
    const flashModels = [];

    if (data.models && Array.isArray(data.models)) {
      data.models.forEach(function(m) {
        const name = m.name.replace('models/', '');
        const methods = m.supportedGenerationMethods || [];
        if (methods.indexOf('generateContent') !== -1) {
          flashModels.push(name);
        }
      });
    }

    ui.alert(
      'Available Gemini Models (' + flashModels.length + ')',
      'The following models support generateContent with your key:\n\n' + flashModels.slice(0, 15).join('\n'),
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('Failed to fetch models', err.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Wrapper for manual execution from the menu to show informative UI alerts
 */
function processPendingReceiptsWithAlert() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Reading receipts and contacting Gemini...', 'Receipt Scraper', 10);
  
  try {
    const result = processPendingReceipts();

    if (result.count === 0) {
      if (result.errors && result.errors.length > 0) {
        SpreadsheetApp.getUi().alert(
          'Receipt Processing Error',
          'Failed to process file(s):\n\n' + result.errors.join('\n\n'),
          SpreadsheetApp.getUi().ButtonSet.OK
        );
      } else {
        SpreadsheetApp.getUi().alert(
          'No Receipts Found',
          'No pending files found in "' + CONFIG.UPLOAD_FOLDER_NAME + '".\n\n' +
          'Upload receipt images or PDFs into that folder, then run this again.',
          SpreadsheetApp.getUi().ButtonSet.OK
        );
      }
    } else {
      let msg = 'Successfully processed ' + result.count + ' receipt(s)!\nCheck your "' + 
                CONFIG.SHEET_RECEIPTS + '" and "' + CONFIG.SHEET_ITEMS + '" tabs.';
      if (result.errors && result.errors.length > 0) {
        msg += '\n\nNote: ' + result.errors.length + ' file(s) had errors:\n' + result.errors.join('\n');
      }
      SpreadsheetApp.getUi().alert('Success!', msg, SpreadsheetApp.getUi().ButtonSet.OK);
    }
  } catch (err) {
    SpreadsheetApp.getUi().alert('Execution Error', err.message || err.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Main scheduled/manual job: Scans upload folder and processes receipts
 */
function processPendingReceipts() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found in Script Properties. Please add it in Project Settings (gear icon).');
  }

  // Ensure sheets exist
  ensureSheetSetup();

  const uploadFolder = getOrCreateFolder(CONFIG.UPLOAD_FOLDER_NAME);
  const processedFolder = getOrCreateFolder(CONFIG.PROCESSED_FOLDER_NAME);
  const files = uploadFolder.getFiles();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const receiptsSheet = ss.getSheetByName(CONFIG.SHEET_RECEIPTS);
  const itemsSheet = ss.getSheetByName(CONFIG.SHEET_ITEMS);

  let processedCount = 0;
  let errors = [];

  while (files.hasNext() && processedCount < CONFIG.MAX_FILES_PER_RUN) {
    const file = files.next();
    const mimeType = file.getMimeType();
    const fileName = file.getName();
    const nameLower = fileName.toLowerCase();

    // Check supported file types (images or PDF)
    const isImageOrPdf = mimeType.startsWith('image/') || 
                         mimeType === 'application/pdf' || 
                         nameLower.endsWith('.heic') || 
                         nameLower.endsWith('.jpg') || 
                         nameLower.endsWith('.jpeg') || 
                         nameLower.endsWith('.png') ||
                         nameLower.endsWith('.pdf');

    if (!isImageOrPdf) {
      Logger.log('Skipping unsupported file: ' + fileName + ' (' + mimeType + ')');
      continue;
    }

    Logger.log('Processing file: ' + fileName);

    try {
      // 1. Call Gemini to extract structured receipt data
      const receiptData = callGeminiReceiptOCR(file, apiKey);

      if (!receiptData) {
        throw new Error('Gemini returned empty data.');
      }

      // Normalize purchase date to YYYY-MM-DD (defaults to file date or today if missing)
      receiptData.purchase_date = sanitizePurchaseDate(receiptData.purchase_date, file);

      // 2. Generate a unique receipt identifier
      const safeStore = (receiptData.store_name || 'STORE').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
      const receiptId = 'RCP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + safeStore + '-' + Math.floor(100 + Math.random() * 900);
      const processedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      const fileUrl = file.getUrl();

      // 3. Append to Receipts Sheet
      const receiptRow = [
        receiptId,
        receiptData.purchase_date,
        receiptData.store_name || 'Unknown Store',
        receiptData.subtotal !== null && receiptData.subtotal !== undefined ? receiptData.subtotal : '',
        receiptData.total_discounts || 0,
        receiptData.total_fees || 0,
        receiptData.tax || 0,
        receiptData.total_paid !== null && receiptData.total_paid !== undefined ? receiptData.total_paid : '',
        receiptData.currency || CONFIG.CURRENCY_CODE || 'MVR',
        receiptData.payment_method || '',
        fileUrl,
        processedAt
      ];
      receiptsSheet.appendRow(receiptRow);

      // 4. Append each item to Items Sheet
      if (Array.isArray(receiptData.items) && receiptData.items.length > 0) {
        const itemRows = receiptData.items.map(function(item) {
          return [
            receiptId,
            receiptData.purchase_date,
            receiptData.store_name || 'Unknown Store',
            item.raw_name || '',
            item.standard_name || item.raw_name || '',
            item.category || 'Uncategorized',
            (function() {
              const qty = (item.quantity !== null && item.quantity !== undefined && Number(item.quantity) > 0) ? Number(item.quantity) : 1;
              return qty;
            })(),
            item.unit || 'unit',
            (function() {
              const tot = (item.total_price !== null && item.total_price !== undefined && !isNaN(Number(item.total_price))) ? Number(item.total_price) : '';
              return tot;
            })(),
            (function() {
              const qty = (item.quantity !== null && item.quantity !== undefined && Number(item.quantity) > 0) ? Number(item.quantity) : 1;
              const tot = (item.total_price !== null && item.total_price !== undefined && !isNaN(Number(item.total_price))) ? Number(item.total_price) : 0;
              if (item.unit_price !== null && item.unit_price !== undefined && !isNaN(Number(item.unit_price)) && Number(item.unit_price) > 0) {
                return Number(Number(item.unit_price).toFixed(2));
              }
              return (qty > 0 && tot > 0) ? Number((tot / qty).toFixed(2)) : tot;
            })(),
            item.is_on_sale ? 'YES' : 'NO',
            item.notes || ''
          ];
        });

        itemsSheet.getRange(
          itemsSheet.getLastRow() + 1, 
          1, 
          itemRows.length, 
          itemRows[0].length
        ).setValues(itemRows);
      }

      // 5. Move file to Processed folder
      try {
        file.moveTo(processedFolder);
      } catch (moveErr) {
        // Fallback move method for shared drives
        processedFolder.addFile(file);
        uploadFolder.removeFile(file);
      }

      processedCount++;
      Logger.log('Successfully processed: ' + fileName);

    } catch (err) {
      Logger.log('Error processing ' + fileName + ': ' + err.toString());
      errors.push(fileName + ': ' + (err.message || err.toString()));
    }
  }

  return { count: processedCount, errors: errors };
}

/**
 * Calls Gemini Flash with inline image/PDF bytes and structured JSON output
 */
function callGeminiReceiptOCR(file, apiKey) {
  let mimeType = file.getMimeType();
  const name = file.getName().toLowerCase();
  
  // Normalize MIME types
  if (name.endsWith('.heic') || mimeType === 'application/octet-stream') {
    mimeType = 'image/jpeg';
  } else if (name.endsWith('.pdf')) {
    mimeType = 'application/pdf';
  }

  const base64Data = Utilities.base64Encode(file.getBlob().getBytes());

  const promptText = `
You are an expert grocery receipt parser. Carefully analyze this receipt image/document and extract all transaction details into structured JSON.

Return a JSON object with this exact structure:
{
  "store_name": "Name of grocery store or supermarket (e.g. Trader Joe's, Walmart, Costco, Aldi)",
  "purchase_date": "YYYY-MM-DD (extract transaction date from receipt. Convert 2-digit years like '26' to '2026'. If unclear or missing, return null)",
  "currency": "Currency code or symbol (e.g. USD, EUR, GBP, MVR, etc.)",
  "subtotal": 0.00 (numeric subtotal before taxes/discounts, or null),
  "total_discounts": 0.00 (numeric total discounts/savings, or 0),
  "total_fees": 0.00 (numeric extra charges like bag charges, delivery, or 0),
  "tax": 0.00 (total GST/tax amount, numeric),
  "total_paid": 0.00 (final total paid, numeric),
  "payment_method": "Cash, Credit Card, MIB POS Machine, etc.",
  "items": [
    {
      "raw_name": "Full item description exactly as printed on the receipt",
      "standard_name": "Clean, recognizable item name (e.g. Paper Towel 1 Roll, Tuna In Brine 180g, Chickpeas 500g, Brinjal, Carrot, Zucchini)",
      "category": "One of: [Produce, Dairy & Eggs, Meat & Seafood, Bakery, Pantry, Frozen, Snacks & Beverages, Household & Personal, Other]",
      "quantity": 1.0 (numeric quantity or weight, e.g. 0.516, 1, 2),
      "unit": "unit of measure: kg, g, lb, unit, roll, pouch, bottle, pack",
      "total_price": 0.00 (numeric total price charged for this line item),
      "unit_price": 0.00 (numeric unit price, e.g. price per kg or price per item),
      "is_on_sale": false (true if discounted or on promotion),
      "notes": "Any extra info, e.g. GST inclusive, brand name"
    }
  ]
}

Important Instructions:
- Date handling: Extract the actual purchase/invoice date in YYYY-MM-DD format. If year is 2 digits, convert to 4 digits (e.g. 26 -> 2026). If date is completely illegible or missing, return null.
- For items weighed by kg (e.g. "Chick Peas Kg Raw 0.5000 kg x 70.00 / kg -> 35.00"), quantity is 0.5, unit is "kg", unit_price is 70.00, total_price is 35.00.
- Ensure all numbers are pure numeric values (not strings, do not include currency symbols in numbers).
- Return ONLY pure JSON. Do not wrap in markdown or backticks.
`;

  const requestPayload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json",
      temperature: 0.1
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  // List of models to try in order (prioritizing selected model with seamless fallbacks)
  const candidateModels = [
    CONFIG.GEMINI_MODEL || 'gemini-2.5-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ].filter((model, idx, arr) => arr.indexOf(model) === idx);

  const maxRetriesPerModel = 2; // Up to 2 retries (3 total attempts per model)
  let successfulResponseBody = null;
  let lastError = null;

  for (let m = 0; m < candidateModels.length; m++) {
    const currentModel = candidateModels[m];
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + 
                currentModel + ':generateContent?key=' + apiKey;

    let modelSucceeded = false;

    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
      let response, responseCode, responseBody;
      try {
        response = UrlFetchApp.fetch(url, options);
        responseCode = response.getResponseCode();
        responseBody = response.getContentText();
      } catch (networkErr) {
        lastError = 'Network/Fetch error: ' + networkErr.toString();
        Logger.log('Model ' + currentModel + ' attempt ' + (attempt + 1) + ' network error: ' + networkErr.toString());
        if (attempt < maxRetriesPerModel) {
          const backoffMs = (attempt + 1) * 2000;
          Utilities.sleep(backoffMs);
          continue;
        }
        break;
      }

      if (responseCode === 200) {
        successfulResponseBody = responseBody;
        modelSucceeded = true;
        Logger.log('Successfully processed using ' + currentModel + ' on attempt ' + (attempt + 1));
        break;
      } else if (responseCode === 503 || responseCode === 429) {
        lastError = responseBody;
        if (attempt < maxRetriesPerModel) {
          // Exponential backoff: attempt 0 -> ~2.2s, attempt 1 -> ~4.4s
          const backoffMs = Math.pow(2, attempt + 1) * 1000 + Math.floor(Math.random() * 500);
          Logger.log('Model ' + currentModel + ' returned ' + responseCode + ' (attempt ' + (attempt + 1) + '). Backing off ' + backoffMs + 'ms before retry...');
          Utilities.sleep(backoffMs);
        } else {
          Logger.log('Model ' + currentModel + ' exhausted ' + (maxRetriesPerModel + 1) + ' attempts with ' + responseCode + '. Moving to fallback candidate...');
        }
      } else if (responseCode === 404) {
        Logger.log('Model ' + currentModel + ' returned 404 (Not Found). Skipping to next candidate model immediately...');
        lastError = responseBody;
        break; // Do not retry 404s
      } else {
        // Non-transient errors (e.g. 400 Bad Request, 403 Forbidden)
        throw new Error('Gemini API Error (' + responseCode + '): ' + responseBody);
      }
    }

    if (modelSucceeded) {
      break;
    }
  }

  if (!successfulResponseBody) {
    throw new Error('Gemini API Error (All candidate models busy or unavailable):\n' + (lastError || 'Unknown API failure'));
  }

  const jsonResponse = JSON.parse(successfulResponseBody);
  
  if (!jsonResponse.candidates || jsonResponse.candidates.length === 0) {
    throw new Error('Gemini did not return any candidates: ' + successfulResponseBody);
  }

  const candidate = jsonResponse.candidates[0];
  if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
    throw new Error('Gemini response missing content (finishReason: ' + candidate.finishReason + ')');
  }

  let rawJsonText = candidate.content.parts[0].text.trim();

  // Strip any accidental markdown formatting
  if (rawJsonText.startsWith('```json')) {
    rawJsonText = rawJsonText.substring(7);
  } else if (rawJsonText.startsWith('```')) {
    rawJsonText = rawJsonText.substring(3);
  }
  if (rawJsonText.endsWith('```')) {
    rawJsonText = rawJsonText.substring(0, rawJsonText.length - 3);
  }

  return JSON.parse(rawJsonText.trim());
}

/**
 * Ensures Receipts and Items sheets exist with formatted headers
 */
function ensureSheetSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let receiptsSheet = ss.getSheetByName(CONFIG.SHEET_RECEIPTS);
  if (!receiptsSheet) {
    receiptsSheet = ss.insertSheet(CONFIG.SHEET_RECEIPTS);
    const receiptHeaders = [
      'Receipt ID', 'Date', 'Store Name', 'Subtotal', 
      'Discounts / Savings', 'Fees / Surcharges', 'Tax', 
      'Total Paid', 'Currency', 'Payment Method', 
      'Receipt URL', 'Processed At'
    ];
    receiptsSheet.getRange(1, 1, 1, receiptHeaders.length).setValues([receiptHeaders]);
    receiptsSheet.getRange(1, 1, 1, receiptHeaders.length)
      .setFontWeight('bold')
      .setBackground('#1a73e8')
      .setFontColor('#ffffff');
    receiptsSheet.setFrozenRows(1);
  }

  let itemsSheet = ss.getSheetByName(CONFIG.SHEET_ITEMS);
  if (!itemsSheet) {
    itemsSheet = ss.insertSheet(CONFIG.SHEET_ITEMS);
    const itemHeaders = [
      'Receipt ID', 'Date', 'Store Name', 'Raw Item Name', 
      'Standardized Name', 'Category', 'Quantity', 'Unit', 
      'Item Total Price', 'Unit Price', 'Is On Sale?', 'Notes'
    ];
    itemsSheet.getRange(1, 1, 1, itemHeaders.length).setValues([itemHeaders]);
    itemsSheet.getRange(1, 1, 1, itemHeaders.length)
      .setFontWeight('bold')
      .setBackground('#0d904f')
      .setFontColor('#ffffff');
    itemsSheet.setFrozenRows(1);
  }
}

/**
 * One-time setup: Creates tabs with formatting & Drive folders
 */
function setupSheetAndFolders() {
  ensureSheetSetup();
  getOrCreateFolder(CONFIG.UPLOAD_FOLDER_NAME);
  getOrCreateFolder(CONFIG.PROCESSED_FOLDER_NAME);
  buildDashboardTabs();

  SpreadsheetApp.getUi().alert(
    'Setup Complete!\n\n' +
    '• Folders created: "' + CONFIG.UPLOAD_FOLDER_NAME + '" & "' + CONFIG.PROCESSED_FOLDER_NAME + '"\n' +
    '• Data Sheets: "' + CONFIG.SHEET_RECEIPTS + '" & "' + CONFIG.SHEET_ITEMS + '"\n' +
    '• Dashboards: "' + CONFIG.SHEET_DASHBOARD + '", "' + CONFIG.SHEET_PRICE_COMPARE + '", "' + CONFIG.SHEET_PRICE_TRENDS + '" & "' + CONFIG.SHEET_STORE_MATRIX + '"\n\n' +
    'Make sure to set your GEMINI_API_KEY in Project Settings > Script Properties.'
  );
}

/**
 * Interactive menu alert wrapper to build/refresh dashboards
 */
function buildDashboardTabsWithAlert() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Building dashboards & price comparison tools...', 'Dashboard Builder', 5);
  try {
    ensureSheetSetup();
    buildDashboardTabs();
    SpreadsheetApp.getUi().alert(
      'Dashboards Ready! 🎉',
      'The following dashboards have been created/refreshed:\n\n' +
      '1. 📊 ' + CONFIG.SHEET_DASHBOARD + ':\n' +
      '   - KPI Scorecards (Total Spend, Trips, Savings, Avg Basket)\n' +
      '   - Category Donut Chart, Store Column Chart & Monthly Budget Trends\n\n' +
      '2. 🏷️ ' + CONFIG.SHEET_PRICE_COMPARE + ':\n' +
      '   - Interactive product price dropdown\n' +
      '   - Cheapest vs. Most expensive store cards & Sparkline\n' +
      '   - Store-by-Store Price Evolution (same store price changes over time)\n' +
      '   - Top 10 frequency-ranked staples\n\n' +
      '3. 📅 ' + CONFIG.SHEET_PRICE_TRENDS + ':\n' +
      '   - Month-by-month product unit price matrix (seasonal pattern detection)\n' +
      '   - Color-coded price spikes & inflation tracker\n\n' +
      '4. 🏬 ' + CONFIG.SHEET_STORE_MATRIX + ':\n' +
      '   - Cross-store matrix comparing prices for all items across supermarkets\n\n' +
      'Check the tabs at the bottom of your sheet!',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('Error creating dashboards', err.message || err.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Builds and styles Dashboard, Price Compare, Seasonal Trends, and Store Matrix sheets
 */
function buildDashboardTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  buildSpendingDashboardSheet(ss);
  buildPriceCompareSheet(ss);
  buildPriceTrendsSheet(ss);
  buildStoreMatrixSheet(ss);
}

/**
 * Generates executive spending dashboard with KPI cards and charts
 */
function buildSpendingDashboardSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_DASHBOARD);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_DASHBOARD, 0);
  }

  // Clear contents and existing charts for a clean refresh
  sheet.clear();
  const existingCharts = sheet.getCharts();
  for (let i = 0; i < existingCharts.length; i++) {
    sheet.removeChart(existingCharts[i]);
  }
  sheet.setHiddenGridlines(false);

  // Set Column Widths (A through J: 10 columns)
  const widths = [135, 130, 130, 130, 125, 125, 135, 135, 130, 130];
  for (let c = 0; c < widths.length; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }

  // --- Title Banner (Row 1-2) ---
  sheet.getRange("A1:J1").merge()
    .setValue("🛒 GROCERY EXPENSE & SPENDING DASHBOARD")
    .setFontWeight("bold")
    .setFontSize(14)
    .setFontColor("#ffffff")
    .setBackground("#1e293b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  sheet.getRange("A2:J2").merge()
    .setValue("Real-time grocery spending breakdown, monthly budgets (" + CONFIG.CURRENCY_CODE + "), and category trends")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 22);
  sheet.setRowHeight(3, 12); // spacer

  // --- KPI Metric Cards (Rows 4-6, 5 Cards across Cols A to J) ---
  // Card 1: Current Month Spend (A4:B6) - Auto-resets on the 1st of every month!
  sheet.getRange("A4:B4").merge()
    .setFormula("=\"THIS MONTH (\" & UPPER(TEXT(TODAY(), \"MMM\")) & \")\"")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#6d28d9")
    .setBackground("#ede9fe")
    .setHorizontalAlignment("center");
  sheet.getRange("A5:B5").merge()
    .setFormula("=IFERROR(SUMPRODUCT((IFERROR(TEXT(Receipts!B2:B, \"yyyy-mm\"), LEFT(Receipts!B2:B, 7)) = TEXT(TODAY(), \"yyyy-mm\")) * N(Receipts!H2:H)), 0)")
    .setFontSize(17)
    .setFontWeight("bold")
    .setFontColor("#5b21b6")
    .setBackground("#f5f3ff")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");
  sheet.getRange("A6:B6").merge()
    .setFormula("=\"Auto-resets \" & TEXT(EOMONTH(TODAY(), 0) + 1, \"MMM 1\")")
    .setFontSize(8)
    .setFontStyle("italic")
    .setFontColor("#7c3aed")
    .setBackground("#f5f3ff")
    .setHorizontalAlignment("center");

  // Card 2: All-Time Spend (C4:D6)
  sheet.getRange("C4:D4").merge()
    .setValue("ALL-TIME SPEND")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#475569")
    .setBackground("#f1f5f9")
    .setHorizontalAlignment("center");
  sheet.getRange("C5:D5").merge()
    .setFormula("=IFERROR(SUM(Receipts!H2:H), 0)")
    .setFontSize(17)
    .setFontWeight("bold")
    .setFontColor("#0f172a")
    .setBackground("#f8fafc")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");
  sheet.getRange("C6:D6").merge()
    .setValue("All logged receipts")
    .setFontSize(8)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setBackground("#f8fafc")
    .setHorizontalAlignment("center");

  // Card 3: Total Store Trips (E4:F6)
  sheet.getRange("E4:F4").merge()
    .setValue("STORE VISITS")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#475569")
    .setBackground("#f1f5f9")
    .setHorizontalAlignment("center");
  sheet.getRange("E5:F5").merge()
    .setFormula("=IFERROR(COUNTA(Receipts!A2:A), 0)")
    .setFontSize(17)
    .setFontWeight("bold")
    .setFontColor("#0f172a")
    .setBackground("#f8fafc")
    .setNumberFormat("#,##0")
    .setHorizontalAlignment("center");
  sheet.getRange("E6:F6").merge()
    .setValue("Total shopping trips")
    .setFontSize(8)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setBackground("#f8fafc")
    .setHorizontalAlignment("center");

  // Card 4: Total Savings (G4:H6)
  sheet.getRange("G4:H4").merge()
    .setValue("SAVINGS / DISCOUNTS")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#065f46")
    .setBackground("#d1fae5")
    .setHorizontalAlignment("center");
  sheet.getRange("G5:H5").merge()
    .setFormula("=IFERROR(SUM(Receipts!E2:E), 0)")
    .setFontSize(17)
    .setFontWeight("bold")
    .setFontColor("#047857")
    .setBackground("#ecfdf5")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");
  sheet.getRange("G6:H6").merge()
    .setValue("Discounts & promos")
    .setFontSize(8)
    .setFontStyle("italic")
    .setFontColor("#059669")
    .setBackground("#ecfdf5")
    .setHorizontalAlignment("center");

  // Card 5: Average Spend per Trip (I4:J6)
  sheet.getRange("I4:J4").merge()
    .setValue("AVERAGE BASKET")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#1e40af")
    .setBackground("#dbeafe")
    .setHorizontalAlignment("center");
  sheet.getRange("I5:J5").merge()
    .setFormula("=IFERROR(AVERAGE(Receipts!H2:H), 0)")
    .setFontSize(17)
    .setFontWeight("bold")
    .setFontColor("#1d4ed8")
    .setBackground("#eff6ff")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");
  sheet.getRange("I6:J6").merge()
    .setValue("Avg spend per trip")
    .setFontSize(8)
    .setFontStyle("italic")
    .setFontColor("#2563eb")
    .setBackground("#eff6ff")
    .setHorizontalAlignment("center");

  // Apply card borders
  sheet.getRange("A4:B6").setBorder(true, true, true, true, false, false, "#c4b5fd", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("C4:D6").setBorder(true, true, true, true, false, false, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("E4:F6").setBorder(true, true, true, true, false, false, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("G4:H6").setBorder(true, true, true, true, false, false, "#a7f3d0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("I4:J6").setBorder(true, true, true, true, false, false, "#bfdbfe", SpreadsheetApp.BorderStyle.SOLID);

  sheet.setRowHeight(4, 20);
  sheet.setRowHeight(5, 30);
  sheet.setRowHeight(6, 18);
  sheet.setRowHeight(7, 16); // spacer

  // --- Category Spending Section (Left: A8:D19) ---
  sheet.getRange("A8:D8").merge()
    .setValue("SPENDING BY CATEGORY (" + CONFIG.CURRENCY_CODE + ")")
    .setFontWeight("bold")
    .setFontSize(10)
    .setFontColor("#ffffff")
    .setBackground("#334155");
  
  sheet.getRange("A9").setFormula(
    "=IFERROR(QUERY(Items!A2:L, \"SELECT F, SUM(I), COUNT(E) WHERE F IS NOT NULL AND F <> \x27\x27 GROUP BY F ORDER BY SUM(I) DESC LABEL F \x27Category\x27, SUM(I) \x27Total Spend (" + CONFIG.CURRENCY_CODE + ")\x27, COUNT(E) \x27Items\x27\"), {\"Category\", \"Total Spend (" + CONFIG.CURRENCY_CODE + ")\", \"Items\"; \"No items yet\", 0, 0})"
  );
  sheet.getRange("A9:D9").setFontWeight("bold").setBackground("#f1f5f9");
  sheet.getRange("B10:B25").setNumberFormat(CONFIG.CURRENCY_FORMAT);
  sheet.getRange("C10:C25").setNumberFormat("#,##0");

  // --- Store Spending Section (Right: F8:J19) ---
  sheet.getRange("F8:J8").merge()
    .setValue("SPENDING BY STORE (" + CONFIG.CURRENCY_CODE + ")")
    .setFontWeight("bold")
    .setFontSize(10)
    .setFontColor("#ffffff")
    .setBackground("#334155");

  sheet.getRange("F9").setFormula(
    "=IFERROR(QUERY(Receipts!A2:L, \"SELECT C, SUM(H), COUNT(A), AVG(H) WHERE C IS NOT NULL AND C <> \x27\x27 GROUP BY C ORDER BY SUM(H) DESC LABEL C \x27Store\x27, SUM(H) \x27Total Spent (" + CONFIG.CURRENCY_CODE + ")\x27, COUNT(A) \x27Visits\x27, AVG(H) \x27Avg / Trip\x27\"), {\"Store\", \"Total Spent (" + CONFIG.CURRENCY_CODE + ")\", \"Visits\", \"Avg / Trip\"; \"No receipts yet\", 0, 0, 0})"
  );
  sheet.getRange("F9:J9").setFontWeight("bold").setBackground("#f1f5f9");
  sheet.getRange("G10:G25").setNumberFormat(CONFIG.CURRENCY_FORMAT);
  sheet.getRange("H10:H25").setNumberFormat("#,##0");
  sheet.getRange("I10:I25").setNumberFormat(CONFIG.CURRENCY_FORMAT);

  SpreadsheetApp.flush();

  // --- Charts Placement (Row 21 onwards) ---
  try {
    const categoryChart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange("A9:B25"))
      .setNumHeaders(1)
      .setPosition(21, 1, 0, 0)
      .setOption("title", "Spend Breakdown by Category (" + CONFIG.CURRENCY_CODE + ")")
      .setOption("pieHole", 0.4)
      .setOption("width", 480)
      .setOption("height", 300)
      .build();
    sheet.insertChart(categoryChart);

    const storeChart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sheet.getRange("F9:G25"))
      .setNumHeaders(1)
      .setPosition(21, 6, 0, 0)
      .setOption("title", "Total Spend by Store (" + CONFIG.CURRENCY_CODE + ")")
      .setOption("legend", { position: "none" })
      .setOption("width", 480)
      .setOption("height", 300)
      .build();
    sheet.insertChart(storeChart);
  } catch (chartErr) {
    Logger.log("Chart creation notice: " + chartErr.toString());
  }

  // --- Section 3: Monthly Grocery Budget & Seasonal Spending Evolution (Row 38) ---
  sheet.getRange("A38:J38").merge()
    .setValue("📅 MONTHLY GROCERY BUDGET & SEASONAL SPENDING EVOLUTION")
    .setFontWeight("bold")
    .setFontSize(11)
    .setFontColor("#ffffff")
    .setBackground("#1e293b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(38, 30);

  sheet.getRange("A39:J39").merge()
    .setValue("Track total monthly spending in " + CONFIG.CURRENCY_CODE + ", shopping trip frequency, and average basket sizes over time to spot seasonal budget fluctuations.")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(39, 20);

  // Headers (Row 40)
  sheet.getRange("A40:B40").merge().setValue("Calendar Month").setFontWeight("bold").setBackground("#334155").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.getRange("C40:D40").merge().setValue("Total Spend (" + CONFIG.CURRENCY_CODE + ")").setFontWeight("bold").setBackground("#334155").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.getRange("E40:F40").merge().setValue("Store Trips").setFontWeight("bold").setBackground("#334155").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.getRange("G40:H40").merge().setValue("Avg Spend / Trip").setFontWeight("bold").setBackground("#334155").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.getRange("I40:J40").merge().setValue("Discounts & Savings").setFontWeight("bold").setBackground("#334155").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.setRowHeight(40, 24);

  // Dynamic Monthly Rows (Rows 41 to 52 for up to 12 recent months)
  for (let m = 1; m <= 12; m++) {
    const r = 40 + m;
    sheet.setRowHeight(r, 22);

    sheet.getRange("A" + r + ":B" + r).merge();
    sheet.getRange("C" + r + ":D" + r).merge();
    sheet.getRange("E" + r + ":F" + r).merge();
    sheet.getRange("G" + r + ":H" + r).merge();
    sheet.getRange("I" + r + ":J" + r).merge();

    // Distinct Month
    sheet.getRange("A" + r).setFormula(
      '=IFERROR(INDEX(SORT(UNIQUE(MAP(FILTER(Receipts!B$2:B, Receipts!B$2:B<>""), LAMBDA(d, IFERROR(TEXT(d, "yyyy-mm"), LEFT(d, 7))))), 1, FALSE), ' + m + '), "—")'
    ).setFontWeight("bold").setHorizontalAlignment("center");

    // Total Spend
    sheet.getRange("C" + r).setFormula(
      '=IF(A' + r + '="—", 0, IFERROR(SUMPRODUCT((IFERROR(TEXT(Receipts!B$2:B, "yyyy-mm"), LEFT(Receipts!B$2:B, 7)) = A' + r + ') * N(Receipts!H$2:H)), 0))'
    ).setFontWeight("bold").setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("center");

    // Trips
    sheet.getRange("E" + r).setFormula(
      '=IF(A' + r + '="—", 0, IFERROR(SUMPRODUCT((IFERROR(TEXT(Receipts!B$2:B, "yyyy-mm"), LEFT(Receipts!B$2:B, 7)) = A' + r + ') * 1), 0))'
    ).setHorizontalAlignment("center").setNumberFormat('#,##0" trips"');

    // Avg Basket
    sheet.getRange("G" + r).setFormula(
      '=IF(OR(A' + r + '="—", E' + r + '=0), 0, IFERROR(C' + r + ' / E' + r + ', 0))'
    ).setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("center");

    // Savings
    sheet.getRange("I" + r).setFormula(
      '=IF(A' + r + '="—", 0, IFERROR(SUMPRODUCT((IFERROR(TEXT(Receipts!B$2:B, "yyyy-mm"), LEFT(Receipts!B$2:B, 7)) = A' + r + ') * N(Receipts!E$2:E)), 0))'
    ).setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("center").setFontColor("#059669");

    const rowBg = m % 2 === 0 ? "#f8fafc" : "#ffffff";
    sheet.getRange("A" + r + ":J" + r).setBackground(rowBg);
  }
  sheet.getRange("A40:J52").setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Generates product price comparison dashboard with interactive dropdown, Top 10 staples, and store matrix
 */
function buildPriceCompareSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_PRICE_COMPARE);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_PRICE_COMPARE, 1);
  }

  // Clear contents and existing charts
  sheet.clear();
  const existingCharts = sheet.getCharts();
  for (let i = 0; i < existingCharts.length; i++) {
    sheet.removeChart(existingCharts[i]);
  }
  sheet.setHiddenGridlines(false);

  // Set Column Widths (A through I)
  // A: # (40), B: Product (220), C: Times (100), D: Cheap Store (160), E: Low Price (125), F: Avg (125), G: High Store (160), H: High Price (125), I: Savings (125)
  const widths = [40, 220, 100, 160, 125, 125, 160, 125, 125];
  for (let c = 0; c < widths.length; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }

  // --- Title Banner (Row 1-2) ---
  sheet.getRange("A1:I1").merge()
    .setValue("🏷️ GROCERY PRICE COMPARISON & STORE BENCHMARK")
    .setFontWeight("bold")
    .setFontSize(14)
    .setFontColor("#ffffff")
    .setBackground("#0f172a")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  sheet.getRange("A2:I2").merge()
    .setValue("Compare unit prices in " + CONFIG.CURRENCY_CODE + " across supermarkets to find the best deals")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 22);
  sheet.setRowHeight(3, 12); // spacer

  // --- Hidden / Off-grid Helper Lists for Products & Fallback Staples (Column Z) ---
  sheet.getRange("Z1").setValue("Unique Products List");
  
  // Fallback list of 10 essential grocery staples in Z10:Z19
  const fallbackStaples = [
    ["Whole Milk (1L)"],
    ["White Eggs (Pack)"],
    ["Basmati Rice (1kg)"],
    ["Tuna Chunks in Oil (Can)"],
    ["White Sugar (1kg)"],
    ["All Purpose Flour (1kg)"],
    ["Cooking Oil (1L)"],
    ["Red Onions (1kg)"],
    ["Potatoes (1kg)"],
    ["Yellow Bananas (1kg)"]
  ];
  sheet.getRange("Z10:Z19").setValues(fallbackStaples);

  // Dropdown list in Z2: Unique scanned items sorted alphabetically, stacked with fallback staples (never empty!)
  sheet.getRange("Z2").setFormula(
    '=IFERROR(IF(COUNTIF(Items!E2:E, "?*")=0, Z10:Z19, UNIQUE(VSTACK(SORT(FILTER(Items!E2:E, Items!E2:E<>"")), Z10:Z19))), Z10:Z19)'
  );

  // Top 10 frequency-ranked list in Z20 (safe from empty data and query errors)
  sheet.getRange("Z20").setFormula(
    '=IFERROR(IF(COUNTIF(Items!E2:E, "?*")=0, Z10:Z19, UNIQUE(VSTACK(LET(scanned, FILTER(Items!E2:E, Items!E2:E<>""), uniq, UNIQUE(scanned), SORT(uniq, COUNTIF(scanned, uniq), FALSE)), Z10:Z19))), Z10:Z19)'
  );

  // Hide column Z so helper lists are invisible to user
  sheet.hideColumns(26);

  // --- Section 1: Interactive Product Selector (Row 4) ---
  sheet.getRange("B4:C4").merge()
    .setValue("🔎 Select Product to Inspect:")
    .setFontWeight("bold")
    .setFontSize(11)
    .setFontColor("#0f172a")
    .setHorizontalAlignment("right")
    .setVerticalAlignment("middle");

  // Dropdown placed cleanly in D4:F4
  const dropdownCell = sheet.getRange("D4:F4");
  dropdownCell.merge()
    .setFontSize(12)
    .setFontWeight("bold")
    .setFontColor("#0369a1")
    .setBackground("#e0f2fe")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle")
    .setBorder(true, true, true, true, false, false, "#0284c7", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Default to #1 most frequently purchased item, or fallback staple
  dropdownCell.setFormula('=IFERROR(INDEX(Z20:Z50, 1), INDEX(Z2:Z500, 1))');

  // Attach data validation dropdown
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sheet.getRange("Z2:Z500"))
    .setAllowInvalid(true)
    .build();
  sheet.getRange("D4").setDataValidation(rule);

  sheet.setRowHeight(4, 32);
  sheet.setRowHeight(5, 12); // spacer

  // --- Section 1 Metric Cards: Selected Product KPI Cards (Rows 6-8) ---
  // Card 1: Cheapest Store (B6:C8)
  sheet.getRange("B6:C6").merge()
    .setValue("🏆 CHEAPEST STORE")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#15803d")
    .setBackground("#dcfce7")
    .setHorizontalAlignment("center");
  sheet.getRange("B7:C7").merge()
    .setFormula('=IFERROR(INDEX(SORT(FILTER({Items!C2:C, IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I))}, TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4))), 2, TRUE), 1, 1), "No data")')
    .setFontSize(12)
    .setFontWeight("bold")
    .setFontColor("#15803d")
    .setBackground("#f0fdf4")
    .setHorizontalAlignment("center");
  sheet.getRange("B8:C8").merge()
    .setFormula('=IFERROR(INDEX(SORT(FILTER({Items!C2:C, IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I))}, TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4))), 2, TRUE), 1, 2), 0)')
    .setFontSize(15)
    .setFontWeight("bold")
    .setFontColor("#15803d")
    .setBackground("#f0fdf4")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");

  // Card 2: Most Expensive Store (D6:E8)
  sheet.getRange("D6:E6").merge()
    .setValue("⚠️ HIGHEST PRICE")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#b91c1c")
    .setBackground("#fee2e2")
    .setHorizontalAlignment("center");
  sheet.getRange("D7:E7").merge()
    .setFormula('=IFERROR(INDEX(SORT(FILTER({Items!C2:C, IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I))}, TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4))), 2, FALSE), 1, 1), "No data")')
    .setFontSize(12)
    .setFontWeight("bold")
    .setFontColor("#b91c1c")
    .setBackground("#fef2f2")
    .setHorizontalAlignment("center");
  sheet.getRange("D8:E8").merge()
    .setFormula('=IFERROR(INDEX(SORT(FILTER({Items!C2:C, IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I))}, TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4))), 2, FALSE), 1, 2), 0)')
    .setFontSize(15)
    .setFontWeight("bold")
    .setFontColor("#b91c1c")
    .setBackground("#fef2f2")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");

  // Card 3: Average Unit Price (F6:G8)
  sheet.getRange("F6:G6").merge()
    .setValue("AVERAGE UNIT PRICE")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#4338ca")
    .setBackground("#e0e7ff")
    .setHorizontalAlignment("center");
  sheet.getRange("F7:G8").merge()
    .setFormula('=IFERROR(AVERAGE(FILTER(IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I)), TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4)))), 0)')
    .setFontSize(18)
    .setFontWeight("bold")
    .setFontColor("#4338ca")
    .setBackground("#eef2ff")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // Card 4: Potential Savings per Unit (H6:I8)
  sheet.getRange("H6:I6").merge()
    .setValue("MAX POTENTIAL SAVINGS")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#b45309")
    .setBackground("#fef3c7")
    .setHorizontalAlignment("center");
  sheet.getRange("H7:I8").merge()
    .setFormula('=IF(AND(ISNUMBER(D8), ISNUMBER(B8), D8>B8), D8-B8, 0)')
    .setFontSize(18)
    .setFontWeight("bold")
    .setFontColor("#b45309")
    .setBackground("#fffbeb")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  sheet.getRange("B6:C8").setBorder(true, true, true, true, false, false, "#86efac", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("D6:E8").setBorder(true, true, true, true, false, false, "#fca5a5", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("F6:G8").setBorder(true, true, true, true, false, false, "#c7d2fe", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("H6:I8").setBorder(true, true, true, true, false, false, "#fde68a", SpreadsheetApp.BorderStyle.SOLID);

  sheet.setRowHeight(6, 20);
  sheet.setRowHeight(7, 24);
  sheet.setRowHeight(8, 26);
  sheet.setRowHeight(9, 14); // spacer

  // --- Price History & Sparkline for Selected Item (Rows 10-18) ---
  const historyHeaders = ["Date", "Store", "Unit Price (" + CONFIG.CURRENCY_CODE + ")", "Unit", "On Sale?", "Notes"];
  sheet.getRange("B10:G10").setValues([historyHeaders])
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontColor("#ffffff")
    .setBackground("#334155")
    .setHorizontalAlignment("center");

  sheet.getRange("H10:I10").merge()
    .setValue("PRICE TREND")
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontColor("#ffffff")
    .setBackground("#334155")
    .setHorizontalAlignment("center");

  sheet.getRange("B11").setFormula(
    '=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({Items!B2:B, Items!C2:C, IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I)), Items!H2:H, Items!K2:K, Items!L2:L}, TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4))), 1, FALSE), 8, 6), {"No purchase records for this item", "—", 0, "—", "—", "—"})'
  );
  sheet.getRange("B11:B18").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("D11:D18").setNumberFormat(CONFIG.CURRENCY_FORMAT);

  // Sparkline in H11:I18
  sheet.getRange("H11:I18").merge()
    .setFormula(
      '=IFERROR(SPARKLINE(SORT(FILTER(IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I)), TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4))), FILTER(Items!B2:B, TRIM(LOWER(Items!E2:E))=TRIM(LOWER(D4))), TRUE), {"charttype","line";"color","#2563eb";"linewidth",2}), "—")'
    )
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBackground("#f8fafc")
    .setBorder(true, true, true, true, false, false, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);

  sheet.setRowHeight(19, 14); // spacer

  // --- Section 2: Store-by-Store Price Evolution for Selected Product (Rows 20-28) ---
  sheet.getRange("A20:I20").merge()
    .setValue("🏬 STORE-BY-STORE PRICE EVOLUTION FOR SELECTED PRODUCT")
    .setFontWeight("bold")
    .setFontSize(11)
    .setFontColor("#ffffff")
    .setBackground("#1e293b")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(20, 26);

  sheet.getRange("A21:I21").merge()
    .setValue("Tracks how prices for the selected product have changed over time at each specific supermarket. Spot price increases, promotions, and store consistency.")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b");
  sheet.setRowHeight(21, 20);

  const storeEvolHeaders = [
    "#", "Supermarket Store", "Times Bought", "First Price Paid",
    "First Date", "Latest Price Paid", "Latest Date", "Net Difference", "Same-Store Trend"
  ];
  sheet.getRange(22, 1, 1, storeEvolHeaders.length).setValues([storeEvolHeaders])
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontColor("#ffffff")
    .setBackground("#334155")
    .setHorizontalAlignment("center");
  sheet.setRowHeight(22, 24);

  // Populate up to 6 stores for the selected product (Rows 23 to 28)
  for (let s = 1; s <= 6; s++) {
    const r = 22 + s;
    sheet.setRowHeight(r, 22);

    // Rank
    sheet.getRange(r, 1).setValue(s).setFontWeight("bold").setHorizontalAlignment("center");

    // Store Name
    sheet.getRange(r, 2).setFormula(
      '=IFERROR(INDEX(SORT(UNIQUE(FILTER(Items!C$2:C, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(D$4)))), 1, TRUE), ' + s + '), "—")'
    ).setFontWeight("bold").setFontColor("#0f172a");

    // Times Bought at this store
    sheet.getRange(r, 3).setFormula(
      '=IF(B' + r + '="—", 0, COUNTIFS(Items!E$2:E, D$4, Items!C$2:C, B' + r + '))'
    ).setHorizontalAlignment("center").setNumberFormat('#,##0"x"');

    // First Price Seen
    sheet.getRange(r, 4).setFormula(
      '=IF(B' + r + '="—", 0, IFERROR(INDEX(SORT(FILTER(IF(ISNUMBER(Items!J$2:J)*(Items!J$2:J>0), Items!J$2:J, IFERROR(Items!I$2:I/MAX(1, Items!G$2:G), Items!I$2:I)), TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(D$4)), TRIM(LOWER(Items!C$2:C))=TRIM(LOWER(B' + r + '))), FILTER(Items!B$2:B, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(D$4)), TRIM(LOWER(Items!C$2:C))=TRIM(LOWER(B' + r + '))), TRUE), 1), 0))'
    ).setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("center");

    // First Date
    sheet.getRange(r, 5).setFormula(
      '=IF(B' + r + '="—", "—", IFERROR(INDEX(SORT(FILTER(Items!B$2:B, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(D$4)), TRIM(LOWER(Items!C$2:C))=TRIM(LOWER(B' + r + '))), 1, TRUE), 1), "—"))'
    ).setHorizontalAlignment("center");

    // Latest Price Paid
    sheet.getRange(r, 6).setFormula(
      '=IF(B' + r + '="—", 0, IFERROR(INDEX(SORT(FILTER(IF(ISNUMBER(Items!J$2:J)*(Items!J$2:J>0), Items!J$2:J, IFERROR(Items!I$2:I/MAX(1, Items!G$2:G), Items!I$2:I)), TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(D$4)), TRIM(LOWER(Items!C$2:C))=TRIM(LOWER(B' + r + '))), FILTER(Items!B$2:B, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(D$4)), TRIM(LOWER(Items!C$2:C))=TRIM(LOWER(B' + r + '))), FALSE), 1), 0))'
    ).setFontWeight("bold").setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("center");

    // Latest Date
    sheet.getRange(r, 7).setFormula(
      '=IF(B' + r + '="—", "—", IFERROR(INDEX(SORT(FILTER(Items!B$2:B, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(D$4)), TRIM(LOWER(Items!C$2:C))=TRIM(LOWER(B' + r + '))), 1, FALSE), 1), "—"))'
    ).setHorizontalAlignment("center");

    // Net Difference
    sheet.getRange(r, 8).setFormula(
      '=IF(OR(B' + r + '="—", C' + r + '=0), 0, F' + r + ' - D' + r + ')'
    ).setFontWeight("bold").setNumberFormat(CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("center");

    // Trend Indicator
    sheet.getRange(r, 9).setFormula(
      '=IF(B' + r + '="—", "—", IF(C' + r + '=1, "⚪ 1st Record", IF(H' + r + '>0.005, "🔺 +" & TEXT(H' + r + '/D' + r + ', "0.0%"), IF(H' + r + '<-0.005, "🟢 " & TEXT(H' + r + '/D' + r + ', "0.0%"), "⚖️ Stable"))))'
    ).setFontWeight("bold").setHorizontalAlignment("center");

    const rowBg = s % 2 === 0 ? "#f8fafc" : "#ffffff";
    sheet.getRange(r, 1, 1, 9).setBackground(rowBg);
  }
  sheet.getRange("A22:I28").setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);

  sheet.setRowHeight(29, 14); // spacer

  // --- Section 3: Top 10 Most Frequently Purchased Products (Rows 30-43) ---
  sheet.getRange("A30:I30").merge()
    .setValue("🛒 TOP 10 MOST FREQUENTLY PURCHASED PRODUCTS & BEST PRICES")
    .setFontWeight("bold")
    .setFontSize(11)
    .setFontColor("#ffffff")
    .setBackground("#1e293b")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(30, 26);

  sheet.getRange("A31:I31").merge()
    .setValue("Ranked by purchase frequency with the cheapest store deal for each (falls back to essential staples until enough receipts are logged).")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b");
  sheet.setRowHeight(31, 20);

  const top10Headers = [
    "#", "Staple Product Name", "Times Bought", "🏆 Cheapest Store",
    "Lowest Price (" + CONFIG.CURRENCY_CODE + ")", "Avg Price (" + CONFIG.CURRENCY_CODE + ")",
    "⚠️ Most Expensive", "Highest Price (" + CONFIG.CURRENCY_CODE + ")", "Max Savings (" + CONFIG.CURRENCY_CODE + ")"
  ];
  sheet.getRange(32, 1, 1, top10Headers.length).setValues([top10Headers])
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontColor("#ffffff")
    .setBackground("#334155")
    .setHorizontalAlignment("center");
  sheet.setRowHeight(32, 24);

  // Populate 10 dynamic rows (Rows 33 to 42)
  for (let k = 1; k <= 10; k++) {
    const r = 32 + k;
    sheet.setRowHeight(r, 22);
    
    // Rank
    sheet.getRange(r, 1).setValue(k).setFontWeight("bold").setHorizontalAlignment("center");
    // Product Name (pulls from ranked list in Z20:Z35)
    sheet.getRange(r, 2).setFormula("=IFERROR(INDEX(Z$20:Z$35, " + k + "), \"—\")").setFontWeight("bold").setFontColor("#0f172a");
    // Times Purchased
    sheet.getRange(r, 3).setFormula("=IFERROR(COUNTIF(Items!E$2:E, B" + r + "), 0)").setHorizontalAlignment("center").setNumberFormat('#,##0"x"');
    // Cheapest Store
    sheet.getRange(r, 4).setFormula(
      '=IFERROR(INDEX(SORT(FILTER({Items!C$2:C, IF(ISNUMBER(Items!J$2:J)*(Items!J$2:J>0), Items!J$2:J, IFERROR(Items!I$2:I/MAX(1, Items!G$2:G), Items!I$2:I))}, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(B' + r + '))), 2, TRUE), 1, 1), "Pending data")'
    ).setFontWeight("bold").setFontColor("#15803d");
    // Lowest Price
    sheet.getRange(r, 5).setFormula(
      '=IFERROR(INDEX(SORT(FILTER({Items!C$2:C, IF(ISNUMBER(Items!J$2:J)*(Items!J$2:J>0), Items!J$2:J, IFERROR(Items!I$2:I/MAX(1, Items!G$2:G), Items!I$2:I))}, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(B' + r + '))), 2, TRUE), 1, 2), 0)'
    ).setFontWeight("bold").setFontColor("#15803d").setNumberFormat(CONFIG.CURRENCY_FORMAT);
    // Average Price
    sheet.getRange(r, 6).setFormula(
      '=IFERROR(AVERAGE(FILTER(IF(ISNUMBER(Items!J$2:J)*(Items!J$2:J>0), Items!J$2:J, IFERROR(Items!I$2:I/MAX(1, Items!G$2:G), Items!I$2:I)), TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(B' + r + ')))), 0)'
    ).setNumberFormat(CONFIG.CURRENCY_FORMAT);
    // Most Expensive Store
    sheet.getRange(r, 7).setFormula(
      '=IFERROR(INDEX(SORT(FILTER({Items!C$2:C, IF(ISNUMBER(Items!J$2:J)*(Items!J$2:J>0), Items!J$2:J, IFERROR(Items!I$2:I/MAX(1, Items!G$2:G), Items!I$2:I))}, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(B' + r + '))), 2, FALSE), 1, 1), "—")'
    ).setFontColor("#64748b");
    // Highest Price
    sheet.getRange(r, 8).setFormula(
      '=IFERROR(INDEX(SORT(FILTER({Items!C$2:C, IF(ISNUMBER(Items!J$2:J)*(Items!J$2:J>0), Items!J$2:J, IFERROR(Items!I$2:I/MAX(1, Items!G$2:G), Items!I$2:I))}, TRIM(LOWER(Items!E$2:E))=TRIM(LOWER(B' + r + '))), 2, FALSE), 1, 2), 0)'
    ).setNumberFormat(CONFIG.CURRENCY_FORMAT);
    // Max Potential Savings
    sheet.getRange(r, 9).setFormula(
      '=IF(AND(ISNUMBER(H' + r + '), ISNUMBER(E' + r + '), H' + r + '>E' + r + '), H' + r + '-E' + r + ', 0)'
    ).setFontWeight("bold").setFontColor("#b45309").setNumberFormat(CONFIG.CURRENCY_FORMAT);

    // Alternating background for rows
    const rowBg = k % 2 === 0 ? "#f8fafc" : "#ffffff";
    sheet.getRange(r, 1, 1, 9).setBackground(rowBg);
  }
  sheet.getRange("A32:I42").setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Generates seasonal and monthly price trend matrix tab
 */
function buildPriceTrendsSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_PRICE_TRENDS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_PRICE_TRENDS, 2);
  }

  // Clear contents and existing charts
  sheet.clear();
  sheet.setHiddenGridlines(false);

  // Column A: 260px wide for complete product names
  sheet.setColumnWidth(1, 260);

  // Columns B through Z: 130px wide for monthly columns
  for (let c = 2; c <= 26; c++) {
    sheet.setColumnWidth(c, 130);
  }

  // --- Title Banner (Row 1-2) ---
  sheet.getRange("A1:Z1").merge()
    .setValue("📅 SEASONAL PRODUCT PRICE TRACKER & INFLATION PATTERNS")
    .setFontWeight("bold")
    .setFontSize(14)
    .setFontColor("#ffffff")
    .setBackground("#0f172a")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  sheet.getRange("A2:Z2").merge()
    .setValue("Average unit prices in " + CONFIG.CURRENCY_CODE + " tracked month-by-month. Spot seasonal price spikes (e.g. Ramadan, holidays, monsoon delays), deflation, and long-term supermarket trends.")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 22);
  sheet.setRowHeight(3, 12); // spacer

  // --- KPI Summary Cards (Rows 4-6) ---
  // Card 1: Unique Products Monitored (A4:B6)
  sheet.getRange("A4:B4").merge()
    .setValue("PRODUCTS MONITORED")
    .setFontSize(9).setFontWeight("bold").setFontColor("#1e40af").setBackground("#dbeafe").setHorizontalAlignment("center");
  sheet.getRange("A5:B5").merge()
    .setFormula('=IFERROR(COUNTA(UNIQUE(FILTER(Items!E2:E, Items!E2:E<>""))), 0)')
    .setFontSize(17).setFontWeight("bold").setFontColor("#1d4ed8").setBackground("#eff6ff").setNumberFormat("#,##0").setHorizontalAlignment("center");
  sheet.getRange("A6:B6").merge()
    .setValue("Unique items tracked")
    .setFontSize(8).setFontStyle("italic").setFontColor("#2563eb").setBackground("#eff6ff").setHorizontalAlignment("center");

  // Card 2: Calendar Months Recorded (C4:D6)
  sheet.getRange("C4:D4").merge()
    .setValue("MONTHS RECORDED")
    .setFontSize(9).setFontWeight("bold").setFontColor("#065f46").setBackground("#d1fae5").setHorizontalAlignment("center");
  sheet.getRange("C5:D5").merge()
    .setFormula('=IFERROR(COUNTA(UNIQUE(MAP(FILTER(Receipts!B2:B, Receipts!B2:B<>""), LAMBDA(d, IFERROR(TEXT(d, "yyyy-mm"), LEFT(d, 7)))))), 0)')
    .setFontSize(17).setFontWeight("bold").setFontColor("#047857").setBackground("#ecfdf5").setNumberFormat('#,##0" months"').setHorizontalAlignment("center");
  sheet.getRange("C6:D6").merge()
    .setValue("Seasonal timeline")
    .setFontSize(8).setFontStyle("italic").setFontColor("#059669").setBackground("#ecfdf5").setHorizontalAlignment("center");

  // Card 3: Supermarkets Logged (E4:F6)
  sheet.getRange("E4:F4").merge()
    .setValue("SUPERMARKETS")
    .setFontSize(9).setFontWeight("bold").setFontColor("#6d28d9").setBackground("#ede9fe").setHorizontalAlignment("center");
  sheet.getRange("E5:F5").merge()
    .setFormula('=IFERROR(COUNTA(UNIQUE(FILTER(Items!C2:C, Items!C2:C<>""))), 0)')
    .setFontSize(17).setFontWeight("bold").setFontColor("#5b21b6").setBackground("#f5f3ff").setNumberFormat('#,##0" stores"').setHorizontalAlignment("center");
  sheet.getRange("E6:F6").merge()
    .setValue("Cross-store coverage")
    .setFontSize(8).setFontStyle("italic").setFontColor("#7c3aed").setBackground("#f5f3ff").setHorizontalAlignment("center");

  // Card 4: Total Price Observations (G4:H6)
  sheet.getRange("G4:H4").merge()
    .setValue("PRICE OBSERVATIONS")
    .setFontSize(9).setFontWeight("bold").setFontColor("#9a3412").setBackground("#ffedd5").setHorizontalAlignment("center");
  sheet.getRange("G5:H5").merge()
    .setFormula('=IFERROR(COUNTA(Items!A2:A), 0)')
    .setFontSize(17).setFontWeight("bold").setFontColor("#c2410c").setBackground("#fff7ed").setNumberFormat("#,##0").setHorizontalAlignment("center");
  sheet.getRange("G6:H6").merge()
    .setValue("Scanned item entries")
    .setFontSize(8).setFontStyle("italic").setFontColor("#ea580c").setBackground("#fff7ed").setHorizontalAlignment("center");

  sheet.getRange("A4:B6").setBorder(true, true, true, true, false, false, "#bfdbfe", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("C4:D6").setBorder(true, true, true, true, false, false, "#a7f3d0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("E4:F6").setBorder(true, true, true, true, false, false, "#c4b5fd", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("G4:H6").setBorder(true, true, true, true, false, false, "#fed7aa", SpreadsheetApp.BorderStyle.SOLID);

  sheet.setRowHeight(4, 20);
  sheet.setRowHeight(5, 28);
  sheet.setRowHeight(6, 18);
  sheet.setRowHeight(7, 14); // spacer

  // --- Section 1: Month-by-Month Pivot Matrix (Rows 8-10) ---
  sheet.getRange("A8:Z8").merge()
    .setValue("📈 MONTH-BY-MONTH AVERAGE UNIT PRICE MATRIX (" + CONFIG.CURRENCY_CODE + ")")
    .setFontWeight("bold")
    .setFontSize(11)
    .setFontColor("#ffffff")
    .setBackground("#1e293b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(8, 28);

  sheet.getRange("A9:Z9").merge()
    .setValue("Every column represents a calendar month (YYYY-MM). Automatically expands as you upload receipts in new months. Soft green = cheaper price, soft red = price spike/inflation.")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(9, 20);

  // Freeze rows 1-10 so headers remain visible when scrolling
  sheet.setFrozenRows(10);

  // Monthly Pivot Query in A10
  sheet.getRange("A10").setFormula(
    '=IFERROR(QUERY({Items!E2:E, MAP(Items!B2:B, LAMBDA(d, IFERROR(TEXT(d, "yyyy-mm"), LEFT(d, 7)))), IF(ISNUMBER(Items!J2:J)*(Items!J2:J>0), Items!J2:J, IFERROR(Items!I2:I/MAX(1, Items!G2:G), Items!I2:I))}, "SELECT Col1, AVG(Col3) WHERE Col1 IS NOT NULL AND Col1 <> \'\' AND Col3 > 0 GROUP BY Col1 PIVOT Col2", 1), {"Standardized Product", "Monthly price trends will display here as receipts across different months are scanned"})'
  );

  // Header style (Row 10)
  sheet.getRange("A10:Z10")
    .setFontWeight("bold")
    .setBackground("#334155")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.getRange("A10").setHorizontalAlignment("left");
  sheet.setRowHeight(10, 28);

  // Format product name column
  sheet.getRange("A11:A500")
    .setFontWeight("bold")
    .setFontColor("#0f172a")
    .setHorizontalAlignment("left")
    .setWrap(true);

  // Format data cells as currency
  sheet.getRange("B11:Z500")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");

  // Conditional format gradient for matrix prices: soft green (cheap) to soft red (expensive)
  try {
    const trendRange = sheet.getRange("B11:Z500");
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint("#dcfce7")
      .setGradientMidpointWithValue("#fef9c3", SpreadsheetApp.InterpolationType.PERCENTILE, "50")
      .setGradientMaxpoint("#fee2e2")
      .setRanges([trendRange])
      .build();
    sheet.setConditionalFormatRules([rule]);
  } catch (cfErr) {
    Logger.log("Conditional formatting notice: " + cfErr.toString());
  }
}

/**
 * Generates dedicated cross-store comparison matrix tab for all products
 */
function buildStoreMatrixSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_STORE_MATRIX);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_STORE_MATRIX, 2);
  }

  // Clear contents and existing charts
  sheet.clear();
  sheet.setHiddenGridlines(false);

  // Column A: 260px wide for complete product names without overlap
  sheet.setColumnWidth(1, 260);

  // Columns B through Z: 140px wide for store comparison columns
  for (let c = 2; c <= 26; c++) {
    sheet.setColumnWidth(c, 140);
  }

  // --- Title Banner (Row 1-2) ---
  sheet.getRange("A1:Z1").merge()
    .setValue("🏬 ALL-PRODUCTS STORE PRICE COMPARISON MATRIX")
    .setFontWeight("bold")
    .setFontSize(14)
    .setFontColor("#ffffff")
    .setBackground("#0f172a")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  sheet.getRange("A2:Z2").merge()
    .setValue("Average unit price in " + CONFIG.CURRENCY_CODE + " for every grocery product across supermarkets. Automatically updates as new receipts are processed.")
    .setFontSize(9)
    .setFontStyle("italic")
    .setFontColor("#64748b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 22);
  sheet.setRowHeight(3, 12); // spacer

  // Freeze rows 1-4 so product names and store headers stay visible while scrolling down
  sheet.setFrozenRows(4);

  // Pivot Table Query in A4
  sheet.getRange("A4").setFormula(
    '=IFERROR(QUERY(Items!A2:L, "SELECT E, AVG(J) WHERE E IS NOT NULL AND J > 0 GROUP BY E PIVOT C", 1), {"Standardized Product", "Store comparisons will display here as receipts are scanned"})'
  );

  // Style header row 4
  sheet.getRange("A4:Z4")
    .setFontWeight("bold")
    .setBackground("#1e293b")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.getRange("A4").setHorizontalAlignment("left");
  sheet.setRowHeight(4, 28);

  // Format product name column
  sheet.getRange("A5:A500")
    .setFontWeight("bold")
    .setFontColor("#0f172a")
    .setHorizontalAlignment("left")
    .setWrap(true);

  // Format data cells
  sheet.getRange("B5:Z500")
    .setNumberFormat(CONFIG.CURRENCY_FORMAT)
    .setHorizontalAlignment("center");

  // Conditional format gradient for matrix prices: soft green (cheap) to soft red (expensive)
  try {
    const matrixRange = sheet.getRange("B5:Z500");
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint("#dcfce7")
      .setGradientMidpointWithValue("#fef9c3", SpreadsheetApp.InterpolationType.PERCENTILE, "50")
      .setGradientMaxpoint("#fee2e2")
      .setRanges([matrixRange])
      .build();
    sheet.setConditionalFormatRules([rule]);
  } catch (cfErr) {
    Logger.log("Conditional formatting notice: " + cfErr.toString());
  }
}

/**
 * Creates an automatic time-driven trigger to run every hour
 */
function installHourlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processPendingReceipts') {
      SpreadsheetApp.getUi().alert('A trigger for processPendingReceipts already exists!');
      return;
    }
  }

  ScriptApp.newTrigger('processPendingReceipts')
    .timeBased()
    .everyHours(1)
    .create();

  SpreadsheetApp.getUi().alert('Hourly trigger installed successfully! It will run once every hour until pending receipts succeed.');
}

/**
 * Removes the automatic hourly trigger
 */
function removeHourlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processPendingReceipts') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  if (removed > 0) {
    SpreadsheetApp.getUi().alert('Removed ' + removed + ' scheduled trigger(s). Hourly background scraping is now disabled.');
  } else {
    SpreadsheetApp.getUi().alert('No active hourly trigger was found.');
  }
}

/**
 * Helper to retrieve a Google Drive folder by name or create it if missing
 */
function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

/**
 * Validates and normalizes receipt purchase date into YYYY-MM-DD format.
 * If the scanned date is unclear, missing, or invalid,
 * defaults to the file's creation date or today's date.
 */
function sanitizePurchaseDate(rawDate, file) {
  let defaultDateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  if (file) {
    try {
      const fileDate = file.getDateCreated();
      defaultDateStr = Utilities.formatDate(fileDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch (e) {
      // Ignore if file metadata is unavailable
    }
  }

  if (!rawDate || typeof rawDate !== 'string') {
    return defaultDateStr;
  }

  const cleaned = rawDate.trim();
  const match = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);

  if (match) {
    const year = parseInt(match[1], 10);
    const month = ('0' + parseInt(match[2], 10)).slice(-2);
    const day = ('0' + parseInt(match[3], 10)).slice(-2);

    if (year >= 2000 && year <= 2099) {
      return year + '-' + month + '-' + day;
    }
  }

  // Try parsing general date string (e.g. "Sep 28, 2026", "28/09/2026")
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    if (year >= 2000 && year <= 2099) {
      return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  }

  return defaultDateStr;
}
