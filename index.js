const { google } = require('googleapis');
const sheets = google.sheets('v4');
const fs = require('fs');

const apiKey = '';
const spreadsheetId = '';
const outputDirectory = '';

function lowercaseFirstLetter(str) {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function createArrayWithFixedSizeAndInitialize(size, initialValues) {
  const newArray = new Array(size).fill({});
  const maxIndex = Math.min(size, initialValues.length);

  for (let index = 0; index < maxIndex; index++) {
    newArray[index] = initialValues[index];
  }

  return newArray;
}

function initializeArrayEmptyValues(currentTreeDepth, selectorKey) {
  for (const [index, value] of currentTreeDepth[selectorKey].entries()) {
    if (value === undefined) {
      currentTreeDepth[selectorKey][index] = {};
    }
  }
}

function resolveIntermediateArraySelector(currentTreeDepth, selectorKey, arrayIndex) {
  const isArrayIndexDefined = arrayIndex !== null;

  if (isArrayIndexDefined) {
    const treeDepthIsNotCreated = !currentTreeDepth[selectorKey][arrayIndex];

    if (treeDepthIsNotCreated) {
      currentTreeDepth[selectorKey][arrayIndex] = {};
    }

    initializeArrayEmptyValues(currentTreeDepth, selectorKey);

    return currentTreeDepth[selectorKey][arrayIndex];
  }

  currentTreeDepth[selectorKey].push({});

  return currentTreeDepth[selectorKey][currentTreeDepth[selectorKey].length - 1];
}

function resolveEndingArraySelector(currentTreeDepth, selectorKey, arrayIndex, value) {
  const isArrayIndexDefined = arrayIndex !== null;

  if (isArrayIndexDefined) {
    currentTreeDepth[selectorKey][arrayIndex] = value;
  } else {
    currentTreeDepth[selectorKey].push(value);
  }
}

function resolveRegularSelector(isLastSelector, currentTreeDepth, selector, value) {
  if (isLastSelector) {
    currentTreeDepth[selector] = value;
    return;
  }

  const treeDepthIsNotCreated = !currentTreeDepth[selector];

  if (treeDepthIsNotCreated) {
    currentTreeDepth[selector] = {};
  }

  return currentTreeDepth[selector];
}

function createSelectorTree(currentTreeDepth, selectorTree, value) {
  const detectArraySelectorRegex = /\[[^\]]*\]/;
  const destructureArraySelectorRegex = /[\[\]]/;

  selectorTree.forEach((selector, selectorIndex) => {
    const isRegularSelector = !detectArraySelectorRegex.test(selector);
    const isLastSelector = selectorIndex === selectorTree.length - 1;

    if (isRegularSelector) {
      currentTreeDepth = resolveRegularSelector(isLastSelector, currentTreeDepth, selector, value);
      return;
    }

    const [selectorKey, arrayIndexString] = selector.split(destructureArraySelectorRegex);
    const arrayIndex = arrayIndexString.length > 0 ? parseInt(arrayIndexString, 10) : null;
    const treeDepthIsNotCreated = !currentTreeDepth[selectorKey];

    if (treeDepthIsNotCreated) {
      currentTreeDepth[selectorKey] = [];
    }

    if (isLastSelector) {
      resolveEndingArraySelector(currentTreeDepth, selectorKey, arrayIndex, value);
    } else {
      currentTreeDepth = resolveIntermediateArraySelector(currentTreeDepth, selectorKey, arrayIndex);
    }
  });
}

function parseCopyRowData(copyRowData, sheetLocales, localesJsObject, sheetTitle) {
  const selectorString = copyRowData.values[0].effectiveValue.stringValue;
  const selectorTree = selectorString.split('.');

  copyRowData.values.slice(1).forEach(({ effectiveValue }, index) => {
    const currentTreeDepth = localesJsObject[sheetLocales[index]][sheetTitle];
    createSelectorTree(currentTreeDepth, selectorTree, effectiveValue?.stringValue ?? '');
  });
}

function parseCopyRowsData() {
  copyRowsData.forEach((copyRowData) => {
    const copyRowDataNeedsCorrection = copyRowData.values.length !== sheetLocales.length + 1;
    const _copyRowData = {
      values: copyRowDataNeedsCorrection
        ? createArrayWithFixedSizeAndInitialize(sheetLocales.length + 1, copyRowData.values)
        : copyRowData.values,
    };

    parseCopyRowData(_copyRowData, sheetLocales, localesJsObject, sheetName);
  });
}

function parseCopyRowsData(copyRowsData, localesJsObject, sheetLocales, sheetName) {
  copyRowsData.forEach((copyRowData) => {
    const copyRowDataNeedsCorrection = copyRowData.values.length !== sheetLocales.length + 1;
    const _copyRowData = {
      values: copyRowDataNeedsCorrection
        ? createArrayWithFixedSizeAndInitialize(sheetLocales.length + 1, copyRowData.values)
        : copyRowData.values,
    };

    parseCopyRowData(_copyRowData, sheetLocales, localesJsObject, sheetName);
  });
}

function createSheetEntryToLocalesJsObject(localesJsObject, sheetLocales, sheetName) {
  sheetLocales.forEach((sheetLocale) => {
    if (!localesJsObject[sheetLocale]) {
      localesJsObject[sheetLocale] = {};
    }

    localesJsObject[sheetLocale][sheetName] = {};
  });
}

function parseCurrentSheetLocales(localesRowData) {
  return [...localesRowData.values.map((value) => value.effectiveValue.stringValue)];
}

function parseLocalesRowData(localesRowData, sheetLocales) {
  parseCurrentSheetLocales(localesRowData)
    .slice(1)
    .forEach((sheetLocale) => {
      sheetLocales.push(sheetLocale);
    });
}

function writeToLocaleFiles(localesJsObject) {
  Object.keys(localesJsObject).forEach((locale) => {
    const localeObject = localesJsObject[locale];

    if (!fs.existsSync(`${outputDirectory}`)) {
      fs.mkdirSync(`${outputDirectory}`, { recursive: true });
    }

    fs.writeFile(`${outputDirectory}/${locale}.json`, JSON.stringify(localeObject, null, 2), (error) => {
      if (error) {
        console.error(`Error writing ${locale}.json file:`, error);
      } else {
        console.log(`${locale}.json file saved successfully.`);
      }
    });
  });
}

function createLocalesJsObject(sheets) {
  return sheets.reduce((localesJsObject, sheet) => {
    const sheetName = lowercaseFirstLetter(sheet.properties.title);
    const sheetLocales = [];
    const localesRowData = sheet.data[0].rowData[0];
    const copyRowsData = sheet.data[0].rowData.slice(1);

    parseLocalesRowData(localesRowData, sheetLocales);
    createSheetEntryToLocalesJsObject(localesJsObject, sheetLocales, sheetName);
    parseCopyRowsData(copyRowsData, localesJsObject, sheetLocales, sheetName);

    return localesJsObject;
  }, {});
}

async function fetchGoogleSpreadsheetSheets() {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    key: apiKey,
    fields: 'sheets(properties.title,data.rowData.values(effectiveValue))',
  });

  return spreadsheet.data.sheets;
}

async function fetchLocales() {
  try {
    const sheets = await fetchGoogleSpreadsheetSheets();
    const localesJsObject = createLocalesJsObject(sheets);
    writeToLocaleFiles(localesJsObject);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

(async () => {
  try {
    await fetchLocales();
  } catch (error) {
    console.error(error);
  }
})();
